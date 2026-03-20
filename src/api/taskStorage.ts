import Database from "@tauri-apps/plugin-sql";
import { Task, TaskList } from "../types";

export interface PendingOperation {
  id?: number;
  taskId: string | null;
  opType: "create" | "toggle" | "update" | "delete" | "move" | "list-create";
  data: string;
  createdAt: number;
  retryCount?: number;
}

export const MAX_PENDING_OP_RETRIES = 5;

export async function initializeTables(db: Database): Promise<void> {
  // Disable FK enforcement — offline task creation may reference local-xxx list IDs
  // that don't yet exist in the lists table. The app manages referential integrity
  // at the application level (via sync and pending ops).
  await db.execute(`PRAGMA foreign_keys = OFF;`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      isOwner INTEGER,
      isShared INTEGER,
      wellknownListName TEXT,
      isGroup INTEGER DEFAULT 0,
      parentGroupId TEXT,
      emoji TEXT,
      themeColor TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      listId TEXT,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL,
      status TEXT,
      isInMyDay INTEGER,
      importance TEXT,
      dueDateTime TEXT,
      body TEXT,
      recurrence TEXT,
      categories TEXT,
      reminderDateTime TEXT,
      hasAttachments INTEGER DEFAULT 0,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(listId) REFERENCES lists(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pendingOps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT,
      opType TEXT,
      data TEXT,
      createdAt INTEGER,
      retryCount INTEGER DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS deltaTokens (
      listId TEXT PRIMARY KEY,
      deltaLink TEXT NOT NULL
    );
  `);

  // Indexes for common query patterns
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_listId ON tasks(listId);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pendingOps_taskId_opType ON pendingOps(taskId, opType);`);
}

/** Safely parse JSON, returning undefined on invalid/corrupt data instead of throwing. */
function safeJsonParse<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

type ListRow = {
  id: string; displayName: string; isOwner: number; isShared: number;
  wellknownListName: TaskList["wellknownListName"] | null; isGroup: number;
  parentGroupId: string | null; emoji: string | null; themeColor: string | null;
};

export async function loadListsFromDB(db: Database): Promise<TaskList[]> {
  const rows = await db.select<ListRow[]>("SELECT * FROM lists");
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    isOwner: !!r.isOwner,
    isShared: !!r.isShared,
    wellknownListName: r.wellknownListName || undefined,
    isGroup: r.isGroup === 1 ? true : undefined,
    parentGroupId: r.parentGroupId || undefined,
    emoji: r.emoji || undefined,
    themeColor: r.themeColor || undefined,
  }));
}

export async function saveListToDB(db: Database, list: TaskList): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO lists
      (id, displayName, isOwner, isShared, wellknownListName, isGroup, parentGroupId, emoji, themeColor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      list.id,
      list.displayName,
      list.isOwner ? 1 : 0,
      list.isShared ? 1 : 0,
      list.wellknownListName || null,
      list.isGroup ? 1 : 0,
      list.parentGroupId || null,
      list.emoji || null,
      list.themeColor || null,
    ]
  );
}

export async function deleteListFromDB(db: Database, listId: string): Promise<void> {
  await db.execute("DELETE FROM lists WHERE id = ?", [listId]);
}

export async function updateListMeta(
  db: Database,
  listId: string,
  meta: { isGroup?: boolean; parentGroupId?: string | null; emoji?: string | null; themeColor?: string | null }
): Promise<void> {
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if ("isGroup" in meta) {
    updates.push("isGroup = ?");
    values.push(meta.isGroup ? 1 : 0);
  }
  if ("parentGroupId" in meta) {
    updates.push("parentGroupId = ?");
    values.push(meta.parentGroupId || null);
  }
  if ("emoji" in meta) {
    updates.push("emoji = ?");
    values.push(meta.emoji || null);
  }
  if ("themeColor" in meta) {
    updates.push("themeColor = ?");
    values.push(meta.themeColor || null);
  }

  if (updates.length === 0) return;
  values.push(listId);

  await db.execute(
    `UPDATE lists SET ${updates.join(", ")} WHERE id = ?`,
    values
  );
}

type TaskRow = {
  id: string; listId: string; title: string; completed: number;
  status: Task["status"]; isInMyDay: number; importance: string;
  dueDateTime: string | null; body: string | null; recurrence: string | null;
  categories: string | null; reminderDateTime: string | null;
  hasAttachments: number; updatedAt: number;
};

