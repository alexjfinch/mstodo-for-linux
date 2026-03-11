import Database from "@tauri-apps/plugin-sql";
import { Task, TaskList } from "../types";

export interface PendingOperation {
  id?: number;
  taskId: string | null;
  opType: "create" | "toggle" | "update" | "delete";
  data: string;
  createdAt: number;
}

export async function initializeTables(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      isOwner INTEGER,
      isShared INTEGER,
      wellknownListName TEXT
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
      createdAt INTEGER
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS deltaTokens (
      listId TEXT PRIMARY KEY,
      deltaLink TEXT NOT NULL
    );
  `);

  // Versioned schema migrations
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
  `);
  await db.execute("INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0)");

  const rows = await db.select<{ version: number }[]>("SELECT version FROM schema_version WHERE id = 1");
  let currentVersion = rows[0]?.version ?? 0;

  // Helper: check if a column already exists (handles fresh installs where the
  // CREATE TABLE already includes columns that older migrations would add).
  async function hasColumn(table: string, column: string): Promise<boolean> {
    const info = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
    return info.some((col) => col.name === column);
  }

  const migrations: (() => Promise<void>)[] = [
    // v1: add listId to tasks
    async () => { if (!(await hasColumn("tasks", "listId"))) await db.execute("ALTER TABLE tasks ADD COLUMN listId TEXT"); },
    // v2: add recurrence to tasks
    async () => { if (!(await hasColumn("tasks", "recurrence"))) await db.execute("ALTER TABLE tasks ADD COLUMN recurrence TEXT"); },
    // v3: add categories to tasks
    async () => { if (!(await hasColumn("tasks", "categories"))) await db.execute("ALTER TABLE tasks ADD COLUMN categories TEXT"); },
    // v4: add isGroup to lists
    async () => { if (!(await hasColumn("lists", "isGroup"))) await db.execute("ALTER TABLE lists ADD COLUMN isGroup INTEGER DEFAULT 0"); },
    // v5: add parentGroupId to lists
    async () => { if (!(await hasColumn("lists", "parentGroupId"))) await db.execute("ALTER TABLE lists ADD COLUMN parentGroupId TEXT"); },
  ];

  for (let i = currentVersion; i < migrations.length; i++) {
    await migrations[i]();
    await db.execute("UPDATE schema_version SET version = ?", [i + 1]);
  }
}

export async function loadListsFromDB(db: Database): Promise<TaskList[]> {
  const rows = await db.select<any[]>("SELECT * FROM lists");
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    isOwner: !!r.isOwner,
    isShared: !!r.isShared,
    wellknownListName: r.wellknownListName || undefined,
    isGroup: r.isGroup === 1 ? true : undefined,
    parentGroupId: r.parentGroupId || undefined,
  }));
}

export async function saveListToDB(db: Database, list: TaskList): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO lists
      (id, displayName, isOwner, isShared, wellknownListName, isGroup, parentGroupId)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      list.id,
      list.displayName,
      list.isOwner ? 1 : 0,
      list.isShared ? 1 : 0,
      list.wellknownListName || null,
      list.isGroup ? 1 : 0,
      list.parentGroupId || null,
    ]
  );
}

export async function deleteListFromDB(db: Database, listId: string): Promise<void> {
  await db.execute("DELETE FROM lists WHERE id = ?", [listId]);
}

export async function updateListMeta(
  db: Database,
  listId: string,
  meta: { isGroup?: boolean; parentGroupId?: string | null }
): Promise<void> {
  const updates: string[] = [];
  const values: any[] = [];

  if ("isGroup" in meta) {
    updates.push("isGroup = ?");
    values.push(meta.isGroup ? 1 : 0);
  }
  if ("parentGroupId" in meta) {
    updates.push("parentGroupId = ?");
    values.push(meta.parentGroupId || null);
  }

  if (updates.length === 0) return;
  values.push(listId);

  await db.execute(
    `UPDATE lists SET ${updates.join(", ")} WHERE id = ?`,
    values
  );
}

