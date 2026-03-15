import axios, { AxiosError } from "axios";
import { Task, TaskList, TaskAttachment, ChecklistItem, Recurrence } from "../types";
import { logger } from "../services/logger";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me/todo/lists";
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";
const GRAPH_PLANNER_TASKS = "https://graph.microsoft.com/v1.0/me/planner/tasks";
const REQUEST_TIMEOUT = 15000;
const MAX_PAGINATION_PAGES = 50;

// ── Graph API response types ─────────────────────────────────────────

type GraphCollection<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

type GraphDeltaCollection<T> = GraphCollection<T> & {
  "@odata.deltaLink"?: string;
};

type GraphTaskList = {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName?: string;
};

type GraphTaskBody = {
  content: string;
  contentType: "text" | "html";
};

type GraphDateTime = {
  dateTime: string;
  timeZone: string;
};

type GraphTask = {
  id: string;
  title: string;
  status: "notStarted" | "inProgress" | "completed";
  importance: "low" | "normal" | "high";
  body?: GraphTaskBody;
  dueDateTime?: GraphDateTime;
  reminderDateTime?: GraphDateTime;
  recurrence?: Recurrence | null;
  categories?: string[];
  hasAttachments?: boolean;
  lastModifiedDateTime?: string;
  "@removed"?: { reason: string };
};

type GraphPlannerTask = {
  id: string;
  title: string;
  percentComplete: number;
  priority: number;
  dueDateTime?: string;
  lastModifiedDateTime?: string;
};

type GraphUserProfile = {
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
};

type GraphAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  lastModifiedDateTime: string;
  contentBytes?: string;
};

type GraphChecklistItem = {
  id: string;
  displayName: string;
  isChecked: boolean;
};

type GraphTaskPatchBody = {
  title?: string;
  status?: string;
  importance?: string;
  body?: GraphTaskBody;
  dueDateTime?: GraphDateTime | null;
  reminderDateTime?: GraphDateTime | null;
  recurrence?: Recurrence | null;
  categories?: string[];
};

// ── Auth & request helpers ───────────────────────────────────────────

// Set by useAuth; called automatically on 401 responses to refresh the token
let tokenRefreshCallback: (() => Promise<string>) | null = null;
// Deduplicates concurrent refresh attempts so only one is in-flight at a time
let inflightRefresh: Promise<string> | null = null;

export function setTokenRefreshCallback(cb: (() => Promise<string>) | null) {
  tokenRefreshCallback = cb;
}

async function graphRequest<T>(
  method: "get" | "post" | "patch" | "delete",
  url: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  const call = async (token: string): Promise<T> => {
    const config = { headers: { Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT };
    let resp;
    if (method === "get") resp = await axios.get<T>(url, config);
    else if (method === "delete") resp = await axios.delete<T>(url, config);
    else if (method === "patch") resp = await axios.patch<T>(url, body, config);
    else resp = await axios.post<T>(url, body, config);
    return resp.data;
  };

  try {
    return await call(accessToken);
  } catch (err: unknown) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 401 && tokenRefreshCallback) {
      if (!inflightRefresh) {
        inflightRefresh = tokenRefreshCallback().finally(() => { inflightRefresh = null; });
      }
      const newToken = await inflightRefresh;
      return await call(newToken);
    }
    // Respect 429 rate-limit: wait for Retry-After, refresh token (it may
    // have expired during the wait), then retry once.
    if (axiosErr.response?.status === 429) {
      const retryAfter = parseInt(axiosErr.response.headers?.["retry-after"] as string, 10);
      const waitMs = (retryAfter > 0 ? retryAfter : 30) * 1000;
      logger.warn(`Rate-limited (429), waiting ${waitMs / 1000}s before retry`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      let retryToken = accessToken;
      if (tokenRefreshCallback) {
        try {
          if (!inflightRefresh) {
            inflightRefresh = tokenRefreshCallback().finally(() => { inflightRefresh = null; });
          }
          retryToken = await inflightRefresh;
        } catch {
          // Refresh failed — retry with original token as best-effort
        }
      }
      return await call(retryToken);
    }
    throw err;
  }
}