export async function loadTasksFromDB(db: Database): Promise<Task[]> {
  const rows = await db.select<TaskRow[]>("SELECT * FROM tasks");
  return rows.map((r) => ({
    id: r.id,
    listId: r.listId,
    title: r.title,
    completed: !!r.completed,
    status: r.status || "notStarted",
    isInMyDay: !!r.isInMyDay,
    importance: (r.importance as Task["importance"]) || "normal",
    dueDateTime: safeJsonParse(r.dueDateTime),
    body: safeJsonParse(r.body),
    recurrence: safeJsonParse(r.recurrence),
    categories: safeJsonParse(r.categories),
    reminderDateTime: safeJsonParse(r.reminderDateTime),
    hasAttachments: !!r.hasAttachments,
    lastModified: r.updatedAt,
  }));
}

export async function saveTaskToDB(db: Database, task: Task): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO tasks
      (id, listId, title, completed, status, isInMyDay, importance, dueDateTime, body, recurrence, categories, reminderDateTime, hasAttachments, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.listId || null,
      task.title,
      task.completed ? 1 : 0,
      task.status,
      task.isInMyDay ? 1 : 0,
      task.importance || "normal",
      task.dueDateTime ? JSON.stringify(task.dueDateTime) : null,
      task.body ? JSON.stringify(task.body) : null,
      task.recurrence ? JSON.stringify(task.recurrence) : null,
      task.categories ? JSON.stringify(task.categories) : null,
      task.reminderDateTime ? JSON.stringify(task.reminderDateTime) : null,
      task.hasAttachments ? 1 : 0,
      task.lastModified || Date.now(),
    ]
  );
}

