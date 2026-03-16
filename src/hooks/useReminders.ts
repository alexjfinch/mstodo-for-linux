import { useEffect, useRef, useCallback, useState } from "react";
import { Task } from "../types";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type ReminderTiming = "at_due" | "5min" | "15min" | "30min" | "1hour" | "1day";

export type ToastNotification = {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  type?: "reminder" | "success" | "error";
};

const TIMING_OFFSETS: Record<ReminderTiming, number> = {
  at_due: 0,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1hour": 60 * 60_000,
  "1day": 24 * 60 * 60_000,
};

const TIMING_LABELS: Record<ReminderTiming, string> = {
  at_due: "At due time",
  "5min": "5 minutes before",
  "15min": "15 minutes before",
  "30min": "30 minutes before",
  "1hour": "1 hour before",
  "1day": "1 day before",
};

export { TIMING_LABELS };

export const useReminders = (
  tasks: Task[],
  enabled: boolean,
  timing: ReminderTiming
) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss the oldest toast after 8 seconds, accounting for time already elapsed
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const remaining = Math.max(0, 8000 - (Date.now() - oldest.timestamp));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== oldest.id));
    }, remaining);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!enabled) return;

    const checkReminders = async () => {
      const now = Date.now();
      const offset = TIMING_OFFSETS[timing];

      // ── Explicit reminders (reminderDateTime) ──
      const reminderTasks = tasks.filter((task) => {
        if (task.completed || !task.reminderDateTime) return false;
        const key = `reminder-${task.id}-${task.reminderDateTime.dateTime}`;
        if (notifiedRef.current.has(key)) return false;
        const reminderTime = new Date(task.reminderDateTime.dateTime).getTime();
        // Fire if we're past the reminder time but not more than 24h after
        return now >= reminderTime && now <= reminderTime + 24 * 60 * 60_000;
      });

      // ── Due-date reminders ──
      const dueTasks = tasks.filter((task) => {
        if (task.completed || !task.dueDateTime) return false;

        const key = `${task.id}-${task.dueDateTime.dateTime}`;
        if (notifiedRef.current.has(key)) return false;

        // Parse the due date — Graph dates are typically date-only (midnight)
        const dueDate = new Date(task.dueDateTime.dateTime);
        const triggerTime = dueDate.getTime() - offset;

        // Fire if we're past the trigger time but not more than 24h after due
        return now >= triggerTime && now <= dueDate.getTime() + 24 * 60 * 60_000;
      });

      if (dueTasks.length === 0 && reminderTasks.length === 0) return;

      // Request notification permission if needed
      let permitted = await isPermissionGranted();
      if (!permitted) {
        const result = await requestPermission();
        permitted = result === "granted";
      }

      // Fire explicit reminder notifications
      for (const task of reminderTasks) {
        const key = `reminder-${task.id}-${task.reminderDateTime!.dateTime}`;
        notifiedRef.current.add(key);

        const reminderDate = new Date(task.reminderDateTime!.dateTime);
        const body = `Reminder — ${reminderDate.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })} at ${reminderDate.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}`;

        if (permitted) {
          sendNotification({ title: task.title, body });
        }

        setToasts((prev) => [
          ...prev,
          {
            id: `${key}-${now}`,
            title: task.title,
            body,
            timestamp: now,
            type: "reminder",
          },
        ]);
      }

      // Fire due-date notifications
      for (const task of dueTasks) {
        const key = `${task.id}-${task.dueDateTime!.dateTime}`;
        notifiedRef.current.add(key);

        const dueDate = new Date(task.dueDateTime!.dateTime);
        const isOverdue = now > dueDate.getTime();
        const dueDateStr = dueDate.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

        const body = isOverdue
          ? `Overdue — was due ${dueDateStr}`
          : `Due ${dueDateStr}`;

        // Desktop notification
        if (permitted) {
          sendNotification({
            title: task.title,
            body,
          });
        }

        // In-app toast
        setToasts((prev) => [
          ...prev,
          {
            id: `${key}-${now}`,
            title: task.title,
            body,
            timestamp: now,
          },
        ]);
      }
    };

    // Check immediately, then every 60 seconds
    checkReminders();
    const interval = setInterval(checkReminders, 60_000);
    return () => clearInterval(interval);
  }, [tasks, enabled, timing]);

  // Prune stale notification keys for tasks that no longer exist.
  // Keys are formatted as "taskId-dateTime" or "reminder-taskId-dateTime",
  // so we extract the task ID from each key and check the Set.
  useEffect(() => {
    const taskIdSet = new Set(tasks.map((t) => t.id));
    for (const key of notifiedRef.current) {
      // Extract task ID: "reminder-<id>-<datetime>" or "<id>-<datetime>"
      let taskId: string;
      if (key.startsWith("reminder-")) {
        const rest = key.slice("reminder-".length);
        taskId = rest.substring(0, rest.lastIndexOf("-"));
      } else {
        taskId = key.substring(0, key.lastIndexOf("-"));
      }
      if (taskId && !taskIdSet.has(taskId)) {
        notifiedRef.current.delete(key);
      }
    }
  }, [tasks]);

  const pushToast = useCallback((toast: Pick<ToastNotification, "title" | "body" | "type">) => {
    setToasts((prev) => [
      ...prev,
      { ...toast, id: crypto.randomUUID(), timestamp: Date.now() },
    ]);
  }, []);

  return { toasts, dismissToast, pushToast };
};
