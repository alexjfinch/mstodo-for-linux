import { useState, useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseTaskInput } from "../utils/dateParser";

// Theme CSS variables — dark is default, toggled via [data-theme="light"] on <html>.
const QUICKADD_THEME_CSS = `
  :root {
    --qa-bg: #1e1e1e;
    --qa-border: #333;
    --qa-text: #e0e0e0;
    --qa-header: #999;
    --qa-input-bg: #2a2a2a;
    --qa-input-border: #444;
    --qa-input-text: #fff;
    --qa-hint: #666;
    --qa-preview: #4fc3f7;
    --qa-shadow: rgba(0,0,0,0.5);
  }
  :root[data-theme="light"] {
    --qa-bg: #ffffff;
    --qa-border: #ddd;
    --qa-text: #333;
    --qa-header: #666;
    --qa-input-bg: #f5f5f5;
    --qa-input-border: #ccc;
    --qa-input-text: #111;
    --qa-hint: #999;
    --qa-preview: #1976d2;
    --qa-shadow: rgba(0,0,0,0.15);
  }
`;

if (typeof document !== "undefined" && !document.getElementById("qa-theme")) {
  const style = document.createElement("style");
  style.id = "qa-theme";
  style.textContent = QUICKADD_THEME_CSS;
  document.head.appendChild(style);
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

export const QuickAdd = () => {
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Query system theme on mount and listen for live changes
  useEffect(() => {
    inputRef.current?.focus();
    invoke<string>("get_system_theme").then(applyTheme).catch(() => {});
    const unlisten = listen<string>("theme-changed", (e) => applyTheme(e.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Parse date preview as user types
  useEffect(() => {
    if (!value.trim()) {
      setPreview(null);
      return;
    }
    const parsed = parseTaskInput(value);
    if (parsed.dueDateTime) {
      const d = new Date(parsed.dueDateTime.dateTime);
      const dateStr = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      setPreview(`"${parsed.title}" due ${dateStr}`);
    } else {
      setPreview(null);
    }
  }, [value]);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    const parsed = parseTaskInput(value);
    // Extract #hashtags as categories
    const hashtagRegex = /#([\w-]+)/g;
    const categories: string[] = [];
    let match;
    let cleanTitle = parsed.title;
    while ((match = hashtagRegex.exec(parsed.title)) !== null) {
      if (match[1] !== "MyDay") categories.push(match[1]);
    }
    if (categories.length > 0) {
      cleanTitle = cleanTitle.replace(/#[\w-]+/g, "").replace(/\s+/g, " ").trim();
    }
    await emit("quick-add-task", {
      title: cleanTitle || parsed.title,
      dueDateTime: parsed.dueDateTime,
      categories: categories.length > 0 ? categories : undefined,
    });
    setValue("");
    await getCurrentWindow().close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      getCurrentWindow().close();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>Quick Add Task</div>
        <input
          ref={inputRef}
          style={styles.input}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='e.g. "Buy milk tomorrow" or "Meeting on Friday"'
        />
        {preview && <div style={styles.preview}>{preview}</div>}
        <div style={styles.footer}>
          <span style={styles.hint}>Enter to add &middot; Esc to cancel</span>
          <button
            style={{
              ...styles.button,
              opacity: value.trim() ? 1 : 0.5,
            }}
            onClick={handleSubmit}
            disabled={!value.trim()}
          >
            Add Task
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: "100%",
    background: "var(--qa-bg)",
    borderRadius: "12px",
    border: "1px solid var(--qa-border)",
    padding: "16px",
    boxShadow: "0 8px 32px var(--qa-shadow)",
    color: "var(--qa-text)",
  },
  header: {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--qa-header)",
    marginBottom: "12px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    background: "var(--qa-input-bg)",
    border: "1px solid var(--qa-input-border)",
    borderRadius: "8px",
    color: "var(--qa-input-text)",
    outline: "none",
  },
  preview: {
    marginTop: "8px",
    fontSize: "12px",
    color: "var(--qa-preview)",
    paddingLeft: "2px",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "12px",
  },
  hint: {
    fontSize: "11px",
    color: "var(--qa-hint)",
  },
  button: {
    padding: "8px 20px",
    fontSize: "13px",
    fontWeight: 600,
    background: "#2196F3",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};