export async function loadTasksFromDB(db: Database): Promise<Task[]> {
  const rows = await db.select<any[]>("SELECT * FROM tasks");
  return rows.map((r) => ({
    id: r.id,
    listId: r.listId,
    title: r.title,
    completed: !!r.completed,
    status: r.status || "notStarted",
    isInMyDay: !!r.isInMyDay,
    importance: (r.importance as Task["importance"]) || "normal",
    dueDateTime: r.dueDateTime ? JSON.parse(r.dueDateTime) : undefined,
    body: r.body ? JSON.parse(r.body) : undefined,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : undefined,
    categories: r.categories ? JSON.parse(r.categories) : undefined,
    lastModified: r.updatedAt,
  }));
}

export async function saveTaskToDB(db: Database, task: Task): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO tasks
      (id, listId, title, completed, status, isInMyDay, importance, dueDateTime, body, recurrence, categories, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const values: any[] = [];

  if ("isInMyDay" in attributes)   { updates.push("isInMyDay = ?");   values.push(attributes.isInMyDay ? 1 : 0); }
  if ("importance" in attributes)  { updates.push("importance = ?");  values.push(attributes.importance || "normal"); }
  if ("dueDateTime" in attributes) { updates.push("dueDateTime = ?"); values.push(attributes.dueDateTime ? JSON.stringify(attributes.dueDateTime) : null); }
  if ("title" in attributes)       { updates.push("title = ?");       values.push(attributes.title || ""); }
  if ("body" in attributes)        { updates.push("body = ?");        values.push(attributes.body ? JSON.stringify(attributes.body) : null); }
  if ("recurrence" in attributes)  { updates.push("recurrence = ?");  values.push(attributes.recurrence ? JSON.stringify(attributes.recurrence) : null); }
  if ("categories" in attributes)  { updates.push("categories = ?");  values.push(attributes.categories ? JSON.stringify(attributes.categories) : null); }

  if (updates.length === 0) return;

  updates.push("updatedAt = ?");
  values.push(timestamp);
  values.push(id);

  await db.execute(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, values);
}

export async function deleteTaskFromDB(db: Database, id: string): Promise<void> {
  await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
}

export async function getLocalTask(db: Database, id: string): Promise<Task | null> {
  const rows = await db.select<any[]>("SELECT * FROM tasks WHERE id = ?", [id]);
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
    dueDateTime: r.dueDateTime ? JSON.parse(r.dueDateTime) : undefined,
    body: r.body ? JSON.parse(r.body) : undefined,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : undefined,
    categories: r.categories ? JSON.parse(r.categories) : undefined,
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
  opType: "create" | "toggle" | "update" | "delete",
  data: any
): Promise<void> {
  if (taskId && (opType === "update" || opType === "toggle")) {
    await db.execute(
      "DELETE FROM pendingOps WHERE taskId = ? AND opType = ?",
      [taskId, opType]
    );
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

// ── Delta token persistence ─────────────────────────────────────────

export async function loadDeltaTokens(db: Database): Promise<Record<string, string>> {
  const rows = await db.select<{ listId: string; deltaLink: string }[]>(
    "SELECT * FROM deltaTokens"
  );
  const tokens: Record<string, string> = {};
  for (const r of rows) tokens[r.listId] = r.deltaLink;
  return tokens;
}

export async function saveDeltaTokens(db: Database, tokens: Record<string, string>): Promise<void> {
  for (const [listId, deltaLink] of Object.entries(tokens)) {
    await db.execute(
      "INSERT OR REPLACE INTO deltaTokens (listId, deltaLink) VALUES (?, ?)",
      [listId, deltaLink]
    );
  }
}

export async function clearDeltaTokens(db: Database): Promise<void> {
  await db.execute("DELETE FROM deltaTokens");
}

/** Wipe all cached data (tasks, lists, delta tokens, pending ops) for account switching. */
export async function clearAllData(db: Database): Promise<void> {
  await db.execute("DELETE FROM tasks");
  await db.execute("DELETE FROM lists");
  await db.execute("DELETE FROM deltaTokens");
  await db.execute("DELETE FROM pendingOps");
}
