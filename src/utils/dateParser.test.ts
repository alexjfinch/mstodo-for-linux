import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseTaskInput, localDateToGraphDate } from "./dateParser";

// Pin "today" so tests are deterministic regardless of when they run
const FIXED_DATE = new Date("2025-06-15T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

describe("localDateToGraphDate", () => {
  it("formats a Date to Graph date string without UTC conversion", () => {
    const d = new Date(2024, 0, 5); // Jan 5 2024 local time
    expect(localDateToGraphDate(d)).toBe("2024-01-05T00:00:00.0000000");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2024, 2, 3); // March 3
    expect(localDateToGraphDate(d)).toBe("2024-03-03T00:00:00.0000000");
  });
});

describe("parseTaskInput", () => {
  it("returns title unchanged when no date phrase is detected", () => {
    const result = parseTaskInput("Buy groceries");
    expect(result.title).toBe("Buy groceries");
    expect(result.dueDateTime).toBeUndefined();
  });

  it("extracts a due date and strips the date phrase from the title", () => {
    const result = parseTaskInput("Submit report by tomorrow");
    expect(result.title).toBe("Submit report");
    expect(result.dueDateTime).toBeDefined();
    // tomorrow relative to FIXED_DATE (2025-06-15) is 2025-06-16
    expect(result.dueDateTime!.dateTime).toMatch(/^2025-06-16/);
  });

  it("strips trailing prepositions left over after date removal", () => {
    const result = parseTaskInput("Call dentist on Monday");
    expect(result.title).not.toMatch(/\bon\b$/i);
    expect(result.dueDateTime).toBeDefined();
  });

  it("keeps the original input as title when only a date phrase was entered", () => {
    // A bare date string with nothing else should fall back to the full input
    const result = parseTaskInput("tomorrow");
    expect(result.title).toBe("tomorrow");
    expect(result.dueDateTime).toBeDefined();
  });

  it("returns a dueDateTime with a non-empty timeZone", () => {
    const result = parseTaskInput("Finish slides next Friday");
    expect(result.dueDateTime!.timeZone).toBeTruthy();
  });

  it("truncates titles longer than 255 characters", () => {
    const longTitle = "a".repeat(260) + " tomorrow";
    const result = parseTaskInput(longTitle);
    expect(result.title.length).toBeLessThanOrEqual(255);
  });

  it("handles ambiguous input without throwing", () => {
    expect(() => parseTaskInput("")).not.toThrow();
    expect(() => parseTaskInput("   ")).not.toThrow();
    expect(() => parseTaskInput("!@#$%")).not.toThrow();
  });
});
