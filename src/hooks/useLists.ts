import { useState, useEffect, useCallback, useRef } from "react";
import { TaskList } from "../types";
import Database from "@tauri-apps/plugin-sql";
import {
  fetchTaskLists,
  createTaskList as createTaskListGraph,
  deleteTaskList as deleteTaskListGraph,
} from "../api/graph";
import {
  loadListsFromDB,
  saveListToDB,
  deleteListFromDB,
  updateListMeta,
  clearAllData,
  queuePendingOp,
  getPendingOpsByType,
  deletePendingOp,
} from "../api/taskStorage";
import { useNetworkStatus } from "../services/networkMonitor";
import { logger } from "../services/logger";

export const useLists = (accessToken: string | null, db: Database | null, activeAccountId: string | null) => {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(true);

  const isOnline = useNetworkStatus();
  const listsRef = useRef<TaskList[]>([]);
  const accessTokenRef = useRef<string | null>(null);
  const dbRef = useRef<Database | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const clearingRef = useRef<Promise<void> | null>(null);

  useEffect(() => { listsRef.current = lists; }, [lists]);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { dbRef.current = db; }, [db]);

  // Load lists from DB when connection is ready or account changes
  useEffect(() => {
    if (!db) return;
    const init = async () => {
      try {
        const isAccountSwitch = prevAccountIdRef.current !== null && prevAccountIdRef.current !== activeAccountId;
        prevAccountIdRef.current = activeAccountId;

        if (isAccountSwitch) {
          setLists([]);
          setLoading(true);
          const clearing = clearAllData(db);
          clearingRef.current = clearing;
          await clearing;
          clearingRef.current = null;
        }

        const localLists = await loadListsFromDB(db);
        setLists(localLists);
        setLoading(false);
      } catch (err) {
        logger.error("Failed to load lists", err);
        setLoading(false);
      }
    };
    init();
  }, [db, activeAccountId]);

  // Sync lists with Microsoft Graph — try beta (for linkedGroupId), fall back to v1.0
  const syncLists = useCallback(async () => {
    // Wait for any in-progress account-switch DB clear to finish
    if (clearingRef.current) await clearingRef.current;

    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!token || !database || !isOnline) return;

    try {
      // Process pending list-create ops (lists created while offline)
      const pendingListOps = await getPendingOpsByType(database, "list-create");
      for (const op of pendingListOps) {
        const data = JSON.parse(op.data);
        try {
          const created = await createTaskListGraph(data.displayName, token);
          const withGroup = data.parentGroupId ? { ...created, parentGroupId: data.parentGroupId } : created;
          // Update the list ID in DB
          await deleteListFromDB(database, data.id);
          await saveListToDB(database, withGroup);
          // Update any tasks that reference the old local list ID
          await database.execute("UPDATE tasks SET listId = ? WHERE listId = ?", [created.id, data.id]);
          setLists((prev) => prev.map((l) => (l.id === data.id ? withGroup : l)));
          await deletePendingOp(database, op.id!);
        } catch (err) {
          logger.error(`Failed to sync pending list creation: ${data.displayName}`, err);
        }
      }

      const remoteLists = await fetchTaskLists(token);

      // Merge remote data with local state to preserve isGroup/parentGroupId
      const mergedLists = remoteLists.map((remote: TaskList) => {
        const existing = listsRef.current.find((l) => l.id === remote.id);
        return {
          ...remote,
          // Beta may provide parentGroupId via linkedGroupId; otherwise keep local value
          parentGroupId: remote.parentGroupId ?? existing?.parentGroupId,
          // Always preserve local isGroup flag (groups are local-only)
          isGroup: existing?.isGroup,
        };
      });

      // Preserve local-only groups (they don't exist on Graph)
      const localGroups = listsRef.current.filter(
        (l) => l.isGroup && !mergedLists.some((m) => m.id === l.id)
      );

      const allLists = [...mergedLists, ...localGroups];

      for (const list of allLists) {
        await saveListToDB(database, list);
      }

      // Remove stale entries that no longer exist on Graph (but keep local groups)
      const keepIds = new Set(allLists.map((l) => l.id));
      for (const local of listsRef.current) {
        if (!keepIds.has(local.id) && !local.isGroup && !local.id.startsWith("local-")) {
          await deleteListFromDB(database, local.id);
        }
      }

      setLists(allLists);
    } catch (err) {
      logger.error("Failed to sync lists", err);
    }
  }, [isOnline]);

  // Create a new standalone list
  const createList = useCallback(async (displayName: string) => {
    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!database || !displayName.trim()) return;

    const tempId = `local-list-${crypto.randomUUID()}`;
    const newList: TaskList = {
      id: tempId,
      displayName: displayName.trim(),
      isOwner: true,
      isShared: false,
    };

    setLists((prev) => [...prev, newList]);

    try {
      if (isOnline && token) {
        const created = await createTaskListGraph(displayName.trim(), token);
        await saveListToDB(database, created);
        setLists((prev) => prev.map((l) => (l.id === tempId ? created : l)));
        return created;
      } else {
        await saveListToDB(database, newList);
        await queuePendingOp(database, tempId, "list-create", { id: tempId, displayName: displayName.trim() });
        return newList;
      }
    } catch (err) {
      logger.error("Failed to create list", err);
      setLists((prev) => prev.filter((l) => l.id !== tempId));
    }
  }, [isOnline]);

  // Create an empty local-only group heading
  const createGroup = useCallback(async (displayName: string) => {
    const database = dbRef.current;
    if (!database || !displayName.trim()) return;

    const groupId = `local-group-${crypto.randomUUID()}`;
    const newGroup: TaskList = {
      id: groupId,
      displayName: displayName.trim(),
      isOwner: true,
      isShared: false,
      isGroup: true,
    };

    setLists((prev) => [...prev, newGroup]);

    try {
      await saveListToDB(database, newGroup);
    } catch (err) {
      logger.error("Failed to create group", err);
      setLists((prev) => prev.filter((l) => l.id !== groupId));
    }
  }, []);

  // Convert an existing task list into a local group heading.
  // Creates a local-only group and moves the original list under it as a sub-list.
  const convertToGroup = useCallback(async (listId: string) => {
    const database = dbRef.current;
    if (!database) return;

    const list = listsRef.current.find((l) => l.id === listId);
    if (!list) return;

    // Create a local-only group with a unique ID
    const groupId = `local-group-${crypto.randomUUID()}`;
    const newGroup: TaskList = {
      id: groupId,
      displayName: list.displayName,
      isOwner: true,
      isShared: false,
      isGroup: true,
    };

    // Move the original list under the new group
    const updatedList = { ...list, parentGroupId: groupId };

    setLists((prev) => [
      ...prev.map((l) => (l.id === listId ? updatedList : l)),
      newGroup,
    ]);

    try {
      await saveListToDB(database, newGroup);
      await updateListMeta(database, listId, { parentGroupId: groupId });
    } catch (err) {
      logger.error("Failed to convert list to group", err);
      setLists((prev) =>
        prev
          .filter((l) => l.id !== groupId)
          .map((l) => (l.id === listId ? list : l))
      );
    }
  }, []);

  // Create a sub-list under a group
  const createSubList = useCallback(async (groupId: string, displayName: string) => {
    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!database || !displayName.trim()) return;

    const tempId = `local-list-${crypto.randomUUID()}`;
    const newList: TaskList = {
      id: tempId,
      displayName: displayName.trim(),
      isOwner: true,
      isShared: false,
      parentGroupId: groupId,
    };

    setLists((prev) => [...prev, newList]);

    try {
      if (isOnline && token) {
        const created = await createTaskListGraph(displayName.trim(), token);
        const withGroup = { ...created, parentGroupId: groupId };
        await saveListToDB(database, withGroup);
        setLists((prev) => prev.map((l) => (l.id === tempId ? withGroup : l)));
        return withGroup;
      } else {
        await saveListToDB(database, newList);
        await queuePendingOp(database, tempId, "list-create", { id: tempId, displayName: displayName.trim(), parentGroupId: groupId });
        return newList;
      }
    } catch (err) {
      logger.error("Failed to create sub-list", err);
      setLists((prev) => prev.filter((l) => l.id !== tempId));
    }
  }, [isOnline]);

  // Move a list into a group (or remove from group with null) — local-only
  const moveToGroup = useCallback(async (listId: string, groupId: string | null) => {
    const database = dbRef.current;
    if (!database) return;

    const prevLists = listsRef.current;
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId ? { ...l, parentGroupId: groupId ?? undefined } : l
      )
    );

    try {
      await updateListMeta(database, listId, { parentGroupId: groupId });
    } catch (err) {
      logger.error("Failed to move list to group", err);
      setLists(prevLists);
    }
  }, []);

  // Delete a list or group
  const deleteList = useCallback(async (listId: string) => {
    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!database) return;

    const list = listsRef.current.find((l) => l.id === listId);
    if (!list) return;

    // If deleting a group, unparent all children first
    if (list.isGroup) {
      const children = listsRef.current.filter((l) => l.parentGroupId === listId);
      if (children.length > 0) {
        setLists((prev) =>
          prev.map((l) =>
            l.parentGroupId === listId ? { ...l, parentGroupId: undefined } : l
          )
        );
        for (const child of children) {
          try {
            await updateListMeta(database, child.id, { parentGroupId: null });
          } catch (err) {
            logger.error("Failed to unparent child list", err);
          }
        }
      }
    }

    setLists((prev) => prev.filter((l) => l.id !== listId));

    try {
      // Local-only groups don't exist on Graph — just delete from DB
      if (!list.isGroup && isOnline && token) {
        await deleteTaskListGraph(listId, token);
      }
      await deleteListFromDB(database, listId);
    } catch (err) {
      logger.error("Failed to delete list", err);
      setLists((prev) =>
        [...prev, list].sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
    }
  }, [isOnline]);

  return {
    lists,
    loading,
    createList,
    createSubList,
    createGroup,
    convertToGroup,
    moveToGroup,
    deleteList,
    syncLists,
    isOnline,
  };
};
