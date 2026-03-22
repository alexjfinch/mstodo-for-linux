import { useState, useEffect, useCallback, useRef } from "react";
import { TaskList } from "../types";
import Database from "@tauri-apps/plugin-sql";
import {
  fetchTaskLists,
  createTaskList as createTaskListGraph,
  updateTaskList as updateTaskListGraph,
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
  incrementPendingOpRetry,
  MAX_PENDING_OP_RETRIES,
} from "../api/taskStorage";
import { useNetworkStatus } from "../services/networkMonitor";
import { logger } from "../services/logger";

export const useLists = (accessToken: string | null, db: Database | null, activeAccountId: string | null) => {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [loading, setLoading] = useState(true);

  const isOnline = useNetworkStatus();
  const isOnlineRef = useRef(isOnline);
  const listsRef = useRef<TaskList[]>([]);
  const accessTokenRef = useRef<string | null>(null);
  const dbRef = useRef<Database | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const clearingRef = useRef<Promise<void> | null>(null);
  const syncInProgressRef = useRef(false);
  const syncGenerationRef = useRef(0);

  useEffect(() => { listsRef.current = lists; }, [lists]);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { dbRef.current = db; }, [db]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // Load lists from DB when connection is ready or account changes
  useEffect(() => {
    if (!db) return;
    const init = async () => {
      try {
        const isAccountSwitch = prevAccountIdRef.current !== null && prevAccountIdRef.current !== activeAccountId;
        prevAccountIdRef.current = activeAccountId;

        if (isAccountSwitch) {
          syncGenerationRef.current++;
          syncInProgressRef.current = false;
          listsRef.current = []; // Clear ref immediately so syncLists doesn't re-add stale groups
          setLists([]);
          setLoading(true);
          // clearAllData is called by useTasks on account switch — we just need to
          // wait for it to finish before loading new data. The module-level dedup
          // in taskStorage.ts ensures only one clear actually runs.
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
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    const generation = syncGenerationRef.current;

    // Wait for any in-progress account-switch DB clear to finish
    if (clearingRef.current) await clearingRef.current;

    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!token || !database || !isOnlineRef.current) {
      syncInProgressRef.current = false;
      return;
    }

    try {
      // Process pending list-create ops (lists created while offline)
      const pendingListOps = await getPendingOpsByType(database, "list-create");
      for (const op of pendingListOps) {
        // Bail immediately if account switched while processing
        if (syncGenerationRef.current !== generation) return;

        if (op.id === undefined) {
          logger.warn(`Skipping pending list op without id (opType=${op.opType})`);
          continue;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(op.data);
        } catch (parseErr) {
          logger.warn(`Dropping pending list op (id=${op.id}) — corrupt JSON data`, parseErr);
          await deletePendingOp(database, op.id!);
          continue;
        }
        try {
          const displayName = data.displayName as string;
          const localId = data.id as string;
          const parentGroupId = data.parentGroupId as string | undefined;
          const created = await createTaskListGraph(displayName, token);
          const withGroup = parentGroupId ? { ...created, parentGroupId } : created;
          // Update tasks first so they're never left pointing at a deleted list
          await database.execute("UPDATE tasks SET listId = ? WHERE listId = ?", [created.id, localId]);
          // Now safe to swap the list record
          await deleteListFromDB(database, localId);
          await saveListToDB(database, withGroup);
          setLists((prev) => prev.map((l) => (l.id === localId ? withGroup : l)));
          await deletePendingOp(database, op.id!);
        } catch (err) {
          logger.error(`Failed to sync pending list creation: ${data.displayName}`, err);
          const retries = await incrementPendingOpRetry(database, op.id!);
          if (retries >= MAX_PENDING_OP_RETRIES) {
            logger.warn(`Dropping pending list-create op (id=${op.id}) after ${retries} retries`);
            await deletePendingOp(database, op.id!);
          }
        }
      }

      const remoteLists = await fetchTaskLists(token);

      // Bail if account switched during fetch
      if (syncGenerationRef.current !== generation) return;

      // Merge remote data with local state to preserve isGroup/parentGroupId
      const localById = new Map(listsRef.current.map((l) => [l.id, l]));
      const mergedLists = remoteLists.map((remote: TaskList) => {
        const existing = localById.get(remote.id);
        return {
          ...remote,
          // Beta may provide parentGroupId via linkedGroupId; otherwise keep local value
          parentGroupId: remote.parentGroupId ?? existing?.parentGroupId,
          // Always preserve local isGroup flag (groups are local-only)
          isGroup: existing?.isGroup,
          // Preserve local-only theme customisation
          emoji: existing?.emoji,
          themeColor: existing?.themeColor,
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

      if (syncGenerationRef.current === generation) {
        setLists(allLists);
      }
    } catch (err) {
      if (syncGenerationRef.current === generation) {
        logger.error("Failed to sync lists", err);
      }
    } finally {
      syncInProgressRef.current = false;
    }
  }, []); // Uses refs for all dependencies to avoid re-creating the callback

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
      if (isOnlineRef.current && token) {
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
  }, []);

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
      if (isOnlineRef.current && token) {
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
  }, []);

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

  // Update list emoji/colour
  const updateListTheme = useCallback(async (listId: string, updates: { emoji?: string | null; themeColor?: string | null }) => {
    const database = dbRef.current;
    if (!database) return;

    const list = listsRef.current.find((l) => l.id === listId);
    if (!list) return;

    const updated = {
      ...list,
      emoji: "emoji" in updates ? (updates.emoji ?? undefined) : list.emoji,
      themeColor: "themeColor" in updates ? (updates.themeColor ?? undefined) : list.themeColor,
    };
    setLists((prev) => prev.map((l) => (l.id === listId ? updated : l)));

    try {
      await updateListMeta(database, listId, updates);
    } catch (err) {
      logger.error("Failed to update list theme", err);
      setLists((prev) => prev.map((l) => (l.id === listId ? list : l)));
    }
  }, []);

  // Rename a list or group
  const renameList = useCallback(async (listId: string, newName: string) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database || !newName.trim()) return;

    const list = listsRef.current.find((l) => l.id === listId);
    if (!list) return;

    const trimmed = newName.trim();
    const updated = { ...list, displayName: trimmed };
    setLists((prev) => prev.map((l) => (l.id === listId ? updated : l)));

    try {
      // Sync rename to Graph for non-group, non-local lists
      if (!list.isGroup && !list.id.startsWith("local-") && isOnlineRef.current && token) {
        await updateTaskListGraph(listId, { displayName: trimmed }, token);
      }
      await saveListToDB(database, updated);
    } catch (err) {
      logger.error("Failed to rename list", err);
      setLists((prev) => prev.map((l) => (l.id === listId ? list : l)));
    }
  }, []);

  // Delete a list or group
  const deleteList = useCallback(async (listId: string) => {
    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!database) return;

    const list = listsRef.current.find((l) => l.id === listId);
    if (!list) return;

    // If deleting a group, remember children so we can rollback
    const children = list.isGroup
      ? listsRef.current.filter((l) => l.parentGroupId === listId)
      : [];

    if (list.isGroup && children.length > 0) {
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

    setLists((prev) => prev.filter((l) => l.id !== listId));

    try {
      // Local-only groups don't exist on Graph — just delete from DB
      if (!list.isGroup && isOnlineRef.current && token) {
        await deleteTaskListGraph(listId, token);
      }
      await deleteListFromDB(database, listId);
    } catch (err) {
      logger.error("Failed to delete list", err);
      // Restore the list AND re-parent children on failure
      setLists((prev) => {
        let restored = [...prev, list].sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (children.length > 0) {
          restored = restored.map((l) =>
            children.some((c) => c.id === l.id) ? { ...l, parentGroupId: listId } : l
          );
        }
        return restored;
      });
      // Restore children in DB
      for (const child of children) {
        try {
          await updateListMeta(database, child.id, { parentGroupId: listId });
        } catch { /* best effort */ }
      }
    }
  }, []);

  return {
    lists,
    loading,
    createList,
    createSubList,
    createGroup,
    convertToGroup,
    moveToGroup,
    renameList,
    updateListTheme,
    deleteList,
    syncLists,
    isOnline,
  };
};
