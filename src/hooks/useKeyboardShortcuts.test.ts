import { describe, it, expect } from "vitest";
import { shortcutForEvent } from "./useKeyboardShortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("shortcutForEvent", () => {
  it("maps the app shortcuts", () => {
    expect(shortcutForEvent(key("n", { ctrlKey: true }), false)).toBe("newTask");
    expect(shortcutForEvent(key("f", { ctrlKey: true }), false)).toBe("search");
    expect(shortcutForEvent(key("d", { ctrlKey: true }), false)).toBe("complete");
    expect(shortcutForEvent(key("Delete"), false)).toBe("delete");
    expect(shortcutForEvent(key("F5"), false)).toBe("sync");
  });

  it("matches letters regardless of Caps Lock", () => {
    expect(shortcutForEvent(key("N", { ctrlKey: true }), false)).toBe("newTask");
  });

  it("leaves Delete and Ctrl+D to text fields while typing", () => {
    expect(shortcutForEvent(key("Delete"), true)).toBeNull();
    expect(shortcutForEvent(key("d", { ctrlKey: true }), true)).toBeNull();
  });

  it("still allows new task, search and sync while typing", () => {
    expect(shortcutForEvent(key("n", { ctrlKey: true }), true)).toBe("newTask");
    expect(shortcutForEvent(key("f", { ctrlKey: true }), true)).toBe("search");
    expect(shortcutForEvent(key("F5"), true)).toBe("sync");
  });

  it("ignores other modifier combinations and plain letters", () => {
    expect(shortcutForEvent(key("n", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shortcutForEvent(key("n", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutForEvent(key("Delete", { shiftKey: true }), false)).toBeNull();
    expect(shortcutForEvent(key("n"), false)).toBeNull();
    expect(shortcutForEvent(key("Backspace"), false)).toBeNull();
  });
});
