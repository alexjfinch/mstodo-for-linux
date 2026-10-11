import { useEffect, useEffectEvent } from "react";

export type ShortcutAction = "newTask" | "search" | "sync" | "complete" | "delete";

type KeyInfo = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/**
 * Map a key press to an app shortcut. While typing in a field, Delete and Ctrl+D are left
 * alone so they keep their normal editing behaviour.
 */
export function shortcutForEvent(e: KeyInfo, typing: boolean): ShortcutAction | null {
  if (e.altKey || e.metaKey) return null;
  if (e.key === "F5" && !e.ctrlKey && !e.shiftKey) return "sync";
  if (e.ctrlKey && !e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case "n": return "newTask";
      case "f": return "search";
      case "d": return typing ? null : "complete";
      default: return null;
    }
  }
  if (e.key === "Delete" && !e.ctrlKey && !e.shiftKey && !typing) return "delete";
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target.closest('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="button"])') !== null;
}

interface ShortcutHandlers {
  enabled: boolean;
  onNewTask: () => void;
  onSearch: () => void;
  onSync: () => void;
  onComplete: () => void;
  onDelete: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    // Leave keys to an open confirm dialog or context menu
    if (!handlers.enabled || e.defaultPrevented || document.querySelector('[aria-modal="true"], [role="menu"]')) return;

    const action = shortcutForEvent(e, isTypingTarget(e.target));
    if (!action) return;
    e.preventDefault();
    switch (action) {
      case "newTask": handlers.onNewTask(); break;
      case "search": handlers.onSearch(); break;
      case "sync": handlers.onSync(); break;
      case "complete": handlers.onComplete(); break;
      case "delete": handlers.onDelete(); break;
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
}