/** Clear module-level caches (call on account switch). */
export function resetGraphCaches() {
  deltaUnsupportedLists.clear();
}

// ── User profile ─────────────────────────────────────────────────────

export type UserProfile = {
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
};

export async function fetchUserProfile(accessToken: string): Promise<UserProfile> {
  const data = await graphRequest<GraphUserProfile>("get", GRAPH_ME, accessToken);
  return {
    displayName: data.displayName || "",
    mail: data.mail || null,
    userPrincipalName: data.userPrincipalName || "",
  };
}

// ── Task lists ───────────────────────────────────────────────────────

export async function fetchTaskLists(accessToken: string): Promise<TaskList[]> {
  const data = await graphRequest<GraphCollection<GraphTaskList>>("get", GRAPH_BASE, accessToken);
  return data.value.map((list) => ({
    id: list.id,
    displayName: list.displayName,
    isOwner: list.isOwner,
    isShared: list.isShared,
    wellknownListName: list.wellknownListName as TaskList["wellknownListName"],
  }));
}

export async function createTaskList(displayName: string, accessToken: string): Promise<TaskList> {
  const data = await graphRequest<GraphTaskList>("post", GRAPH_BASE, accessToken, { displayName });
  return {
    id: data.id,
    displayName: data.displayName,
    isOwner: data.isOwner,
    isShared: data.isShared,
    wellknownListName: data.wellknownListName as TaskList["wellknownListName"],
  };
}

export async function deleteTaskList(listId: string, accessToken: string): Promise<void> {
  await graphRequest("delete", `${GRAPH_BASE}/${listId}`, accessToken);
}

// ── Task mapping ─────────────────────────────────────────────────────

// Microsoft Graph API does not expose My Day status in v1.0 or beta.
// We store it as a #MyDay tag in the task body as a workaround — this is the
// same approach used by several other third-party MS To Do clients.
function mapGraphTask(t: GraphTask, listId: string): Task {
  return {
    id: t.id,
    title: t.title,
    completed: t.status === "completed",
    listId,
    status: t.status,
    isInMyDay: t.body?.content?.includes("#MyDay") || false,
    importance: t.importance || "normal",
    dueDateTime: t.dueDateTime
      ? { dateTime: t.dueDateTime.dateTime, timeZone: t.dueDateTime.timeZone }
      : undefined,
    reminderDateTime: t.reminderDateTime
      ? { dateTime: t.reminderDateTime.dateTime, timeZone: t.reminderDateTime.timeZone }
      : undefined,
    body: t.body ? { content: t.body.content, contentType: t.body.contentType } : undefined,
    recurrence: t.recurrence ?? undefined,
    categories: t.categories?.length ? t.categories : undefined,
    hasAttachments: t.hasAttachments || false,
    lastModified: t.lastModifiedDateTime ? new Date(t.lastModifiedDateTime).getTime() : Date.now(),
  };
}

// ── Fetch tasks ──────────────────────────────────────────────────────

export async function fetchTasksFromList(listId: string, accessToken: string): Promise<Task[]> {
  const allTasks: Task[] = [];
  let url: string | null = `${GRAPH_BASE}/${listId}/tasks?$top=100`;
  let pages = 0;

  while (url && pages < MAX_PAGINATION_PAGES) {
    const resp: GraphCollection<GraphTask> = await graphRequest("get", url, accessToken);
    allTasks.push(...resp.value.map((t) => mapGraphTask(t, listId)));
    url = resp["@odata.nextLink"] || null;
    pages++;
  }

  if (url) {
    logger.warn(`Pagination limit reached for list ${listId} after ${pages} pages (${allTasks.length} tasks). Some tasks may be missing.`);
  }

  return allTasks;
}

