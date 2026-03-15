import { useState, useMemo } from "react";
import { Task } from "../types";

type Props = {
  allTasks: Task[];
  onAddToMyDay: (id: string) => void;
};

type SuggestionReason = "overdue" | "due_today" | "reminder_today" | "important" | "recent";

type Suggestion = {
  task: Task;
  reason: SuggestionReason;
};

const REASON_LABELS: Record<SuggestionReason, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  reminder_today: "Reminder today",
  important: "Important",
  recent: "Recently added",
};

export const MyDaySuggestions = ({ allTasks, onAddToMyDay }: Props) => {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const suggestions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const results: Suggestion[] = [];
    const seen = new Set<string>();

    const add = (task: Task, reason: SuggestionReason) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      results.push({ task, reason });
    };

    for (const task of allTasks) {
      if (task.completed || task.isInMyDay) continue;

      // Overdue tasks
      if (task.dueDateTime) {
        const due = new Date(task.dueDateTime.dateTime);
        const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        if (dueDate < today) {
          add(task, "overdue");
          continue;
        }
        if (dueDate.getTime() === today.getTime()) {
          add(task, "due_today");
          continue;
        }
      }

      // Reminder set for today
      if (task.reminderDateTime) {
        const reminder = new Date(task.reminderDateTime.dateTime);
        const reminderDate = new Date(reminder.getFullYear(), reminder.getMonth(), reminder.getDate());
        if (reminderDate.getTime() === today.getTime()) {
          add(task, "reminder_today");
          continue;
        }
      }

      // Important tasks
      if (task.importance === "high") {
        add(task, "important");
        continue;
      }

      // Recently created (last 2 days)
      if (task.lastModified && task.lastModified >= twoDaysAgo.getTime()) {
        add(task, "recent");
      }
    }

    return results;
  }, [allTasks]);

  const visible = suggestions.filter((s) => !dismissed.has(s.task.id));

  if (visible.length === 0) return null;

  return (
    <div className="myday-suggestions">
      <div
        className="myday-suggestions-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`collapse-icon ${collapsed ? "collapsed" : ""}`}>▼</span>
        <span>Suggestions</span>
        <span className="task-count">{visible.length}</span>
      </div>

      {!collapsed && (
        <ul className="myday-suggestions-list">
          {visible.map(({ task, reason }) => (
            <li
              key={task.id}
              className="myday-suggestion-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", task.id);
                e.dataTransfer.setData("suggestion", "true");
                e.dataTransfer.effectAllowed = "copy";
                const el = e.currentTarget as HTMLElement;
                const ghost = el.cloneNode(true) as HTMLElement;
                const computed = getComputedStyle(el);
                ghost.style.background = computed.backgroundColor;
                ghost.style.color = computed.color;
                ghost.style.border = computed.border || `1px solid ${computed.borderColor}`;
                ghost.style.padding = computed.padding;
                ghost.style.display = computed.display;
                ghost.style.alignItems = computed.alignItems;
                ghost.style.justifyContent = computed.justifyContent;
                ghost.style.transform = "scale(0.5)";
                ghost.style.transformOrigin = "top left";
                ghost.style.width = `${el.offsetWidth}px`;
                ghost.style.borderRadius = "8px";
                ghost.style.overflow = "hidden";
                ghost.style.position = "absolute";
                ghost.style.top = "-9999px";
                ghost.style.left = "-9999px";
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX * 0.5, e.nativeEvent.offsetY * 0.5);
                requestAnimationFrame(() => ghost.remove());
              }}
            >
              <div className="myday-suggestion-info">
                <span className="myday-suggestion-title">{task.title}</span>
                <span className="myday-suggestion-reason">{REASON_LABELS[reason]}</span>
              </div>
              <div className="myday-suggestion-actions">
                <button
                  className="myday-suggestion-add"
                  onClick={() => onAddToMyDay(task.id)}
                  title="Add to My Day"
                >
                  +
                </button>
                <button
                  className="myday-suggestion-dismiss"
                  onClick={() => setDismissed((prev) => new Set(prev).add(task.id))}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
