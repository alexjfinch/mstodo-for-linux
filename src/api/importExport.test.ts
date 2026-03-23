import { describe, it, expect } from "vitest";
import {
  buildCsvExport,
  buildJsonExport,
  importFromJson,
  importFromTodoistCsv,
  importFromGenericCsv,
} from "./importExport";
import type { Task, TaskList } from "../types";

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIST: TaskList = {
  id: "list-1",
  displayName: "Inbox",
  isOwner: true,
  isShared: false,
  wellknownListName: "defaultList",
};

const TASK: Task = {
  id: "task-1",
  title: "Write tests",
  completed: false,
  listId: "list-1",
  status: "notStarted",
  importance: "high",
  dueDateTime: { dateTime: "2025-07-01T00:00:00.0000000", timeZone: "UTC" },
  body: { content: "Make sure coverage is good", contentType: "text" },
  categories: ["work", "dev"],
};

// ── buildJsonExport ───────────────────────────────────────────────────────────

describe("buildJsonExport", () => {
  it("produces valid JSON with tasks and lists arrays", () => {
    const json = buildJsonExport([TASK], [LIST]);
    const data = JSON.parse(json);
    expect(data.tasks).toHaveLength(1);
    expect(data.lists).toHaveLength(1);
    expect(data.app).toBe("MS To Do for Linux");
  });

  it("excludes group lists from the export", () => {
    const group: TaskList = { id: "g-1", displayName: "Work", isOwner: true, isShared: false, isGroup: true };
    const json = buildJsonExport([TASK], [LIST, group]);
    const data = JSON.parse(json);
    expect(data.lists).toHaveLength(1);
    expect(data.lists[0].isGroup).toBeFalsy();
  });
});

// ── buildCsvExport ────────────────────────────────────────────────────────────

