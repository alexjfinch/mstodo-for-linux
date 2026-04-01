import { useState, useEffect, useCallback, useRef } from "react";
import { Task } from "../types";
import axios from "axios";
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
  updateTaskListId,
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
  clearMyDayFlags,
  updatePendingOpsTaskId,
  incrementPendingOpRetry,
  MAX_PENDING_OP_RETRIES,
} from "../api/taskStorage";
import { useNetworkStatus } from "../services/networkMonitor";
import { logger } from "../services/logger";

// Reset per account via syncGenerationRef — not a module-level flag

type DroppedOpInfo = { opType: string; taskId: string | null };

export const useTasks = (accessToken: string | null, currentListId: string | null, db: Database | null, activeAccountId: string | null, onDroppedPendingOp?: (info: DroppedOpInfo) => void) => {
  const currentListIdRef = useRef(currentListId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const isOnline = useNetworkStatus();
  const isOnlineRef = useRef(isOnline);
  const tasksRef = useRef<Task[]>([]);
  const accessTokenRef = useRef<string | null>(null);
  const dbRef = useRef<Database | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const clearingRef = useRef<Promise<void> | null>(null);
  // Incremented on account switch — in-flight syncs check this to bail out
  const syncGenerationRef = useRef(0);
  // Prevent overlapping syncs from piling up requests
  const syncInProgressRef = useRef(false);
  // AbortController for cancelling in-flight requests on account switch
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track whether the planner (Assigned to Me) warning has been logged for this account
  const plannerWarningLoggedRef = useRef(false);
  const [plannerError, setPlannerError] = useState(false);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { dbRef.current = db; }, [db]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { currentListIdRef.current = currentListId; }, [currentListId]);

  useEffect(() => {
    if (!db) return;
    const init = async () => {
      const isAccountSwitch = prevAccountIdRef.current !== null && prevAccountIdRef.current !== activeAccountId;
      prevAccountIdRef.current = activeAccountId;

      if (isAccountSwitch) {
        // Invalidate any in-flight sync so it won't write stale data
        syncGenerationRef.current++;
        // Cancel in-flight HTTP requests from the previous sync and wait
        // for the abort to propagate before clearing data
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        syncInProgressRef.current = false; // allow fresh sync for new account
        plannerWarningLoggedRef.current = false; // reset per-account warning
        setPlannerError(false);
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
        // If DB has no tasks but delta tokens exist, clear them now so the
        // first sync does a full fetch instead of a no-op delta.
        if (localTasks.length === 0) {
          const deltaTokens = await loadDeltaTokens(db);
          if (Object.keys(deltaTokens).length > 0) {
            logger.info("Init: DB empty but delta tokens exist — clearing for full sync");
            await clearDeltaTokens(db);
          }
        }
        setTasks(localTasks);
        setLoading(false);
      } catch (err) {
        logger.error("Failed to load tasks from database", err);
        setLoading(false);
      }
    };
    init();
  }, [db, activeAccountId]);

  const processPendingOps = useCallback(async (generation: number) => {
    const token = accessTokenRef.current;
    const database = dbRef.current;
    if (!token || !database) return;

    const ops = await getPendingOps(database);
    if (ops.length === 0) return;

    for (const op of ops) {
      // Bail if account switched while processing
      if (syncGenerationRef.current !== generation) return;

      if (op.id === undefined) {
        logger.warn(`Skipping pending op without id (opType=${op.opType})`);
        continue;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(op.data);
      } catch (parseErr) {
        logger.warn(`Dropping pending op ${op.opType} (id=${op.id}) — corrupt JSON data`, parseErr);
        await deletePendingOp(database, op.id!);
        continue;
      }
      try {
        if (op.opType === "create") {
          if (typeof data.title !== "string" || typeof data.listId !== "string" || typeof data.id !== "string") {
            logger.warn(`Dropping create op (id=${op.id}) — data missing required fields: title, listId, or id`);
            await deletePendingOp(database, op.id!);
            continue;
          }
          const created = await createTaskGraph(data.title, data.listId, token);
          await updateTaskId(database, data.id, created.id, Date.now());
          // Remap any other pending ops that reference the old local ID
          await updatePendingOpsTaskId(database, data.id as string, created.id);
          // Also remap in-memory ops so subsequent iterations use the new ID
          for (const pending of ops) {
            if (pending.taskId === data.id) pending.taskId = created.id;
          }
          setTasks((prev) =>
            prev.map((t) => (t.id === (data.id as string) ? { ...created, lastModified: Date.now() } : t))
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
        } else if (op.opType === "move" && op.taskId) {
          if (typeof data.title !== "string" || typeof data.targetListId !== "string" || typeof data.oldListId !== "string") {
            logger.warn(`Dropping move op (id=${op.id}) — data missing required fields: title, targetListId, or oldListId`);
            await deletePendingOp(database, op.id!);
            continue;
          }
          // Replay the move: create on target, copy attributes, delete from source
          const created = await createTaskGraph(data.title, data.targetListId, token);
          const taskData = data.task !== null && typeof data.task === "object"
            ? data.task as Partial<Task>
            : undefined;
          if (taskData && (taskData.importance !== "normal" || taskData.dueDateTime || taskData.body || taskData.recurrence || taskData.categories?.length)) {
            await updateTaskAttributesGraph(created, {
              importance: taskData.importance,
              dueDateTime: taskData.dueDateTime,
              body: taskData.body,
              recurrence: taskData.recurrence,
              categories: taskData.categories,
              isInMyDay: taskData.isInMyDay,
            }, token);
          }
          await deleteTaskGraph(op.taskId, data.oldListId, token);
          await updateTaskId(database, op.taskId, created.id, Date.now());
          await updatePendingOpsTaskId(database, op.taskId, created.id);
          for (const pending of ops) {
            if (pending.taskId === op.taskId) pending.taskId = created.id;
          }
          setTasks((prev) =>
            prev.map((t) => (t.id === op.taskId ? { ...t, id: created.id, listId: data.targetListId as string } : t))
          );
        } else if (op.opType === "delete" && op.taskId) {
          if (typeof data.listId !== "string") {
            logger.warn(`Dropping delete op (id=${op.id}) — data missing required field: listId`);
            await deletePendingOp(database, op.id!);
            continue;
          }
          await deleteTaskGraph(op.taskId, data.listId, token);
        }
        await deletePendingOp(database, op.id!);
      } catch (err) {
        logger.error(`Failed to sync pending operation: ${op.opType}`, err);
        // Increment retry count; drop the op after too many failures
        const retries = await incrementPendingOpRetry(database, op.id!);
        if (retries >= MAX_PENDING_OP_RETRIES) {
          logger.warn(`Dropping pending op ${op.opType} (id=${op.id}) after ${retries} retries`);
          await deletePendingOp(database, op.id!);
          onDroppedPendingOp?.({ opType: op.opType, taskId: op.taskId });
        }
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

    if (!token || !database || !isOnlineRef.current) {
      syncInProgressRef.current = false;
      return;
    }

    // Create a new AbortController for this sync so in-flight requests can be
    // cancelled immediately when the user switches accounts.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setSyncing(true);
    setSyncError(null);
    try {
      await processPendingOps(generation);

      // Bail if account switched while processing pending ops
      if (syncGenerationRef.current !== generation) return;

      let deltaTokens = await loadDeltaTokens(database);

      // If we have delta tokens but no tasks in DB, the tokens are stale
      // (e.g. DB was recreated). Clear them to force a full initial sync.
      if (Object.keys(deltaTokens).length > 0) {
        const existingTasks = await loadTasksFromDB(database);
        if (existingTasks.length === 0) {
          logger.info("Delta tokens exist but DB has no tasks — clearing tokens for full sync");
          await clearDeltaTokens(database);
          deltaTokens = {};
        }
      }

      let deltaResult;
      try {
        const [delta, assignedTasks] = await Promise.all([
          fetchAllTasksDelta(token, deltaTokens, signal),
          fetchAssignedTasks(token, signal).catch((err) => {
            if (signal.aborted) throw err; // propagate cancellation
            if (!plannerWarningLoggedRef.current) {
              logger.warn("Failed to fetch assigned tasks (Planner may not be available for this account)", err);
              plannerWarningLoggedRef.current = true;
            }
            setPlannerError(true);
            return [] as Task[];
          }),
        ]);
        deltaResult = { delta, assignedTasks };
      } catch (err: unknown) {
        // Propagate cancellation so the outer catch's generation check can handle it cleanly
        if (signal.aborted) throw err;
        // Delta token expired or invalid — clear tokens and do a full sync
        if (axios.isAxiosError(err) && err.response?.status === 410) {
          logger.warn("Delta token expired, performing full sync");
          await clearDeltaTokens(database);
          const [delta, assignedTasks] = await Promise.all([
            fetchAllTasksDelta(token, {}, signal),
            fetchAssignedTasks(token, signal).catch((err) => {
              if (signal.aborted) throw err;
              if (!plannerWarningLoggedRef.current) {
                logger.warn("Failed to fetch assigned tasks (Planner may not be available for this account)", err);
                plannerWarningLoggedRef.current = true;
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
      logger.info(`Delta sync returned ${delta.changes.length} changes, ${Object.keys(delta.newDeltaTokens).length} tokens, ${assignedTasks.length} assigned tasks`);
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

          if (local && typeof local.lastModified === "number" && typeof change.task.lastModified === "number" &&
              local.lastModified > change.task.lastModified) {
            merged.push(local);
            try {
              await updateTaskAttributesGraph(local, {
                title: local.title,
                importance: local.importance,
                dueDateTime: local.dueDateTime,
                reminderDateTime: local.reminderDateTime,
                body: local.body,
                recurrence: local.recurrence,
                categories: local.categories,
                // isInMyDay omitted — My Day is local-only, not synced to Graph
              }, token);
            } catch (pushErr) {
              logger.warn(`Failed to push local changes for ${local.id}`, pushErr);
            }
          } else {
            // Preserve local My Day state — isInMyDay is local-only, never overwritten by Graph
            const taskToMerge = { ...change.task, isInMyDay: local?.isInMyDay ?? false };
            merged.push(taskToMerge);
            await saveTaskToDB(database, taskToMerge);
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
                if (local && typeof local.lastModified === "number" && typeof change.task.lastModified === "number" &&
                    local.lastModified > change.task.lastModified) {
                  // Local is newer — keep it (pending ops will push it)
                } else {
                  // Preserve local My Day state — isInMyDay is local-only, never overwritten by Graph
                  taskMap.set(change.task.id, { ...change.task, isInMyDay: local?.isInMyDay ?? false });
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
              const local = localMap.get(change.task.id);
              if (local && typeof local.lastModified === "number" && typeof change.task.lastModified === "number" &&
                  local.lastModified > change.task.lastModified) {
                // Local is newer — skip DB overwrite to preserve local changes (e.g. My Day clear)
              } else {
                // Preserve local My Day state — isInMyDay is local-only, never overwritten by Graph
                await saveTaskToDB(database, { ...change.task, isInMyDay: local?.isInMyDay ?? false });
              }
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
      const axiosErr = err as { response?: { status: number; statusText: string; data: unknown } };
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
  }, [processPendingOps]);

  const addTask = useCallback(async (title: string, listId?: string, attributes?: Partial<Task>) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database || !title.trim()) return;

    const targetListId = listId || currentListIdRef.current;
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
      if (isOnlineRef.current && token) {
        const [graphResult, dbResult] = await Promise.allSettled([
          createTaskGraph(title.trim(), targetListId, token),
          insertTaskToDB(database, tempId, targetListId, title.trim(), timestamp),
        ]);
        if (dbResult.status === "rejected") {
          logger.warn("Failed to insert new task to local DB", dbResult.reason);
        }

        if (graphResult.status === "fulfilled") {
          let created = graphResult.value;
          if (attributes && Object.keys(attributes).length > 0) {
            try {
              created = await updateTaskAttributesGraph(created, attributes, token);
            } catch (attrErr) {
              logger.warn("Failed to set task attributes", attrErr);
            }
          }
          try {
            await updateTaskId(database, tempId, created.id, Date.now());
            setTasks((prev) =>
              prev.map((t) =>
                t.id === tempId ? { ...created, lastModified: Date.now() } : t
              )
            );
          } catch (idErr) {
            // DB record still has tempId; queue a pending op so the next sync
            // will reconcile the local record with the server-created task.
            logger.warn("Failed to update task ID in DB — queuing pending op", idErr);
            await queuePendingOp(database, tempId, "create", newTask).catch((qErr) => {
              logger.error("Failed to queue pending op after ID update failure", qErr);
            });
          }
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
  }, []);

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
      if (isOnlineRef.current && token) {
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
  }, []);

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
      if (isOnlineRef.current && token) {
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
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database) return;

    const task = tasksRef.current.find((t) => t.id === id);
    if (!task || !task.listId) return;

    setTasks((prev) => prev.filter((t) => t.id !== id));

    try {
      if (isOnlineRef.current && token) {
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
  }, []);

  const moveTaskToList = useCallback(async (taskId: string, targetListId: string) => {
    const database = dbRef.current;
    const token = accessTokenRef.current;
    if (!database) return;

    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task || task.listId === targetListId) return;

    const oldListId = task.listId;
    const updated = { ...task, listId: targetListId, lastModified: Date.now() };

    // Optimistic UI update
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));

    try {
      // Update locally
      await updateTaskListId(database, taskId, targetListId, Date.now());

      // Sync via Graph: create on target list, then delete from source.
      // If create succeeds but delete fails, we clean up the created task.
      const queueMoveOp = () => queuePendingOp(database, taskId, "move", { oldListId, targetListId, title: task.title, task });
      if (isOnlineRef.current && token && oldListId && !taskId.startsWith("local-") && !oldListId.startsWith("local-")) {
        let created: Task | null = null;
        try {
          created = await createTaskGraph(task.title, targetListId, token);
          // Copy attributes to the new task
          if (task.importance !== "normal" || task.dueDateTime || task.body || task.recurrence || task.categories?.length) {
            await updateTaskAttributesGraph(created, {
              importance: task.importance,
              dueDateTime: task.dueDateTime,
              body: task.body,
              recurrence: task.recurrence,
              categories: task.categories,
              isInMyDay: task.isInMyDay,
            }, token);
          }
          // Delete from source — if this fails, roll back the created task
          try {
            await deleteTaskGraph(taskId, oldListId, token);
          } catch (deleteErr) {
            // Roll back: delete the newly created task to prevent duplicates
            logger.warn("Delete from source failed during move — rolling back created task", deleteErr);
            await deleteTaskGraph(created.id, targetListId, token).catch(() => {});
            throw deleteErr;
          }
          // Update local ID to match the new server task
          if (created) {
            const newId = created.id;
            await updateTaskId(database, taskId, newId, Date.now());
            setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...updated, id: newId } : t)));
          }
        } catch (err) {
          logger.warn("Failed to move task on Graph — will sync on next cycle", err);
          await queueMoveOp();
        }
      } else if (!isOnlineRef.current && oldListId && !taskId.startsWith("local-")) {
        await queueMoveOp();
      }
    } catch (err) {
      logger.error("Failed to move task to list", err);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)));
    }
  }, []);

  const clearMyDay = useCallback(async () => {
    const database = dbRef.current;
    const now = Date.now();
    if (database) await clearMyDayFlags(database, now);
    setTasks((prev) => prev.map((t) => t.isInMyDay ? { ...t, isInMyDay: false, lastModified: now } : t));
  }, []);

  return {
    tasks,
    loading,
    addTask,
    toggleTask,
    updateAttributes,
    deleteTask,
    moveTaskToList,
    syncWithGraph,
    clearMyDay,
    isOnline,
    syncing,
    syncError,
    lastSyncTime,
    plannerError,
  };
};
