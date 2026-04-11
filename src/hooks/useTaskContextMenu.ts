import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { Task } from "../types";
import { getReminderOptions, ReminderOption } from "../utils/reminderOptions";
import { logger } from "../services/logger";

type ContextMenuState = {
  visible: boolean;
  x: number;
  y: number;
  taskId: string | null;
};

export type DeleteConfirmState = { taskIds: string[]; title: string } | null;

type Options = {
  tasks: Task[];
  selectedTasks: string[];
  onUpdateAttributes: (id: string, updates: Partial<Task>) => Promise<void>;
  onToggleTask: (id: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onClearSelection: () => void;
};

export function useTaskContextMenu({
  tasks,
  selectedTasks,
  onUpdateAttributes,
  onToggleTask,
  onDeleteTask,
  onClearSelection,
}: Options) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, taskId: null });
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);
  const [reminderSubmenuOpen, setReminderSubmenuOpen] = useState(false);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const [minuteTick, setMinuteTick] = useState(0);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const closeMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  }, []);

  const currentTask = contextMenu.taskId
    ? tasks.find((t) => t.id === contextMenu.taskId) ?? null
    : null;

  useEffect(() => {
    if (!contextMenu.visible) return;
    const id = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [contextMenu.visible]);

  useEffect(() => {
    if (contextMenu.visible && menuRef.current) {
      menuRef.current.focus();
    }
  }, [contextMenu.visible]);

  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("click", handleClickOutside);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu.visible, closeMenu]);

  useLayoutEffect(() => {
    if (!contextMenu.visible || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const overflowX = Math.max(0, rect.right - (window.innerWidth - 4));
    const overflowY = Math.max(0, rect.bottom - (window.innerHeight - 4));
    if (overflowX > 0 || overflowY > 0) {
      setContextMenu((prev) => ({ ...prev, x: prev.x - overflowX, y: prev.y - overflowY }));
    }
  }, [contextMenu.visible]);

  useEffect(() => {
    if (contextMenu.visible && contextMenu.taskId && !currentTask) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      closeMenu();
    }
  }, [contextMenu.visible, contextMenu.taskId, currentTask, closeMenu]);

  const reminderOptions: ReminderOption[] = useMemo(
    () => getReminderOptions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextMenu.visible, minuteTick]
  );

  const handleRightClick = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, taskId });
    setReminderSubmenuOpen(false);
    setMoveSubmenuOpen(false);
  }, []);

  const handleToggleAttribute = useCallback(async (attribute: "isInMyDay" | "importance") => {
    if (!contextMenu.taskId) return;
    const idsToUpdate =
      selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
        ? selectedTasks
        : [contextMenu.taskId];
    try {
      await Promise.all(
        idsToUpdate.map((id) => {
          const task = tasks.find((t) => t.id === id);
          if (!task) return Promise.resolve();
          if (attribute === "importance") {
            return onUpdateAttributes(id, { importance: task.importance === "high" ? "normal" : "high" });
          } else {
            return onUpdateAttributes(id, { isInMyDay: !task.isInMyDay });
          }
        })
      );
    } catch (err) {
      logger.error("Failed to update task attribute from context menu", err);
    }
    if (idsToUpdate.length > 1) onClearSelection();
    closeMenu();
  }, [contextMenu.taskId, selectedTasks, tasks, onUpdateAttributes, onClearSelection, closeMenu]);

  const handleCompleteTask = useCallback(async () => {
    if (!contextMenu.taskId) return;
    const idsToToggle =
      selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
        ? selectedTasks
        : [contextMenu.taskId];
    try {
      await Promise.all(idsToToggle.map((id) => onToggleTask(id)));
    } catch (err) {
      logger.error("Failed to toggle tasks from context menu", err);
    }
    if (idsToToggle.length > 1) onClearSelection();
    closeMenu();
  }, [contextMenu.taskId, selectedTasks, onToggleTask, onClearSelection, closeMenu]);

  const handleDeleteTask = useCallback(() => {
    if (!contextMenu.taskId) return;
    const idsToDelete =
      selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
        ? selectedTasks
        : [contextMenu.taskId];
    const title =
      idsToDelete.length === 1
        ? tasks.find((t) => t.id === idsToDelete[0])?.title || ""
        : `${idsToDelete.length} tasks`;
    setDeleteConfirm({ taskIds: idsToDelete, title });
    closeMenu();
  }, [contextMenu.taskId, selectedTasks, tasks, closeMenu]);

  const handleSetReminder = useCallback((dateTime: string) => {
    if (!contextMenu.taskId) return;
    onUpdateAttributes(contextMenu.taskId, {
      reminderDateTime: { dateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    closeMenu();
  }, [contextMenu.taskId, onUpdateAttributes, closeMenu]);

  const handleRemoveReminder = useCallback(() => {
    if (!contextMenu.taskId) return;
    onUpdateAttributes(contextMenu.taskId, { reminderDateTime: undefined });
    closeMenu();
  }, [contextMenu.taskId, onUpdateAttributes, closeMenu]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteConfirm) return;
    const results = await Promise.allSettled(
      deleteConfirm.taskIds.map((id) => onDeleteTask(id))
    );
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) logger.error(`${failures.length} delete(s) failed`, failures);
    if (deleteConfirm.taskIds.length > 1) onClearSelection();
    setDeleteConfirm(null);
  }, [deleteConfirm, onDeleteTask, onClearSelection]);

  return {
    contextMenu,
    currentTask,
    deleteConfirm,
    setDeleteConfirm,
    reminderSubmenuOpen,
    setReminderSubmenuOpen,
    moveSubmenuOpen,
    setMoveSubmenuOpen,
    menuRef,
    reminderOptions,
    handleRightClick,
    handleToggleAttribute,
    handleCompleteTask,
    handleDeleteTask,
    handleSetReminder,
    handleRemoveReminder,
    handleDeleteConfirmed,
    closeMenu,
  };
}