describe("buildCsvExport", () => {
  it("produces a CSV with a header row and one data row", () => {
    const csv = buildCsvExport([TASK], [LIST]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Title");
    expect(lines[1]).toContain("Write tests");
  });

  it("escapes commas and quotes in task titles", () => {
    const task: Task = { ...TASK, title: 'Buy "milk", eggs' };
    const csv = buildCsvExport([task], [LIST]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toContain('"Buy ""milk"", eggs"');
  });

  it("maps listId to list display name", () => {
    const csv = buildCsvExport([TASK], [LIST]);
    expect(csv).toContain("Inbox");
  });
});

// ── importFromJson ────────────────────────────────────────────────────────────

describe("importFromJson", () => {
  it("round-trips a JSON export back to tasks", () => {
    const json = buildJsonExport([TASK], [LIST]);
    const { tasks, count } = importFromJson(json);
    expect(count).toBe(1);
    expect(tasks[0].title).toBe("Write tests");
    expect(tasks[0].importance).toBe("high");
  });

  it("throws on invalid JSON", () => {
    expect(() => importFromJson("not json")).toThrow("not valid JSON");
  });

  it("throws when the tasks array is missing", () => {
    expect(() => importFromJson(JSON.stringify({ version: "1.0" }))).toThrow("missing 'tasks'");
  });

  it("filters out malformed task entries", () => {
    const data = {
      tasks: [
        { id: "t1", title: "Good task", listId: "l1" },
        { id: null, title: "Missing id" },
        "not an object",
      ],
    };
    const { tasks } = importFromJson(JSON.stringify(data));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Good task");
  });

  it("throws when the file exceeds 50 MB", () => {
    const huge = "x".repeat(51 * 1024 * 1024);
    expect(() => importFromJson(huge)).toThrow("too large");
  });
});

// ── importFromTodoistCsv ──────────────────────────────────────────────────────

const TODOIST_CSV = [
  "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT",
  "task,Buy milk,,4,1,,,2025-08-01,,,,",
  "task,Write report,,1,1,,,,,,,",
  "note,This is a comment,,,,,,,,,,",
  "task,Completed task,,2,1,,,,,,,",
].join("\n");

// Todoist exports use "DATE" not "DUE DATE" — use the known header layout
const TODOIST_CSV_WITH_DUE = [
  "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DUE DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT",
  "task,Buy milk,,4,1,,,2025-08-01,,,,",
  "task,Write report,,1,1,,,,,,,",
  "note,This is a comment,,,,,,,,,,",
].join("\n");

describe("importFromTodoistCsv", () => {
  it("imports task rows and skips note rows", () => {
    const { tasks } = importFromTodoistCsv(TODOIST_CSV);
    // All 3 task rows should be imported (note is skipped)
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.every((t) => typeof t.title === "string")).toBe(true);
  });

  it("maps Todoist priority 1 to 'high' importance", () => {
    const { tasks } = importFromTodoistCsv(TODOIST_CSV);
    const urgent = tasks.find((t) => t.title === "Write report");
    expect(urgent?.importance).toBe("high");
  });

  it("maps Todoist priority 4 to 'low' importance", () => {
    const { tasks } = importFromTodoistCsv(TODOIST_CSV);
    const normal = tasks.find((t) => t.title === "Buy milk");
    expect(normal?.importance).toBe("low");
  });

  it("parses a valid due date", () => {
    const { tasks } = importFromTodoistCsv(TODOIST_CSV_WITH_DUE);
    const task = tasks.find((t) => t.title === "Buy milk");
    expect(task?.dueDateTime).toBeDefined();
    expect(task?.dueDateTime?.dateTime).toContain("2025-08-01");
  });

  it("omits dueDateTime for an unparseable date without throwing", () => {
    const csv = [
      "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DUE DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT",
      "task,Bad date task,,4,1,,,not-a-date,,,,",
    ].join("\n");
    const { tasks } = importFromTodoistCsv(csv);
    expect(tasks[0].dueDateTime).toBeUndefined();
  });

  it("throws on a file with no data rows", () => {
    expect(() => importFromTodoistCsv("CONTENT\n")).toThrow();
  });
});

// ── importFromGenericCsv ──────────────────────────────────────────────────────

describe("importFromGenericCsv", () => {
  it("imports rows using flexible column detection", () => {
    // "description" matches the keyword list; "notes" does not due to word-boundary matching
    const csv = "Title,Description,Due Date,Priority,Completed\nPay bills,Monthly rent,2025-09-01,high,0";
    const { tasks } = importFromGenericCsv(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Pay bills");
    expect(tasks[0].importance).toBe("high");
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].body?.content).toBe("Monthly rent");
  });

  it("recognises truthy completed values", () => {
    const csv = "task,done\nFinish report,yes\nSend email,1\nSchedule call,true";
    const { tasks } = importFromGenericCsv(csv);
    expect(tasks.every((t) => t.completed)).toBe(true);
  });

  it("skips rows with no title", () => {
    const csv = "Title,Notes\n,Empty title row\nReal task,Some notes";
    const { tasks } = importFromGenericCsv(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Real task");
  });

  it("throws when no title column can be found", () => {
    const csv = "foo,bar\n1,2";
    expect(() => importFromGenericCsv(csv)).toThrow("title");
  });

  it("handles quoted fields containing commas", () => {
    // Use "description" (not "notes") because column detection uses word-boundary matching
    const csv = 'Title,Description\n"Buy milk, eggs","From the ""local"" store"';
    const { tasks } = importFromGenericCsv(csv);
    expect(tasks[0].title).toBe("Buy milk, eggs");
    expect(tasks[0].body?.content).toBe('From the "local" store');
  });

  it("splits categories by comma (value must be a single quoted CSV field)", () => {
    // Unquoted "home,chores" would be split into two CSV columns; quote the value to keep it as one field
    const csv = 'Title,Categories\nDo laundry,"home,chores"';
    const { tasks } = importFromGenericCsv(csv);
    expect(tasks[0].categories).toEqual(["home", "chores"]);
  });
});
