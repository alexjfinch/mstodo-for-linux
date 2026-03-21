import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Task, TaskList as TaskListType } from "../types";
import { TaskItem } from "./TaskItem";
import { ConfirmDialog } from "./ConfirmDialog";
import { logger } from "../services/logger";

type ReminderOption = {
  label: string;
  subLabel: string;
  getDateTime: () => string;
};

function getReminderOptions(): ReminderOption[] {
  const now = new Date();

  const laterToday = new Date(now);
  laterToday.setMinutes(0, 0, 0);
  laterToday.setHours(laterToday.getHours() + 2);
  const tooLateToday = laterToday.getHours() >= 23 || laterToday.getDate() !== now.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextMonday = new Date(now);
  const dayOfWeek = nextMonday.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const formatDayTime = (d: Date) =>
    `${d.toLocaleDateString(undefined, { weekday: "short" })} ${formatTime(d)}`;
  const toIso = (d: Date) => d.toISOString();

  const options: ReminderOption[] = [];
  if (!tooLateToday) {
    options.push({ label: "Later today", subLabel: formatTime(laterToday), getDateTime: () => toIso(laterToday) });
  }
  options.push({ label: "Tomorrow", subLabel: formatDayTime(tomorrow), getDateTime: () => toIso(tomorrow) });
  options.push({ label: "Next week", subLabel: formatDayTime(nextMonday), getDateTime: () => toIso(nextMonday) });
  return options;
}

