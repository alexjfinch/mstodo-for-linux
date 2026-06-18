import type { Task, TaskList } from "../types";
import type { PendingOperation } from "../api/taskStorage";

export const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  title: "Test task",
  completed: false,
  listId: "list-1",
  status: "notStarted",
  importance: "normal",
  lastModified: 1000,
  ...overrides,
});

export const makeList = (overrides: Partial<TaskList> = {}): TaskList => ({
  id: "list-1",
  displayName: "My List",
  isOwner: true,
  isShared: false,
  ...overrides,
});

export const makePendingOp = (
  overrides: Partial<PendingOperation> & { id?: number } = {}
): PendingOperation & { id: number } => ({
  id: 1,
  taskId: "task-1",
  opType: "update",
  data: "{}",
  createdAt: 1000,
  retryCount: 0,
  ...overrides,
});
