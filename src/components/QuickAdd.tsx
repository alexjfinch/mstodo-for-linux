import { useState, useEffect, useRef } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseTaskInput } from "../utils/dateParser";

export const QuickAdd = () => {
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
    await emit("quick-add-task", {
      title: parsed.title,
      dueDateTime: parsed.dueDateTime,
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
    background: "#1e1e1e",
    borderRadius: "12px",
    border: "1px solid #333",
    padding: "16px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    color: "#e0e0e0",
  },
  header: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#999",
    marginBottom: "12px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    background: "#2a2a2a",
    border: "1px solid #444",
    borderRadius: "8px",
    color: "#fff",
    outline: "none",
  },
  preview: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#4fc3f7",
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
    color: "#666",
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
