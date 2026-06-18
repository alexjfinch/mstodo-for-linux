import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import {
  safeJsonParse,
  assertAllowedColumns,
  queuePendingOp,
  getPendingOps,
  deletePendingOp,
  incrementPendingOpRetry,
  updatePendingOpsTaskId,
  getPendingOpsByType,
  saveDeltaTokens,
  loadDeltaTokens,
  clearDeltaTokens,
} from "./taskStorage";
import { MockDatabase } from "../test/mockDatabase";

// @tauri-apps/plugin-sql is a Tauri native plugin — replace it with a no-op
// stub so the import doesn't attempt to reach the Tauri IPC bridge.
vi.mock("@tauri-apps/plugin-sql", () => ({ default: class {} }));

function db(): Database {
  return new MockDatabase() as unknown as Database;
}

// ── safeJsonParse ─────────────────────────────────────────────────────────────

describe("safeJsonParse", () => {
  it("parses a valid JSON object", () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a valid JSON array", () => {
    expect(safeJsonParse<string[]>('["x","y"]')).toEqual(["x", "y"]);
  });

  it("returns undefined for invalid JSON", () => {
    expect(safeJsonParse("{not valid")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(safeJsonParse("")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(safeJsonParse(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(safeJsonParse(undefined)).toBeUndefined();
  });
});

// ── assertAllowedColumns ──────────────────────────────────────────────────────

describe("assertAllowedColumns", () => {
  const allowed = new Set(["title", "importance", "dueDateTime"]);

  it("does not throw for allowed columns", () => {
    expect(() =>
      assertAllowedColumns(["title = ?", "importance = ?"], allowed)
    ).not.toThrow();
  });

  it("does not throw for a single allowed column", () => {
    expect(() => assertAllowedColumns(["dueDateTime = ?"], allowed)).not.toThrow();
  });

  it("throws for a disallowed column", () => {
    expect(() =>
      assertAllowedColumns(["injected = ?"], allowed)
    ).toThrow(/Disallowed column/);
  });

  it("throws even when some columns are allowed but one is not", () => {
    expect(() =>
      assertAllowedColumns(["title = ?", "evil = ?"], allowed)
    ).toThrow(/Disallowed column/);
  });
});

// ── queuePendingOp ────────────────────────────────────────────────────────────

describe("queuePendingOp", () => {
  it("inserts a create op", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "create", { title: "Buy milk" });
    expect(mock.ops).toHaveLength(1);
    expect(mock.ops[0]).toMatchObject({ taskId: "task-1", opType: "create" });
  });

  it("deduplicates toggle ops — second replaces first", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "toggle", {});
    await queuePendingOp(mock as unknown as Database, "task-1", "toggle", {});
    expect(mock.ops).toHaveLength(1);
    expect(mock.ops[0].opType).toBe("toggle");
  });

  it("deduplicates update ops — second replaces first", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "update", { title: "v1" });
    await queuePendingOp(mock as unknown as Database, "task-1", "update", { title: "v2" });
    expect(mock.ops).toHaveLength(1);
    expect(JSON.parse(mock.ops[0].data)).toEqual({ title: "v2" });
  });

  it("deduplicates move ops — second replaces first", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "move", { targetListId: "list-a" });
    await queuePendingOp(mock as unknown as Database, "task-1", "move", { targetListId: "list-b" });
    expect(mock.ops).toHaveLength(1);
    expect(JSON.parse(mock.ops[0].data)).toEqual({ targetListId: "list-b" });
  });

  it("cancels delete + create pair — task never reached the server", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    await queuePendingOp(mock as unknown as Database, "task-1", "delete", {});
    expect(mock.ops).toHaveLength(0);
  });

  it("cancels all pending ops for that task when delete+create pair found", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    mock.seed({ taskId: "task-1", opType: "update", data: "{}", createdAt: 2 });
    await queuePendingOp(mock as unknown as Database, "task-1", "delete", {});
    expect(mock.ops).toHaveLength(0);
  });

  it("queues a delete op when no prior create exists", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "delete", {});
    expect(mock.ops).toHaveLength(1);
    expect(mock.ops[0].opType).toBe("delete");
  });

  it("does not cancel another task's create when deleting a different task", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-2", opType: "create", data: "{}", createdAt: 1 });
    await queuePendingOp(mock as unknown as Database, "task-1", "delete", {});
    expect(mock.ops).toHaveLength(2);
    expect(mock.ops.some((op) => op.taskId === "task-2")).toBe(true);
  });

  it("inserts a list-create op without dedup logic", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, null, "list-create", { displayName: "Work" });
    await queuePendingOp(mock as unknown as Database, null, "list-create", { displayName: "Personal" });
    expect(mock.ops).toHaveLength(2);
  });

  it("serialises data as JSON", async () => {
    const mock = new MockDatabase();
    await queuePendingOp(mock as unknown as Database, "task-1", "update", {
      importance: "high",
      dueDateTime: { dateTime: "2025-01-01", timeZone: "UTC" },
    });
    const stored = JSON.parse(mock.ops[0].data);
    expect(stored.importance).toBe("high");
    expect(stored.dueDateTime.timeZone).toBe("UTC");
  });
});

