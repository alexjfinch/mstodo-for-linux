import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Task } from "../types";

interface UseTraySync {
  tasks: Task[];
  isOnline: boolean;
  syncing: boolean;
}

export function useTraySync({ tasks, isOnline, syncing }: UseTraySync) {
  useEffect(() => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const urgentCount = tasks.filter((t) => {
      if (t.completed || !t.dueDateTime) return false;
      const due = t.dueDateTime.dateTime.split("T")[0];
      return due <= todayStr;
    }).length;
    const tooltip =
      urgentCount > 0
        ? `Microsoft To Do - ${urgentCount} task${urgentCount !== 1 ? "s" : ""} due/overdue`
        : "Microsoft To Do - No tasks due";
    invoke("update_tray_tooltip", { tooltip }).catch(() => {});
  }, [tasks]);

  useEffect(() => {
    const status = !isOnline ? "offline" : syncing ? "syncing" : "synced";
    invoke("update_tray_status", { status }).catch(() => {});
  }, [isOnline, syncing]);
}