export async function fetchAllTasks(accessToken: string): Promise<Task[]> {
  const lists = await fetchTaskLists(accessToken);
  const taskArrays = await Promise.all(
    lists.map(list => fetchTasksFromList(list.id, accessToken))
  );
  return taskArrays.flat();
}

// Track lists where delta isn't supported to avoid repeated 400s
const deltaUnsupportedLists = new Set<string>();

// ── Delta sync ───────────────────────────────────────────────────────

export type DeltaChange = {
  task: Task;
  removed: boolean;
};

export type DeltaResult = {
  changes: DeltaChange[];
  deltaLink: string;
};

/**
 * Fetch changes for a single list using the Graph delta API.
 * On first call pass `deltaLink = null` to get a full snapshot + initial delta token.
 * On subsequent calls pass the stored deltaLink to get only what changed.
 */
export async function fetchTasksDelta(
  listId: string,
  accessToken: string,
  deltaLink: string | null
): Promise<DeltaResult> {
  const changes: DeltaChange[] = [];
  let url: string | null = deltaLink || `${GRAPH_BASE}/${listId}/tasks/delta`;
  let resultDeltaLink = "";
  let pages = 0;

  while (url && pages < MAX_PAGINATION_PAGES) {
    const resp: GraphDeltaCollection<GraphTask> = await graphRequest("get", url, accessToken);

    for (const item of resp.value) {
      if (item["@removed"]) {
        changes.push({
          task: { id: item.id, title: "", completed: false, listId, lastModified: Date.now() },
          removed: true,
        });
      } else {
        changes.push({ task: mapGraphTask(item, listId), removed: false });
      }
    }

    if (resp["@odata.deltaLink"]) {
      resultDeltaLink = resp["@odata.deltaLink"];
      url = null;
    } else {
      url = resp["@odata.nextLink"] || null;
    }
    pages++;
  }

  if (url) {
    logger.warn(`Delta pagination limit reached for list ${listId} after ${pages} pages. Some changes may be missing.`);
  }

  return { changes, deltaLink: resultDeltaLink };
}

/**
 * Perform a delta sync across all lists. Returns all changes and new delta tokens per list.
 */
export async function fetchAllTasksDelta(
  accessToken: string,
  deltaTokens: Record<string, string>
): Promise<{ changes: DeltaChange[]; newDeltaTokens: Record<string, string> }> {
  const lists = await fetchTaskLists(accessToken);

  const allChanges: DeltaChange[] = [];
  const newTokens: Record<string, string> = {};

  // Process lists sequentially to avoid bursting Microsoft Graph rate limits.
  // Promise.all on many lists causes immediate 429 throttling.
  for (const list of lists) {
    let result: { changes: DeltaChange[]; deltaLink: string };

    if (deltaUnsupportedLists.has(list.id)) {
      const tasks = await fetchTasksFromList(list.id, accessToken);
      result = {
        changes: tasks.map((task) => ({ task, removed: false })),
        deltaLink: "",
      };
    } else {
      const existing = deltaTokens[list.id] || null;
      try {
        result = await fetchTasksDelta(list.id, accessToken, existing);
      } catch (err: unknown) {
        const axiosErr = err as AxiosError;
        if (axiosErr.response?.status === 400) {
          deltaUnsupportedLists.add(list.id);
          logger.warn(`Delta not supported for list ${list.id}, falling back to full fetch`);
          const tasks = await fetchTasksFromList(list.id, accessToken);
          result = {
            changes: tasks.map((task) => ({ task, removed: false })),
            deltaLink: "",
          };
        } else {
          throw err;
        }
      }
    }

    allChanges.push(...result.changes);
    if (result.deltaLink) newTokens[list.id] = result.deltaLink;
  }

  return { changes: allChanges, newDeltaTokens: newTokens };
}

// ── Task CRUD ────────────────────────────────────────────────────────

