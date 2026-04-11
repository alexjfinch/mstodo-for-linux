import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Task } from "../types";
import { logger } from "../services/logger";

interface UseTraySync {
  tasks: Task[];
  isOnline: boolean;
  syncing: boolean;
}

export function useTraySync({ tasks, isOnline, syncing }: UseTraySync) {
  useEffect(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const urgentCount = tasks.filter((t) => {
      if (t.completed || !t.dueDateTime) return false;
      const due = t.dueDateTime.dateTime.split("T")[0];
      return due <= todayStr;
    }).length;
    const tooltip =
      urgentCount > 0
        ? `Microsoft To Do - ${urgentCount} task${urgentCount !== 1 ? "s" : ""} due/overdue`
        : "Microsoft To Do - No tasks due";
    invoke("update_tray_tooltip", { tooltip }).catch((err) => logger.warn("Failed to update tray tooltip", err));
  }, [tasks]);

  useEffect(() => {
    const status = !isOnline ? "offline" : syncing ? "syncing" : "synced";
    invoke("update_tray_status", { status }).catch((err) => logger.warn("Failed to update tray status", err));
  }, [isOnline, syncing]);
}