export async function insertTaskToDB(
  db: Database,
  id: string,
  listId: string,
  title: string,
  timestamp: number
): Promise<void> {
  await db.execute(
    `INSERT INTO tasks (id, listId, title, completed, status, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, listId, title, 0, "notStarted", timestamp]
  );
}

export async function updateTaskId(
  db: Database,
  oldId: string,
  newId: string,
  timestamp: number
): Promise<void> {
  await db.execute("UPDATE tasks SET id = ?, updatedAt = ? WHERE id = ?", [newId, timestamp, oldId]);
}

export async function updateTaskCompletion(
  db: Database,
  id: string,
  completed: boolean,
  timestamp: number
): Promise<void> {
  await db.execute("UPDATE tasks SET completed = ?, updatedAt = ? WHERE id = ?", [
    completed ? 1 : 0,
    timestamp,
    id,
  ]);
}

export async function updateTaskAttributesDB(
  db: Database,
  id: string,
  attributes: Partial<Task>,
  timestamp: number
): Promise<void> {
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if ("isInMyDay" in attributes)   { updates.push("isInMyDay = ?");   values.push(attributes.isInMyDay ? 1 : 0); }
  if ("importance" in attributes)  { updates.push("importance = ?");  values.push(attributes.importance || "normal"); }
  if ("dueDateTime" in attributes) { updates.push("dueDateTime = ?"); values.push(attributes.dueDateTime ? JSON.stringify(attributes.dueDateTime) : null); }
  if ("title" in attributes)       { updates.push("title = ?");       values.push(attributes.title || ""); }
  if ("body" in attributes)        { updates.push("body = ?");        values.push(attributes.body ? JSON.stringify(attributes.body) : null); }
  if ("recurrence" in attributes)  { updates.push("recurrence = ?");  values.push(attributes.recurrence ? JSON.stringify(attributes.recurrence) : null); }
  if ("categories" in attributes)  { updates.push("categories = ?");  values.push(attributes.categories ? JSON.stringify(attributes.categories) : null); }
  if ("reminderDateTime" in attributes) { updates.push("reminderDateTime = ?"); values.push(attributes.reminderDateTime ? JSON.stringify(attributes.reminderDateTime) : null); }
  if ("hasAttachments" in attributes) { updates.push("hasAttachments = ?"); values.push(attributes.hasAttachments ? 1 : 0); }

  if (updates.length === 0) return;

  updates.push("updatedAt = ?");
  values.push(timestamp);
  values.push(id);

  await db.execute(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, values);
}

export async function updateTaskListId(
  db: Database,
  id: string,
  listId: string,
  timestamp: number
): Promise<void> {
  await db.execute("UPDATE tasks SET listId = ?, updatedAt = ? WHERE id = ?", [listId, timestamp, id]);
}

export async function deleteTaskFromDB(db: Database, id: string): Promise<void> {
  await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
}

export async function getLocalTask(db: Database, id: string): Promise<Task | null> {
  const rows = await db.select<TaskRow[]>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    listId: r.listId,
    title: r.title,
    completed: !!r.completed,
    status: r.status || "notStarted",
    isInMyDay: !!r.isInMyDay,
    importance: (r.importance as Task["importance"]) || "normal",
    dueDateTime: safeJsonParse(r.dueDateTime),
    body: safeJsonParse(r.body),
    recurrence: safeJsonParse(r.recurrence),
    categories: safeJsonParse(r.categories),
    reminderDateTime: safeJsonParse(r.reminderDateTime),
    hasAttachments: !!r.hasAttachments,
    lastModified: r.updatedAt,
  };
}

/**
 * Enqueues a pending operation, deduplicating update/toggle ops for the same task
 * so only the most recent edit is kept when multiple offline changes stack up.
 */
export async function queuePendingOp(
  db: Database,
  taskId: string | null,
  opType: PendingOperation["opType"],
  data: Record<string, unknown>
): Promise<void> {
  if (taskId && (opType === "update" || opType === "toggle" || opType === "move")) {
    await db.execute(
      "DELETE FROM pendingOps WHERE taskId = ? AND opType = ?",
      [taskId, opType]
    );
  }
  // Deleting a task that was created offline — cancel the create and skip the delete
  if (taskId && opType === "delete") {
    const existing = await db.select<{ id: number }[]>(
      "SELECT id FROM pendingOps WHERE taskId = ? AND opType = 'create'",
      [taskId]
    );
    if (existing.length > 0) {
      // Remove all pending ops for this task — nothing needs to reach the server
      await db.execute("DELETE FROM pendingOps WHERE taskId = ?", [taskId]);
      return;
    }
  }
  await db.execute(
    "INSERT INTO pendingOps (taskId, opType, data, createdAt) VALUES (?, ?, ?, ?)",
    [taskId, opType, JSON.stringify(data), Date.now()]
  );
}

export async function getPendingOps(db: Database): Promise<PendingOperation[]> {
  return await db.select<PendingOperation[]>(
    "SELECT * FROM pendingOps ORDER BY createdAt ASC"
  );
}

export async function deletePendingOp(db: Database, opId: number): Promise<void> {
  await db.execute("DELETE FROM pendingOps WHERE id = ?", [opId]);
}

/** Increment retry count for a failed pending op. Returns the new count. */
export async function incrementPendingOpRetry(db: Database, opId: number): Promise<number> {
  await db.execute("UPDATE pendingOps SET retryCount = COALESCE(retryCount, 0) + 1 WHERE id = ?", [opId]);
  const rows = await db.select<{ retryCount: number }[]>("SELECT retryCount FROM pendingOps WHERE id = ?", [opId]);
  return rows[0]?.retryCount ?? 0;
}

/** Update taskId references in pending ops when a local-xxx ID is replaced by a server ID. */
export async function updatePendingOpsTaskId(db: Database, oldId: string, newId: string): Promise<void> {
  await db.execute("UPDATE pendingOps SET taskId = ? WHERE taskId = ?", [newId, oldId]);
}

/** Get pending ops filtered by operation type (e.g. "list-create"). */
export async function getPendingOpsByType(db: Database, opType: string): Promise<PendingOperation[]> {
  return await db.select<PendingOperation[]>(
    "SELECT * FROM pendingOps WHERE opType = ? ORDER BY createdAt ASC",
    [opType]
  );
}

export async function loadDeltaTokens(db: Database): Promise<Record<string, string>> {
  const rows = await db.select<{ listId: string; deltaLink: string }[]>(
    "SELECT * FROM deltaTokens"
  );
  const tokens: Record<string, string> = {};
  for (const r of rows) tokens[r.listId] = r.deltaLink;
  return tokens;
}

export async function saveDeltaTokens(db: Database, tokens: Record<string, string>): Promise<void> {
  const entries = Object.entries(tokens);
  if (entries.length === 0) return;
  for (const [listId, deltaLink] of entries) {
    await db.execute(
      "INSERT OR REPLACE INTO deltaTokens (listId, deltaLink) VALUES (?, ?)",
      [listId, deltaLink]
    );
  }
}

export async function clearDeltaTokens(db: Database): Promise<void> {
  await db.execute("DELETE FROM deltaTokens");
}

/** Clear isInMyDay flag for all tasks (used for daily My Day reset). */
export async function clearMyDayFlags(db: Database): Promise<void> {
  await db.execute("UPDATE tasks SET isInMyDay = 0 WHERE isInMyDay = 1");
}

/**
 * Wipe all cached data (tasks, lists, delta tokens, pending ops) for account switching.
 * Deduplicated: if multiple hooks call this concurrently (useTasks + useLists),
 * only the first call actually runs; subsequent calls await the same promise.
 */
let clearInFlight: Promise<void> | null = null;

export function clearAllData(db: Database): Promise<void> {
  if (clearInFlight) return clearInFlight;

  clearInFlight = (async () => {
    try {
      await db.execute("DELETE FROM tasks");
      await db.execute("DELETE FROM lists");
      await db.execute("DELETE FROM deltaTokens");
      await db.execute("DELETE FROM pendingOps");
    } finally {
      clearInFlight = null;
    }
  })();

  return clearInFlight;
}
