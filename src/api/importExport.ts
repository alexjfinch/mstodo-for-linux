import { invoke } from "@tauri-apps/api/core";
import { Task, TaskList } from "../types";

export interface ExportData {
  version: string;
  exportedAt: string;
  app: string;
  lists: TaskList[];
  tasks: Task[];
}

export interface ImportResult {
  tasks: Omit<Task, "id">[];
  count: number;
}

export function buildJsonExport(tasks: Task[], lists: TaskList[]): string {
  const data: ExportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    app: "MS To Do for Linux",
    lists: lists.filter((l) => !l.isGroup),
    tasks,
  };
  return JSON.stringify(data, null, 2);
}

export function buildCsvExport(tasks: Task[], lists: TaskList[]): string {
  const listMap = new Map(lists.map((l) => [l.id, l.displayName]));
  const header = ["Title", "Notes", "List", "Due Date", "Priority", "Completed", "Categories"];
  const rows = tasks.map((t) => [
    csvEscape(t.title),
    csvEscape(t.body?.content || ""),
    csvEscape(t.listId ? (listMap.get(t.listId) || "") : ""),
    t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.split("T")[0] : "",
    t.importance === "high" ? "high" : t.importance === "low" ? "low" : "normal",
    t.completed ? "1" : "0",
    csvEscape((t.categories || []).join(", ")),
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/plain"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface PickedFile {
  name: string;
  content_bytes: string; // base64
}

export async function pickImportFile(): Promise<{ name: string; content: string } | null> {
  const result = await invoke<PickedFile | null>("pick_and_read_file");
  if (!result) return null;
  const bytes = Uint8Array.from(atob(result.content_bytes), (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return { name: result.name, content };
}

export function importFromJson(content: string): ImportResult {
  let data: ExportData;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!data.tasks || !Array.isArray(data.tasks)) {
    throw new Error("Invalid backup format: missing 'tasks' array.");
  }
  const tasks: Omit<Task, "id">[] = data.tasks
    .filter((t): t is Task => t != null && typeof t === "object" && typeof t.title === "string")
    .map((t) => ({
      title: t.title || "Untitled",
      completed: !!t.completed,
      status: t.completed ? "completed" : "notStarted",
      isInMyDay: typeof t.isInMyDay === "boolean" ? t.isInMyDay : undefined,
      importance: (t.importance === "high" || t.importance === "low" || t.importance === "normal") ? t.importance : undefined,
      dueDateTime: t.dueDateTime && typeof t.dueDateTime === "object" && "dateTime" in t.dueDateTime ? t.dueDateTime : undefined,
      body: t.body && typeof t.body === "object" && "content" in t.body ? t.body : undefined,
      categories: Array.isArray(t.categories) ? t.categories.filter((c): c is string => typeof c === "string") : undefined,
    }));
  return { tasks, count: tasks.length };
}

export function importFromTodoistCsv(content: string): ImportResult {
  const lines = parseCsvLines(content);
  if (lines.length < 2) throw new Error("Invalid Todoist CSV: no data rows.");

  const header = lines[0].map((h) => h.toLowerCase().trim());
  const col = (name: string) => header.indexOf(name);

  const typeIdx = col("type");
  const contentIdx = col("content");
  const descIdx = col("description");
  const priorityIdx = col("priority");
  const dueDateIdx = col("due date");
  const checkedIdx = col("checked");
  const labelsIdx = col("labels");

  if (contentIdx === -1) throw new Error("Invalid Todoist CSV: missing CONTENT column.");

  const tasks: Omit<Task, "id">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const type = typeIdx >= 0 ? (row[typeIdx] || "").toLowerCase() : "task";
    if (type !== "task" && type !== "") continue;

    const title = row[contentIdx]?.trim();
    if (!title) continue;

    // Todoist priority: 1=Urgent, 2=High, 3=Medium, 4=Normal
    const priority = priorityIdx >= 0 ? parseInt(row[priorityIdx] || "4", 10) : 4;
    const importance: Task["importance"] =
      priority === 1 || priority === 2 ? "high" : priority === 3 ? "normal" : "low";

    const checked = checkedIdx >= 0 ? row[checkedIdx] === "1" : false;
    const labels =
      labelsIdx >= 0
        ? (row[labelsIdx] || "").split(",").map((l) => l.trim()).filter(Boolean)
        : [];
    const dueStr = dueDateIdx >= 0 ? row[dueDateIdx] : "";
    const description = descIdx >= 0 ? (row[descIdx] || "").trim() : "";

    const task: Omit<Task, "id"> = {
      title,
      completed: checked,
      status: checked ? "completed" : "notStarted",
      importance,
      categories: labels.length > 0 ? labels : undefined,
    };

    if (dueStr) {
      const due = new Date(dueStr);
      if (!isNaN(due.getTime())) {
        task.dueDateTime = { dateTime: due.toISOString(), timeZone: "UTC" };
      }
    }
    if (description) {
      task.body = { content: description, contentType: "text" };
    }

    tasks.push(task);
  }

  return { tasks, count: tasks.length };
}

export function importFromEvernoteEnex(content: string): ImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Invalid ENEX file: XML parse error.");

  const notes = Array.from(doc.querySelectorAll("note"));
  if (notes.length === 0) throw new Error("No notes found in ENEX file.");

  const tasks: Omit<Task, "id">[] = notes.map((note) => {
    const title = note.querySelector("title")?.textContent?.trim() || "Untitled";
    const tags = Array.from(note.querySelectorAll("tag"))
      .map((t) => t.textContent?.trim() || "")
      .filter(Boolean);

    // Evernote content is ENML (subset of XHTML) wrapped in CDATA
    let noteBody = "";
    const contentEl = note.querySelector("content");
    if (contentEl?.textContent) {
      const enml = new DOMParser().parseFromString(contentEl.textContent, "text/html");
      noteBody = enml.body?.textContent?.trim() || "";
    }

    const task: Omit<Task, "id"> = {
      title,
      completed: false,
      status: "notStarted",
      categories: tags.length > 0 ? tags : undefined,
    };

    if (noteBody) {
      task.body = { content: noteBody, contentType: "text" };
    }

    return task;
  });

  return { tasks, count: tasks.length };
}

export function importFromGenericCsv(content: string): ImportResult {
  const lines = parseCsvLines(content);
  if (lines.length < 2) throw new Error("Invalid CSV: no data rows.");

  const header = lines[0].map((h) => h.toLowerCase().trim());

  const titleIdx = header.findIndex((h) =>
    ["title", "task", "name", "content", "subject"].some((k) => h.includes(k))
  );
  const notesIdx = header.findIndex((h) =>
    ["note", "description", "body", "detail"].some((k) => h.includes(k))
  );
  const dueDateIdx = header.findIndex((h) => ["due", "date", "deadline"].some((k) => h.includes(k)));
  const priorityIdx = header.findIndex((h) =>
    ["priority", "importance"].some((k) => h.includes(k))
  );
  const completedIdx = header.findIndex((h) =>
    ["complet", "done", "status", "checked", "finished"].some((k) => h.includes(k))
  );
  const categoriesIdx = header.findIndex((h) =>
    ["categor", "label", "tag"].some((k) => h.includes(k))
  );

  if (titleIdx === -1) throw new Error("Invalid CSV: could not find a title/task/name column.");

  const tasks: Omit<Task, "id">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const title = row[titleIdx]?.trim();
    if (!title) continue;

    const task: Omit<Task, "id"> = { title, completed: false, status: "notStarted" };

    if (notesIdx >= 0 && row[notesIdx]?.trim()) {
      task.body = { content: row[notesIdx].trim(), contentType: "text" };
    }
    if (dueDateIdx >= 0 && row[dueDateIdx]?.trim()) {
      const due = new Date(row[dueDateIdx].trim());
      if (!isNaN(due.getTime())) {
        task.dueDateTime = { dateTime: due.toISOString(), timeZone: "UTC" };
      }
    }
    if (priorityIdx >= 0 && row[priorityIdx]?.trim()) {
      const p = row[priorityIdx].trim().toLowerCase();
      task.importance = p === "high" || p === "1" ? "high" : p === "low" || p === "3" ? "low" : "normal";
    }
    if (completedIdx >= 0 && row[completedIdx]?.trim()) {
      const c = row[completedIdx].trim().toLowerCase();
      task.completed = ["1", "true", "yes", "completed", "done"].includes(c);
      task.status = task.completed ? "completed" : "notStarted";
    }
    if (categoriesIdx >= 0 && row[categoriesIdx]?.trim()) {
      task.categories = row[categoriesIdx].split(",").map((c) => c.trim()).filter(Boolean);
    }

    tasks.push(task);
  }

  return { tasks, count: tasks.length };
}

function parseCsvLines(content: string): string[][] {
  const rows: string[][] = [];
  const lines = content.split(/\r?\n/);

  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const line of lines) {
    // If we're not inside a quoted field and the line is empty, skip it
    if (!inQuotes && !line.trim()) continue;

    // If we're continuing a quoted field from a previous line, add the newline
    if (inQuotes) current += "\n";

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        row.push(current);
        current = "";
      } else {
        current += ch;
      }
    }

    // Only finalize the row if we're not inside a quoted field
    if (!inQuotes) {
      row.push(current);
      current = "";
      rows.push(row);
      row = [];
    }
  }

  // Handle trailing data (e.g. unterminated quote)
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}