export async function createTask(title: string, listId: string, accessToken: string): Promise<Task> {
  const data = await graphRequest<GraphTask>(
    "post", `${GRAPH_BASE}/${listId}/tasks`, accessToken, { title }
  );
  return mapGraphTask(data, listId);
}

export async function toggleTaskCompleted(task: Task, accessToken: string): Promise<Task> {
  if (!task.listId) throw new Error("Task must have a listId");

  const newStatus = task.completed ? "completed" : "notStarted";
  const data = await graphRequest<GraphTask>(
    "patch", `${GRAPH_BASE}/${task.listId}/tasks/${task.id}`, accessToken, { status: newStatus }
  );

  return {
    ...task,
    completed: data.status === "completed",
    status: data.status,
    lastModified: data.lastModifiedDateTime
      ? new Date(data.lastModifiedDateTime).getTime()
      : Date.now(),
  };
}

export async function updateTaskAttributes(
  task: Task,
  updates: Partial<Task>,
  accessToken: string
): Promise<Task> {
  if (!task.listId) throw new Error("Task must have a listId");

  const body: GraphTaskPatchBody = {};

  if ("title" in updates && updates.title) body.title = updates.title;

  // My Day: managed via #MyDay tag in body (see comment on mapGraphTask)
  if (updates.isInMyDay !== undefined) {
    const cleanContent = (task.body?.content || "").replace(/#MyDay/g, "").trim();
    body.body = {
      content: updates.isInMyDay ? `${cleanContent} #MyDay`.trim() : cleanContent,
      contentType: "text",
    };
  } else if ("body" in updates) {
    // Preserve existing #MyDay tag when user edits body content
    const clean = (updates.body?.content || "").replace(/#MyDay/g, "").trim();
    body.body = {
      content: task.isInMyDay ? `${clean} #MyDay`.trim() : clean,
      contentType: "text",
    };
  }

  if (updates.importance) body.importance = updates.importance;

  if ("dueDateTime" in updates) {
    body.dueDateTime = updates.dueDateTime
      ? { dateTime: updates.dueDateTime.dateTime, timeZone: updates.dueDateTime.timeZone || "UTC" }
      : null;
  }

  if ("reminderDateTime" in updates) {
    body.reminderDateTime = updates.reminderDateTime
      ? { dateTime: updates.reminderDateTime.dateTime, timeZone: updates.reminderDateTime.timeZone || "UTC" }
      : null;
  }

  if ("recurrence" in updates) body.recurrence = (updates.recurrence as Recurrence) ?? null;
  if ("categories" in updates) body.categories = updates.categories ?? [];

  const data = await graphRequest<GraphTask>(
    "patch", `${GRAPH_BASE}/${task.listId}/tasks/${task.id}`, accessToken,
    body as unknown as Record<string, unknown>
  );

  return {
    ...task,
    ...updates,
    completed: data.status === "completed",
    status: data.status,
    lastModified: data.lastModifiedDateTime
      ? new Date(data.lastModifiedDateTime).getTime()
      : Date.now(),
  };
}

export async function deleteTask(taskId: string, listId: string, accessToken: string): Promise<void> {
  await graphRequest("delete", `${GRAPH_BASE}/${listId}/tasks/${taskId}`, accessToken);
}

// ── Planner (Assigned to Me) ─────────────────────────────────────────

function mapPlannerTask(t: GraphPlannerTask): Task {
  const completed = t.percentComplete === 100;
  return {
    id: `planner-${t.id}`,
    title: t.title,
    completed,
    listId: "__assigned__",
    status: completed ? "completed" : "notStarted",
    importance: t.priority <= 1 ? "high" : t.priority <= 5 ? "normal" : "low",
    dueDateTime: t.dueDateTime
      ? { dateTime: t.dueDateTime, timeZone: "UTC" }
      : undefined,
    lastModified: t.lastModifiedDateTime
      ? new Date(t.lastModifiedDateTime).getTime()
      : Date.now(),
  };
}

export async function fetchAssignedTasks(accessToken: string): Promise<Task[]> {
  const allTasks: Task[] = [];
  let url: string | null = `${GRAPH_PLANNER_TASKS}?$top=100`;
  let pages = 0;

  while (url && pages < MAX_PAGINATION_PAGES) {
    const resp: GraphCollection<GraphPlannerTask> = await graphRequest("get", url, accessToken);
    allTasks.push(...resp.value.map((t) => mapPlannerTask(t)));
    url = resp["@odata.nextLink"] || null;
    pages++;
  }

  if (url) {
    logger.warn(`Pagination limit reached for assigned tasks after ${pages} pages (${allTasks.length} tasks). Some tasks may be missing.`);
  }

  return allTasks;
}

// ── Attachments ──────────────────────────────────────────────────────

export async function fetchAttachments(
  listId: string,
  taskId: string,
  accessToken: string
): Promise<TaskAttachment[]> {
  const data = await graphRequest<GraphCollection<GraphAttachment>>(
    "get", `${GRAPH_BASE}/${listId}/tasks/${taskId}/attachments`, accessToken
  );
  return data.value.map((a) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
    lastModifiedDateTime: a.lastModifiedDateTime,
  }));
}