// ── getPendingOps ─────────────────────────────────────────────────────────────

describe("getPendingOps", () => {
  it("returns ops sorted by createdAt ascending", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-2", opType: "update", data: "{}", createdAt: 200 });
    mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 100 });
    const ops = await getPendingOps(mock as unknown as Database);
    expect(ops[0].taskId).toBe("task-1");
    expect(ops[1].taskId).toBe("task-2");
  });

  it("returns an empty array when there are no ops", async () => {
    const ops = await getPendingOps(db());
    expect(ops).toHaveLength(0);
  });
});

// ── deletePendingOp ───────────────────────────────────────────────────────────

describe("deletePendingOp", () => {
  it("removes the op with the given id", async () => {
    const mock = new MockDatabase();
    const seeded = mock.seed({ taskId: "task-1", opType: "update", data: "{}", createdAt: 1 });
    await deletePendingOp(mock as unknown as Database, seeded.id);
    expect(mock.ops).toHaveLength(0);
  });

  it("leaves other ops untouched", async () => {
    const mock = new MockDatabase();
    const keep = mock.seed({ taskId: "task-2", opType: "toggle", data: "{}", createdAt: 1 });
    const remove = mock.seed({ taskId: "task-1", opType: "update", data: "{}", createdAt: 2 });
    await deletePendingOp(mock as unknown as Database, remove.id);
    expect(mock.ops).toHaveLength(1);
    expect(mock.ops[0].id).toBe(keep.id);
  });
});

// ── incrementPendingOpRetry ───────────────────────────────────────────────────

describe("incrementPendingOpRetry", () => {
  it("increments retryCount from 0 to 1", async () => {
    const mock = new MockDatabase();
    const op = mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    const count = await incrementPendingOpRetry(mock as unknown as Database, op.id);
    expect(count).toBe(1);
  });

  it("increments retryCount across multiple calls", async () => {
    const mock = new MockDatabase();
    const op = mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    await incrementPendingOpRetry(mock as unknown as Database, op.id);
    await incrementPendingOpRetry(mock as unknown as Database, op.id);
    const count = await incrementPendingOpRetry(mock as unknown as Database, op.id);
    expect(count).toBe(3);
  });
});

// ── updatePendingOpsTaskId ────────────────────────────────────────────────────

describe("updatePendingOpsTaskId", () => {
  it("remaps all ops from old id to new id", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "local-abc", opType: "update", data: "{}", createdAt: 1 });
    mock.seed({ taskId: "local-abc", opType: "toggle", data: "{}", createdAt: 2 });
    await updatePendingOpsTaskId(mock as unknown as Database, "local-abc", "server-123");
    expect(mock.ops.every((op) => op.taskId === "server-123")).toBe(true);
  });

  it("does not affect ops for other tasks", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "local-abc", opType: "update", data: "{}", createdAt: 1 });
    mock.seed({ taskId: "other-task", opType: "toggle", data: "{}", createdAt: 2 });
    await updatePendingOpsTaskId(mock as unknown as Database, "local-abc", "server-123");
    const otherOp = mock.ops.find((op) => op.id === 2);
    expect(otherOp?.taskId).toBe("other-task");
  });
});

// ── getPendingOpsByType ───────────────────────────────────────────────────────

describe("getPendingOpsByType", () => {
  it("returns only ops matching the requested type", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    mock.seed({ taskId: "task-2", opType: "delete", data: "{}", createdAt: 2 });
    mock.seed({ taskId: null, opType: "list-create", data: "{}", createdAt: 3 });
    const ops = await getPendingOpsByType(mock as unknown as Database, "list-create");
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("list-create");
  });

  it("returns an empty array when no ops match the type", async () => {
    const mock = new MockDatabase();
    mock.seed({ taskId: "task-1", opType: "create", data: "{}", createdAt: 1 });
    const ops = await getPendingOpsByType(mock as unknown as Database, "delete");
    expect(ops).toHaveLength(0);
  });
});

// ── delta token helpers ───────────────────────────────────────────────────────

describe("delta token helpers", () => {
  let mock: MockDatabase;
  beforeEach(() => { mock = new MockDatabase(); });

  it("saveDeltaTokens persists tokens, loadDeltaTokens retrieves them", async () => {
    const d = mock as unknown as Database;
    await saveDeltaTokens(d, { "list-1": "link-a", "list-2": "link-b" });
    const tokens = await loadDeltaTokens(d);
    expect(tokens).toEqual({ "list-1": "link-a", "list-2": "link-b" });
  });

  it("clearDeltaTokens removes all stored tokens", async () => {
    const d = mock as unknown as Database;
    await saveDeltaTokens(d, { "list-1": "link-a" });
    await clearDeltaTokens(d);
    const tokens = await loadDeltaTokens(d);
    expect(tokens).toEqual({});
  });

  it("saveDeltaTokens is a no-op when given an empty object", async () => {
    const d = mock as unknown as Database;
    await saveDeltaTokens(d, {});
    expect(mock.tokens).toEqual({});
  });
});
