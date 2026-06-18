import type { PendingOperation } from "../api/taskStorage";

type StoredOp = PendingOperation & { id: number };

/**
 * In-memory mock of @tauri-apps/plugin-sql Database.
 * Covers only the SQL patterns used by taskStorage.ts — enough to exercise the
 * pending-ops queue logic without needing a real SQLite connection.
 */
export class MockDatabase {
  private pendingOps: StoredOp[] = [];
  private deltaTokens: Record<string, string> = {};
  private nextId = 1;

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const s = sql.trim();

    if (/DELETE FROM pendingOps WHERE taskId = \? AND opType = \?/i.test(s)) {
      const [taskId, opType] = params as [string, string];
      this.pendingOps = this.pendingOps.filter(
        (op) => !(op.taskId === taskId && op.opType === opType)
      );
    } else if (/DELETE FROM pendingOps WHERE taskId = \?/i.test(s)) {
      const [taskId] = params as [string];
      this.pendingOps = this.pendingOps.filter((op) => op.taskId !== taskId);
    } else if (/DELETE FROM pendingOps WHERE id = \?/i.test(s)) {
      const [id] = params as [number];
      this.pendingOps = this.pendingOps.filter((op) => op.id !== id);
    } else if (/INSERT INTO pendingOps/i.test(s)) {
      const [taskId, opType, data, createdAt] = params as [
        string | null,
        string,
        string,
        number,
      ];
      this.pendingOps.push({
        id: this.nextId++,
        taskId,
        opType: opType as PendingOperation["opType"],
        data,
        createdAt,
        retryCount: 0,
      });
    } else if (/UPDATE pendingOps SET retryCount/i.test(s)) {
      const [id] = params as [number];
      const op = this.pendingOps.find((o) => o.id === id);
      if (op) op.retryCount = (op.retryCount ?? 0) + 1;
    } else if (/UPDATE pendingOps SET taskId = \? WHERE taskId = \?/i.test(s)) {
      const [newId, oldId] = params as [string, string];
      for (const op of this.pendingOps) {
        if (op.taskId === oldId) op.taskId = newId;
      }
    } else if (/INSERT OR REPLACE INTO deltaTokens/i.test(s)) {
      const [listId, deltaLink] = params as [string, string];
      this.deltaTokens[listId] = deltaLink;
    } else if (/DELETE FROM deltaTokens/i.test(s)) {
      for (const k of Object.keys(this.deltaTokens)) delete this.deltaTokens[k];
    }
    // Silently ignore CREATE TABLE, CREATE INDEX, BEGIN, COMMIT, ROLLBACK, etc.
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim();

    // "SELECT id FROM pendingOps WHERE taskId = ? AND opType = 'create'"
    if (/SELECT id FROM pendingOps WHERE taskId = \? AND opType = 'create'/i.test(s)) {
      const [taskId] = params as [string];
      return this.pendingOps
        .filter((op) => op.taskId === taskId && op.opType === "create")
        .map(({ id }) => ({ id })) as unknown as T[];
    }

    // "SELECT retryCount FROM pendingOps WHERE id = ?"
    if (/SELECT retryCount FROM pendingOps WHERE id = \?/i.test(s)) {
      const [id] = params as [number];
      const op = this.pendingOps.find((o) => o.id === id);
      return (op ? [{ retryCount: op.retryCount ?? 0 }] : []) as unknown as T[];
    }

    // "SELECT * FROM pendingOps WHERE opType = ? ORDER BY createdAt ASC"
    if (/FROM pendingOps WHERE opType = \?/i.test(s)) {
      const [opType] = params as [string];
      const result = this.pendingOps
        .filter((op) => op.opType === opType)
        .sort((a, b) => a.createdAt - b.createdAt);
      return result as unknown as T[];
    }

    // "SELECT * FROM pendingOps ORDER BY createdAt ASC"
    if (/FROM pendingOps ORDER BY createdAt ASC/i.test(s)) {
      return [...this.pendingOps].sort(
        (a, b) => a.createdAt - b.createdAt
      ) as unknown as T[];
    }

    // "SELECT * FROM deltaTokens"
    if (/FROM deltaTokens/i.test(s)) {
      return Object.entries(this.deltaTokens).map(([listId, deltaLink]) => ({
        listId,
        deltaLink,
      })) as unknown as T[];
    }

    return [] as unknown as T[];
  }

  /** Pre-seed a pending op, bypassing queuePendingOp's dedup logic. */
  seed(op: Omit<PendingOperation, "id"> & { id?: number }): StoredOp {
    const stored: StoredOp = { retryCount: 0, ...op, id: op.id ?? this.nextId++ };
    this.pendingOps.push(stored);
    return stored;
  }

  /** Read-only snapshot of pending ops for assertions. */
  get ops(): StoredOp[] {
    return [...this.pendingOps];
  }

  /** Read-only snapshot of delta tokens for assertions. */
  get tokens(): Record<string, string> {
    return { ...this.deltaTokens };
  }
}