export async function uploadAttachment(
  listId: string,
  taskId: string,
  file: { name: string; contentType: string; contentBytes: string },
  accessToken: string
): Promise<void> {
  await graphRequest(
    "post",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/attachments`,
    accessToken,
    {
      "@odata.type": "#microsoft.graph.taskFileAttachment",
      name: file.name,
      contentType: file.contentType,
      contentBytes: file.contentBytes,
    } as Record<string, unknown>
  );
}

export async function fetchAttachmentContent(
  listId: string,
  taskId: string,
  attachmentId: string,
  accessToken: string
): Promise<{ name: string; contentType: string; contentBytes: string }> {
  const data = await graphRequest<GraphAttachment>(
    "get",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/attachments/${attachmentId}`,
    accessToken
  );
  return { name: data.name, contentType: data.contentType, contentBytes: data.contentBytes ?? "" };
}

export async function deleteAttachment(
  listId: string,
  taskId: string,
  attachmentId: string,
  accessToken: string
): Promise<void> {
  await graphRequest(
    "delete",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/attachments/${attachmentId}`,
    accessToken
  );
}

// ── Checklist items ──────────────────────────────────────────────────

export async function fetchChecklistItems(
  listId: string,
  taskId: string,
  accessToken: string
): Promise<ChecklistItem[]> {
  const data = await graphRequest<GraphCollection<GraphChecklistItem>>(
    "get",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/checklistItems`,
    accessToken
  );
  return data.value.map((item) => ({
    id: item.id,
    displayName: item.displayName,
    isChecked: item.isChecked || false,
  }));
}

export async function createChecklistItem(
  listId: string,
  taskId: string,
  displayName: string,
  accessToken: string
): Promise<ChecklistItem> {
  const data = await graphRequest<GraphChecklistItem>(
    "post",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/checklistItems`,
    accessToken,
    { displayName } as Record<string, unknown>
  );
  return { id: data.id, displayName: data.displayName, isChecked: data.isChecked || false };
}

export async function updateChecklistItem(
  listId: string,
  taskId: string,
  itemId: string,
  updates: { displayName?: string; isChecked?: boolean },
  accessToken: string
): Promise<ChecklistItem> {
  const data = await graphRequest<GraphChecklistItem>(
    "patch",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/checklistItems/${itemId}`,
    accessToken,
    updates as Record<string, unknown>
  );
  return { id: data.id, displayName: data.displayName, isChecked: data.isChecked || false };
}

export async function deleteChecklistItem(
  listId: string,
  taskId: string,
  itemId: string,
  accessToken: string
): Promise<void> {
  await graphRequest(
    "delete",
    `${GRAPH_BASE}/${listId}/tasks/${taskId}/checklistItems/${itemId}`,
    accessToken
  );
}