type Props = {
  tasks: Task[];
  onToggleTask: (id: string) => Promise<void>;
  onUpdateAttributes: (id: string, updates: Partial<Task>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onMoveTaskToList?: (taskId: string, targetListId: string) => Promise<void>;
  allLists?: TaskListType[];
  selectedTasks: string[];
  onToggleSelection: (id: string, shiftKey: boolean) => void;
  onClearSelection: () => void;
  onOpenDetail: (id: string) => void;
};

type DateSection = {
  key: string;
  title: string;
  tasks: Task[];
};

export const PlannedView = ({
  tasks,
  onToggleTask,
  onUpdateAttributes,
  onDeleteTask,
  onMoveTaskToList,
  allLists,
  selectedTasks,
  onToggleSelection,
  onClearSelection,
  onOpenDetail,
}: Props) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    taskId: string | null;
  }>({ visible: false, x: 0, y: 0, taskId: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskIds: string[]; title: string } | null>(null);
  const [reminderSubmenuOpen, setReminderSubmenuOpen] = useState(false);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);

  const menuRef = useRef<HTMLUListElement>(null);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Auto-focus the context menu when it opens for keyboard navigation
  useEffect(() => {
    if (contextMenu.visible && menuRef.current) {
      menuRef.current.focus();
    }
  }, [contextMenu.visible]);

  // Close context menu when clicking outside or scrolling
  useEffect(() => {
    if (!contextMenu.visible) return;
    const closeMenu = () => setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
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
  }, [contextMenu.visible]);

  const handleRightClick = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    const menuW = 180, menuH = 160;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 4);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 4);
    setContextMenu({ visible: true, x, y, taskId });
    setReminderSubmenuOpen(false);
    setMoveSubmenuOpen(false);
  };

  const currentTask = contextMenu.taskId ? tasks.find((t) => t.id === contextMenu.taskId) ?? null : null;

  // Close context menu if the referenced task was deleted externally
  useEffect(() => {
    if (contextMenu.visible && contextMenu.taskId && !currentTask) {
      setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
    }
  }, [contextMenu.visible, contextMenu.taskId, currentTask]);

  const handleToggleAttribute = async (attribute: "isInMyDay" | "importance") => {
    if (!contextMenu.taskId) return;
    const idsToUpdate = selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
      ? selectedTasks
      : [contextMenu.taskId];
    await Promise.all(idsToUpdate.map((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return Promise.resolve();
      if (attribute === "importance") {
        return onUpdateAttributes(id, { importance: task.importance === "high" ? "normal" : "high" });
      } else {
        return onUpdateAttributes(id, { isInMyDay: !task.isInMyDay });
      }
    }));
    if (idsToUpdate.length > 1) onClearSelection();
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  };

  const handleCompleteTask = async () => {
    if (!contextMenu.taskId) return;
    const idsToToggle = selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
      ? selectedTasks
      : [contextMenu.taskId];
    await Promise.all(idsToToggle.map((id) => onToggleTask(id)));
    if (idsToToggle.length > 1) onClearSelection();
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  };

  const handleDeleteTask = () => {
    if (!contextMenu.taskId) return;
    const idsToDelete = selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
      ? selectedTasks
      : [contextMenu.taskId];
    const title = idsToDelete.length === 1
      ? tasks.find((t) => t.id === idsToDelete[0])?.title || ""
      : `${idsToDelete.length} tasks`;
    setDeleteConfirm({ taskIds: idsToDelete, title });
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  };

  // Re-compute relative time labels each time the context menu opens so
  // "in 1 hour" etc. are fresh. getReminderOptions() has no external deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reminderOptions = useMemo(() => getReminderOptions(), [contextMenu.visible]);

  const handleSetReminder = useCallback((dateTime: string) => {
    if (!contextMenu.taskId) return;
    onUpdateAttributes(contextMenu.taskId, {
      reminderDateTime: { dateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  }, [contextMenu.taskId, onUpdateAttributes]);

  const handleRemoveReminder = useCallback(() => {
    if (!contextMenu.taskId) return;
    onUpdateAttributes(contextMenu.taskId, { reminderDateTime: undefined });
    setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
  }, [contextMenu.taskId, onUpdateAttributes]);

  const sections = useMemo((): DateSection[] => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(tomorrow);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const earlier: Task[] = [];
    const todayTasks: Task[] = [];
    const tomorrowTasks: Task[] = [];
    const thisWeek: Task[] = [];
    const later: Task[] = [];

    const placed = new Set<string>();

    const placeInBucket = (task: Task, date: Date) => {
      if (placed.has(task.id)) return;
      placed.add(task.id);
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (dateOnly < today) {
        earlier.push(task);
      } else if (dateOnly.getTime() === today.getTime()) {
        todayTasks.push(task);
      } else if (dateOnly.getTime() === tomorrow.getTime()) {
        tomorrowTasks.push(task);
      } else if (dateOnly > tomorrow && dateOnly < weekEnd) {
        thisWeek.push(task);
      } else {
        later.push(task);
      }
    };

    tasks.forEach((task) => {
      if (task.completed) return;
      const dates: Date[] = [];
      if (task.dueDateTime) dates.push(new Date(task.dueDateTime.dateTime));
      if (task.reminderDateTime) dates.push(new Date(task.reminderDateTime.dateTime));
      if (dates.length === 0) return;
      dates.sort((a, b) => a.getTime() - b.getTime());
      placeInBucket(task, dates[0]);
    });

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
    const lastDayOfWeek = new Date(weekEnd);
    lastDayOfWeek.setDate(lastDayOfWeek.getDate() - 1);

    const weekRangeTitle = `${dayAfterTomorrow.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} to ${lastDayOfWeek.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`;

    const result: DateSection[] = [];
    if (earlier.length > 0) result.push({ key: "earlier", title: "Earlier", tasks: earlier });
    if (todayTasks.length > 0) result.push({ key: "today", title: "Today", tasks: todayTasks });
    if (tomorrowTasks.length > 0) result.push({ key: "tomorrow", title: "Tomorrow", tasks: tomorrowTasks });
    if (thisWeek.length > 0) result.push({ key: "week", title: weekRangeTitle, tasks: thisWeek });
    if (later.length > 0) result.push({ key: "later", title: "Later", tasks: later });
    return result;
  }, [tasks]);

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && !task.completed) onToggleSelection(taskId, true);
    } else {
      onOpenDetail(taskId);
    }
  };

  const handleUpdateDueDate = (taskId: string, dateTime: string | undefined) => {
    onUpdateAttributes(taskId, {
      dueDateTime: dateTime ? { dateTime, timeZone: "UTC" } : undefined,
    });
  };

  const handleToggleImportance = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newValue = task.importance === "high" ? "normal" : "high";
    onUpdateAttributes(taskId, { importance: newValue });
  };

  const renderTask = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      isSelected={selectedTasks.includes(task.id)}
      onToggleComplete={() => onToggleTask(task.id)}
      onToggleSelection={(e) => handleTaskClick(e, task.id)}
      onToggleImportance={() => handleToggleImportance(task.id)}
      onUpdateDueDate={(date) => handleUpdateDueDate(task.id, date)}
      onRightClick={(e) => handleRightClick(e, task.id)}
    />
  );

  if (sections.length === 0) {
    return (
      <div className="tasks-container">
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <div className="empty-state-text">No planned tasks</div>
          <div className="empty-state-subtext">Tasks with due dates or reminders will appear here</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {deleteConfirm && (
        <ConfirmDialog
          message={`Delete ${deleteConfirm.taskIds.length === 1 ? `"${deleteConfirm.title}"` : deleteConfirm.title}?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            const results = await Promise.allSettled(deleteConfirm.taskIds.map((id) => onDeleteTask(id)));
            const failures = results.filter((r) => r.status === "rejected");
            if (failures.length > 0) logger.error(`${failures.length} delete(s) failed`, failures);
            if (deleteConfirm.taskIds.length > 1) onClearSelection();
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
      <div className="tasks-container">
        {/* Column Headers */}
        <div className="task-list-header" onClick={(e) => e.stopPropagation()}>
          <div className="task-header-cell task-header-checkbox"></div>
          <div className="task-header-cell task-header-title">Title</div>
          <div className="task-header-cell task-header-date">Due Date</div>
          <div className="task-header-cell task-header-importance">Importance</div>
        </div>

        {/* Date Sections */}
        {sections.map((section) => (
          <div key={section.key} className="task-section">
            <div
              className="task-section-header"
              role="button"
              tabIndex={0}
              aria-expanded={!collapsedSections.has(section.key)}
              onClick={(e) => { e.stopPropagation(); toggleSection(section.key); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(section.key); } }}
            >
              <span
                className={`collapse-icon ${
                  collapsedSections.has(section.key) ? "collapsed" : ""
                }`}
                aria-hidden
              >
                ▼
              </span>
              <span>{section.title}</span>
              <span className="task-count">{section.tasks.length}</span>
            </div>

            {!collapsedSections.has(section.key) && (
              <ul className="task-list">{section.tasks.map(renderTask)}</ul>
            )}
          </div>
        ))}

        {/* Context Menu */}
        {contextMenu.visible && currentTask && (
          <ul
            ref={menuRef}
            className="context-menu"
            role="menu"
            aria-label="Task actions"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
                if (!items || items.length === 0) return;
                const active = document.activeElement as HTMLElement;
                const idx = Array.from(items).indexOf(active);
                const next = e.key === "ArrowDown"
                  ? items[(idx + 1) % items.length]
                  : items[(idx - 1 + items.length) % items.length];
                next?.focus();
              }
            }}
            style={{ top: contextMenu.y, left: contextMenu.x, position: "fixed" }}
          >
            <li className="context-menu-item" role="menuitem" tabIndex={-1} onClick={handleCompleteTask}>
              {currentTask.completed ? "Mark as Incomplete" : "Mark as Complete"}
            </li>

            <li className="context-menu-divider" />

            <li className="context-menu-item" role="menuitem" tabIndex={-1} onClick={() => handleToggleAttribute("isInMyDay")}>
              {currentTask.isInMyDay ? "Remove from My Day" : "Add to My Day"}
            </li>

            <li className="context-menu-item" role="menuitem" tabIndex={-1} onClick={() => handleToggleAttribute("importance")}>
              {currentTask.importance === "high" ? "Mark as Normal" : "Mark as Important"}
            </li>

            <li className="context-menu-item context-menu-expandable" onClick={() => setReminderSubmenuOpen(!reminderSubmenuOpen)}>
              <span>Remind me</span>
              <span className={`context-menu-arrow ${reminderSubmenuOpen ? "expanded" : ""}`}>▸</span>
            </li>
            <div className={`context-menu-expand-panel ${reminderSubmenuOpen ? "open" : ""}`}>
              <div className="context-menu-expand-inner">
                {reminderOptions.map((opt) => (
                  <li
                    key={opt.label}
                    className="context-menu-item context-menu-inline-option"
                    onClick={() => handleSetReminder(opt.getDateTime())}
                  >
                    <span>{opt.label}</span>
                    <span className="context-menu-hint">{opt.subLabel}</span>
                  </li>
                ))}
                {currentTask.reminderDateTime && (
                  <li className="context-menu-item context-menu-inline-option context-menu-item-danger" onClick={handleRemoveReminder}>
                    Remove reminder
                  </li>
                )}
              </div>
            </div>

            {onMoveTaskToList && allLists && allLists.filter(l => !l.isGroup && l.id !== currentTask.listId).length > 0 && (
              <>
                <li className="context-menu-item context-menu-expandable" onClick={() => setMoveSubmenuOpen(!moveSubmenuOpen)}>
                  <span>Move to list</span>
                  <span className={`context-menu-arrow ${moveSubmenuOpen ? "expanded" : ""}`}>▸</span>
                </li>
                <div className={`context-menu-expand-panel ${moveSubmenuOpen ? "open" : ""}`}>
                  <div className="context-menu-expand-inner">
                    {allLists
                      .filter(l => !l.isGroup && l.id !== currentTask.listId)
                      .map(l => (
                        <li
                          key={l.id}
                          className="context-menu-item context-menu-inline-option"
                          onClick={() => {
                            onMoveTaskToList(currentTask.id, l.id);
                            setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
                          }}
                        >
                          <span>{l.emoji || "📝"}</span>
                          <span>{l.displayName}</span>
                        </li>
                      ))
                    }
                  </div>
                </div>
              </>
            )}

            <li className="context-menu-divider" />

            <li className="context-menu-item context-menu-item-danger" role="menuitem" tabIndex={-1} onClick={handleDeleteTask}>
              Delete Task
            </li>
          </ul>
        )}
      </div>
    </>
  );
};
