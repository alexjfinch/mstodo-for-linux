import { useState, useEffect, useCallback, useRef } from "react";
import { Task } from "../types";
import Database from "@tauri-apps/plugin-sql";
import {
  createTask as createTaskGraph,
  toggleTaskCompleted as toggleTaskCompletedGraph,
  updateTaskAttributes as updateTaskAttributesGraph,
  deleteTask as deleteTaskGraph,
  fetchAllTasksDelta,
  fetchAssignedTasks,
  resetGraphCaches,
} from "../api/graph";
import {
  loadTasksFromDB,
  insertTaskToDB,
  updateTaskId,
  updateTaskCompletion,
  updateTaskAttributesDB,
  queuePendingOp,
  deleteTaskFromDB,
  saveTaskToDB,
  getPendingOps,
  deletePendingOp,
  getLocalTask,
  loadDeltaTokens,
  saveDeltaTokens,
  clearDeltaTokens,
  clearAllData,
} from "../api/taskStorage";
import { useNetworkStatus } from "../services/networkMonitor";
import { logger } from "../services/logger";

let plannerWarningLogged = false;

export const useTasks = (accessToken: string | null, currentListId: string | null, db: Database | null, activeAccountId: string | null) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const isOnline = useNetworkStatus();
  const tasksRef = useRef<Task[]>([]);
  const accessTokenRef = useRef<string | null>(null);
  const dbRef = useRef<Database | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const clearingRef = useRef<Promise<void> | null>(null);
  // Incremented on account switch — in-flight syncs check this to bail out
  const syncGenerationRef = useRef(0);
  // Prevent overlapping syncs from piling up requests
  const syncInProgressRef = useRef(false);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { dbRef.current = db; }, [db]);

  useEffect(() => {
    if (!db) return;
    const init = async () => {
      const isAccountSwitch = prevAccountIdRef.current !== null && prevAccountIdRef.current !== activeAccountId;
      prevAccountIdRef.current = activeAccountId;

      if (isAccountSwitch) {
        // Invalidate any in-flight sync so it won't write stale data
        syncGenerationRef.current++;
        syncInProgressRef.current = false; // allow fresh sync for new account
        resetGraphCaches();
        setTasks([]);
        setLoading(true);
        // Clear DB independently — useLists does the same, but we can't
        // guarantee execution order between hooks.
        // Store the promise so syncWithGraph can await it.
        const clearing = clearAllData(db);
        clearingRef.current = clearing;
        await clearing;
        clearingRef.current = null;
      }

      try {
        const localTasks = await loadTasksFromDB(db);
        setTasks(localTasks);
        setLoading(false);
      } catch (err) {
        logger.error("Failed to load tasks from database", err);
        setLoading(false);
      }
    };
    init();
  }, [db, activeAccountId]);

  const processPendingOps = useCallback(async () => {
    const token = accessTokenRef.current;
    const database = dbRef.current;
    if (!token || !database) return;

    const ops = await getPendingOps(database);
    if (ops.length === 0) return;

    for (const op of ops) {
      const data = JSON.parse(op.data);
      try {
        if (op.opType === "create") {
          const created = await createTaskGraph(data.title, data.listId, token);
          await updateTaskId(database, data.id, created.id, Date.now());
          setTasks((prev) =>
            prev.map((t) => (t.id === data.id ? { ...created, lastModified: Date.now() } : t))
          );
        } else if (op.opType === "toggle" && op.taskId) {
          // Last-write-wins: only apply if local change is newer than server
          const localTask = await getLocalTask(database, op.taskId);
          if (localTask && localTask.lastModified && localTask.lastModified >= op.createdAt) {
            const task = tasksRef.current.find((t) => t.id === op.taskId);
            if (task) await toggleTaskCompletedGraph(task, token);
          }
        } else if (op.opType === "update" && op.taskId) {
          const localTask = await getLocalTask(database, op.taskId);
          if (localTask && localTask.lastModified && localTask.lastModified >= op.createdAt) {
            const task = tasksRef.current.find((t) => t.id === op.taskId);
            if (task) await updateTaskAttributesGraph(task, data, token);
          }
        } else if (op.opType === "delete" && op.taskId) {
          await deleteTaskGraph(op.taskId, data.listId, token);
        }
        await deletePendingOp(database, op.id!);
      } catch (err) {
        logger.error(`Failed to sync pending operation: ${op.opType}`, err);
      }
    }
  }, []);

  // Delta sync: only fetch what changed since last sync.
  // Falls back to a full snapshot when no delta tokens are stored (first run).
  const syncWithGraph = useCallback(async () => {
    // Skip if another sync is already running — prevents request pile-up
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;

    // Wait for any in-progress account-switch DB clear to finish
    if (clearingRef.current) await clearingRef.current;

    // Capture generation so we can detect if account switched mid-sync
    const generation = syncGenerationRef.current;

    const token = accessTokenRef.current;
    const database = dbRef.current;

    if (!token || !database || !isOnline) {
      syncInProgressRef.current = false;
      return;
    }

    setSyncing(true);
    setSyncError(null);
    try {
      await processPendingOps();

      // Bail if account switched while processing pending ops
      if (syncGenerationRef.current !== generation) return;

      const deltaTokens = await loadDeltaTokens(database);

      let deltaResult;
      try {
        const [delta, assignedTasks] = await Promise.all([
          fetchAllTasksDelta(token, deltaTokens),
          fetchAssignedTasks(token).catch((err) => {
            if (!plannerWarningLogged) {
              logger.warn("Failed to fetch assigned tasks (Planner may not be available for this account)", err);
              plannerWarningLogged = true;
            }
            return [] as Task[];
          }),
        ]);
        deltaResult = { delta, assignedTasks };
      } catch (err: any) {
        // Delta token expired or invalid — clear tokens and do a full sync
        if (err?.response?.status === 410) {
          logger.warn("Delta token expired, performing full sync");
          await clearDeltaTokens(database);
          const [delta, assignedTasks] = await Promise.all([
            fetchAllTasksDelta(token, {}),
            fetchAssignedTasks(token).catch((err) => {
              if (!plannerWarningLogged) {
                logger.warn("Failed to fetch assigned tasks (Planner may not be available for this account)", err);
                plannerWarningLogged = true;
              }
              return [] as Task[];
            }),
          ]);
          deltaResult = { delta, assignedTasks };
        } else {
          throw err;
        }
      }

      // Bail if account switched during the fetch
      if (syncGenerationRef.current !== generation) return;

      const { delta, assignedTasks } = deltaResult;
      const localTasks = await loadTasksFromDB(database);
      const localMap = new Map<string, Task>();
      for (const t of localTasks) localMap.set(t.id, t);

      const hasPreviousTokens = Object.keys(deltaTokens).length > 0;

      if (!hasPreviousTokens) {
        // First sync (full snapshot from delta): rebuild from remote
        const merged: Task[] = [];
        const seenIds = new Set<string>();

        for (const change of delta.changes) {
          if (change.removed) continue;
          seenIds.add(change.task.id);
          const local = localMap.get(change.task.id);

          if (local && local.lastModified && change.task.lastModified &&
              local.lastModified > change.task.lastModified) {
            merged.push(local);
            try {
              await updateTaskAttributesGraph(local, {
                title: local.title,
                importance: local.importance,
                dueDateTime: local.dueDateTime,
                body: local.body,
                recurrence: local.recurrence,
                categories: local.categories,
              }, token);
            } catch (pushErr) {
              logger.warn(`Failed to push local changes for ${local.id}`, pushErr);
            }
          } else {
            merged.push(change.task);
            await saveTaskToDB(database, change.task);
          }
        }

        // Assigned (Planner) tasks
        for (const assigned of assignedTasks) {
          seenIds.add(assigned.id);
          merged.push(assigned);
          await saveTaskToDB(database, assigned);
        }

        // Remove stale assigned tasks
        const assignedIds = new Set(assignedTasks.map(t => t.id));
        for (const local of localTasks) {
          if (local.listId === "__assigned__" && !assignedIds.has(local.id)) {
            await deleteTaskFromDB(database, local.id);
          }
        }

        // Keep unsynced local-only tasks
        for (const local of localTasks) {
          if (!seenIds.has(local.id) && local.id.startsWith("local-")) {
            merged.push(local);
          }
        }

        // Only apply results if account hasn't switched
        if (syncGenerationRef.current === generation) {
          setTasks(merged);
        }
      } else {
        // Incremental delta: apply only changes
        if (syncGenerationRef.current === generation) {
          setTasks((prev) => {
            const taskMap = new Map(prev.map(t => [t.id, t]));

            for (const change of delta.changes) {
              if (change.removed) {
                taskMap.delete(change.task.id);
              } else {
                const local = taskMap.get(change.task.id);
                if (local && local.lastModified && change.task.lastModified &&
                    local.lastModified > change.task.lastModified) {
                  // Local is newer — keep it (pending ops will push it)
                } else {
                  taskMap.set(change.task.id, change.task);
                }
              }
            }

            // Update assigned tasks
            const assignedIds = new Set(assignedTasks.map(t => t.id));
            // Remove stale assigned
            for (const [id, t] of taskMap) {
              if (t.listId === "__assigned__" && !assignedIds.has(id)) {
                taskMap.delete(id);
              }
            }
            for (const assigned of assignedTasks) {
              taskMap.set(assigned.id, assigned);
            }

            return Array.from(taskMap.values());
          });
        }

        // Persist changes to DB only if still on same account
        if (syncGenerationRef.current === generation) {
          for (const change of delta.changes) {
            if (change.removed) {
              await deleteTaskFromDB(database, change.task.id);
            } else {
              await saveTaskToDB(database, change.task);
            }
          }
          for (const assigned of assignedTasks) {
            await saveTaskToDB(database, assigned);
          }
        }
      }

      // Persist new delta tokens only if still on same account
      if (syncGenerationRef.current === generation) {
        await saveDeltaTokens(database, delta.newDeltaTokens);
        setLastSyncTime(new Date());
      }
    } catch (err) {
      // Don't report errors from stale syncs
      if (syncGenerationRef.current !== generation) return;
      const axiosErr = err as any;
      const detail = axiosErr?.response
        ? `${axiosErr.response.status} ${axiosErr.response.statusText}: ${JSON.stringify(axiosErr.response.data)}`
        : undefined;
      logger.error("Sync failed" + (detail ? ` — ${detail}` : ""), err);
      setSyncError(detail || (err instanceof Error ? err.message : "Unknown sync error"));
    } finally {
      syncInProgressRef.current = false;
      if (syncGenerationRef.current === generation) {
        setSyncing(false);
      }
    }
  }, [isOnline, processPendingOps]);

  const addTask = useCallback(async (title: string, listId?: string, attributes?: Partial<Task>) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database || !title.trim()) return;

    const targetListId = listId || currentListId;
    if (!targetListId) {
      logger.error("Cannot add task: no list selected");
      return;
    }

    const tempId = `local-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    const newTask: Task = {
      id: tempId,
      listId: targetListId,
      title: title.trim(),
      completed: false,
      lastModified: timestamp,
      status: "notStarted",
      ...attributes,
    };

    setTasks((prev) => [...prev, newTask]);

    try {
      if (isOnline && token) {
        const [graphResult] = await Promise.allSettled([
          createTaskGraph(title.trim(), targetListId, token),
          insertTaskToDB(database, tempId, targetListId, title.trim(), timestamp),
        ]);

        if (graphResult.status === "fulfilled") {
          let created = graphResult.value;
          if (attributes && Object.keys(attributes).length > 0) {
            try {
              created = await updateTaskAttributesGraph(created, attributes, token);
            } catch (attrErr) {
              logger.warn("Failed to set task attributes", attrErr);
            }
          }
          await updateTaskId(database, tempId, created.id, Date.now());
          setTasks((prev) =>
            prev.map((t) =>
              t.id === tempId ? { ...created, ...attributes, lastModified: Date.now() } : t
            )
          );
        } else {
          await queuePendingOp(database, tempId, "create", newTask);
        }
      } else {
        await insertTaskToDB(database, tempId, targetListId, title.trim(), timestamp);
        await queuePendingOp(database, tempId, "create", newTask);
      }
    } catch (err) {
      logger.error("Failed to add task", err);
      setTasks((prev) => prev.filter((t) => t.id !== tempId));
    }
  }, [isOnline, currentListId]);

  const toggleTask = useCallback(async (id: string) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database) return;

    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;

    const timestamp = Date.now();
    const updated = { ...task, completed: !task.completed, lastModified: timestamp };

    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));

    try {
      if (isOnline && token) {
        const results = await Promise.allSettled([
          toggleTaskCompletedGraph(updated, token),
          updateTaskCompletion(database, id, updated.completed, timestamp),
        ]);
        if (results[0].status === "rejected") {
          await queuePendingOp(database, id, "toggle", { completed: updated.completed });
        }
      } else {
        await updateTaskCompletion(database, id, updated.completed, timestamp);
        await queuePendingOp(database, id, "toggle", { completed: updated.completed });
      }
    } catch (err) {
      logger.error("Failed to toggle task", err);
      setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
    }
  }, [isOnline]);

  const updateAttributes = useCallback(async (id: string, attributes: Partial<Task>) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database) return;

    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;

    const timestamp = Date.now();
    const updated = { ...task, ...attributes, lastModified: timestamp };

    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));

    try {
      if (isOnline && token) {
        const results = await Promise.allSettled([
          updateTaskAttributesGraph(task, attributes, token),
          updateTaskAttributesDB(database, id, attributes, timestamp),
        ]);
        if (results[0].status === "rejected") {
          await queuePendingOp(database, id, "update", attributes);
        }
      } else {
        await updateTaskAttributesDB(database, id, attributes, timestamp);
        await queuePendingOp(database, id, "update", attributes);
      }
    } catch (err) {
      logger.error("Failed to update task attributes", err);
      setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
    }
  }, [isOnline]);

  const deleteTask = useCallback(async (id: string) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database) return;

    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || !task.listId) return;

    setTasks((prev) => prev.filter((t) => t.id !== id));

    try {
      if (isOnline && token) {
        const results = await Promise.allSettled([
          deleteTaskGraph(task.id, task.listId, token),
          deleteTaskFromDB(database, id),
        ]);
        if (results[0].status === "rejected") {
          await queuePendingOp(database, id, "delete", { id, listId: task.listId });
        }
      } else {
        await deleteTaskFromDB(database, id);
        await queuePendingOp(database, id, "delete", { id, listId: task.listId });
      }
    } catch (err) {
      logger.error("Failed to delete task", err);
      setTasks((prev) => [...prev, task]);
    }
  }, [isOnline]);

  return {
    tasks,
    loading,
    addTask,
    toggleTask,
    updateAttributes,
    deleteTask,
    syncWithGraph,
    isOnline,
    syncing,
    syncError,
    lastSyncTime,
  };
};
