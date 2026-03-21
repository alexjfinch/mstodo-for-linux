import "./TaskList.css";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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

  // "Later today" — next even hour, minimum 1h from now
  const laterToday = new Date(now);
  laterToday.setMinutes(0, 0, 0);
  laterToday.setHours(laterToday.getHours() + 2);
  // If it's past 21:00 push to tomorrow 09:00 instead
  const tooLateToday = laterToday.getHours() >= 23 || laterToday.getDate() !== now.getDate();

  // "Tomorrow" — tomorrow at 09:00
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  // "Next week" — next Monday at 09:00
  const nextMonday = new Date(now);
  const dayOfWeek = nextMonday.getDay(); // 0=Sun
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
    options.push({
      label: "Later today",
      subLabel: formatTime(laterToday),
      getDateTime: () => toIso(laterToday),
    });
  }

  options.push({
    label: "Tomorrow",
    subLabel: formatDayTime(tomorrow),
    getDateTime: () => toIso(tomorrow),
  });

  options.push({
    label: "Next week",
    subLabel: formatDayTime(nextMonday),
    getDateTime: () => toIso(nextMonday),
  });

  return options;
}

type SortField = "title" | "dueDate" | "importance" | null;
type SortDirection = "asc" | "desc";

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
  onReorderTasks?: (reorderedIds: string[]) => void;
  showListBadge?: boolean;
  defaultListId?: string;
};

export const TaskList = ({
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
  onReorderTasks,
  showListBadge,
  defaultListId,
}: Props) => {
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    taskId: string | null;
  }>({ visible: false, x: 0, y: 0, taskId: null });

  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskIds: string[]; title: string } | null>(null);
  const [reminderSubmenuOpen, setReminderSubmenuOpen] = useState(false);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const menuRef = useRef<HTMLUListElement>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        // Third click clears sort
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDirection === "asc" ? " \u25B2" : " \u25BC";
  };

  const completedTasks = useMemo(() => tasks.filter((t) => t.completed), [tasks]);

  // Map taskId → custom list display name (only when showListBadge is active)
  const taskListNames = useMemo(() => {
    if (!showListBadge || !allLists || !defaultListId) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (task.listId && task.listId !== defaultListId) {
        const list = allLists.find(l => l.id === task.listId);
        if (list) map.set(task.id, list.displayName);
      }
    }
    return map;
  }, [showListBadge, allLists, defaultListId, tasks]);

  const activeTasks = useMemo(() => {
    const raw = tasks.filter((t) => !t.completed);
    if (!sortField) return raw;
    return [...raw].sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortField === "dueDate") {
        const aDate = a.dueDateTime?.dateTime ?? "";
        const bDate = b.dueDateTime?.dateTime ?? "";
        if (!aDate && !bDate) cmp = 0;
        else if (!aDate) cmp = 1;
        else if (!bDate) cmp = -1;
        else cmp = aDate.localeCompare(bDate);
      } else if (sortField === "importance") {
        const rank = (imp?: string) => imp === "high" ? 0 : imp === "low" ? 2 : 1;
        cmp = rank(a.importance) - rank(b.importance);
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });
  }, [tasks, sortField, sortDirection]);

  // Auto-focus the context menu when it opens for keyboard navigation
  useEffect(() => {
    if (contextMenu.visible && menuRef.current) {
      menuRef.current.focus();
    }
  }, [contextMenu.visible]);

  // Close context menu when clicking outside or scrolling (only when visible)
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

  const handleToggleAttribute = async (attribute: "isInMyDay" | "importance") => {
    if (!contextMenu.taskId) return;

    // Apply to all selected tasks if right-clicked task is in the selection
    const idsToUpdate = selectedTasks.includes(contextMenu.taskId) && selectedTasks.length > 1
      ? selectedTasks
      : [contextMenu.taskId];

    await Promise.all(idsToUpdate.map((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return Promise.resolve();

      if (attribute === "importance") {
        const newValue = task.importance === "high" ? "normal" : "high";
        return onUpdateAttributes(id, { importance: newValue });
      } else if (attribute === "isInMyDay") {
        return onUpdateAttributes(id, { isInMyDay: !task.isInMyDay });
      }
      return Promise.resolve();
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

  const reminderOptions = useMemo(() => getReminderOptions(), // eslint-disable-next-line react-hooks/exhaustive-deps
  [contextMenu.visible]); // Recompute time-relative options each time the menu opens

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

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && !task.completed) onToggleSelection(taskId, true);
    } else {
      onOpenDetail(taskId);
    }
  };

  // Drag-and-drop reordering for active tasks
  const dragGhostRef = useRef<HTMLElement | null>(null);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);

    // Create a 50%-scale ghost image with rounded corners
    const el = e.currentTarget as HTMLElement;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.transform = "scale(0.5)";
    ghost.style.transformOrigin = "top left";
    ghost.style.width = `${el.offsetWidth}px`;
    ghost.style.borderRadius = "8px";
    ghost.style.overflow = "hidden";
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    ghost.style.left = "-9999px";
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
    e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX * 0.5, e.nativeEvent.offsetY * 0.5);
    requestAnimationFrame(() => {
      if (dragGhostRef.current?.parentNode) {
        dragGhostRef.current.parentNode.removeChild(dragGhostRef.current);
        dragGhostRef.current = null;
      }
      el.classList.add("dragging");
    });
  };

  const handleDragOver = (e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (taskId !== draggedTaskId) {
      setDragOverTaskId(taskId);
    }
  };

  const handleDragLeave = () => {
    setDragOverTaskId(null);
  };

  const handleDrop = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    setDragOverTaskId(null);

    if (!draggedTaskId || draggedTaskId === targetTaskId || !onReorderTasks) return;

    const currentIds = activeTasks.map((t) => t.id);
    const fromIndex = currentIds.indexOf(draggedTaskId);
    const toIndex = currentIds.indexOf(targetTaskId);
    if (fromIndex === -1 || toIndex === -1) return;

    const newIds = [...currentIds];
    newIds.splice(fromIndex, 1);
    newIds.splice(toIndex, 0, draggedTaskId);
    onReorderTasks(newIds);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    // Clean up ghost element if rAF hasn't fired yet
    if (dragGhostRef.current?.parentNode) {
      dragGhostRef.current.parentNode.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
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

  const currentTask = contextMenu.taskId ? tasks.find((t) => t.id === contextMenu.taskId) ?? null : null;

  // Close context menu if the referenced task was deleted externally
  useEffect(() => {
    if (contextMenu.visible && contextMenu.taskId && !currentTask) {
      setContextMenu({ visible: false, x: 0, y: 0, taskId: null });
    }
  }, [contextMenu.visible, contextMenu.taskId, currentTask]);

  const renderTask = (task: Task, draggable: boolean = false) => (
    <TaskItem
      key={task.id}
      task={task}
      isSelected={selectedTasks.includes(task.id)}
      isDragOver={dragOverTaskId === task.id}
      onToggleComplete={() => onToggleTask(task.id)}
      onToggleSelection={(e) => handleTaskClick(e, task.id)}
      onToggleImportance={() => handleToggleImportance(task.id)}
      onUpdateDueDate={(date) => handleUpdateDueDate(task.id, date)}
      onRightClick={(e) => handleRightClick(e, task.id)}
      draggable={draggable}
      onDragStart={draggable ? (e) => handleDragStart(e, task.id) : undefined}
      onDragOver={draggable ? (e) => handleDragOver(e, task.id) : undefined}
      onDragLeave={draggable ? handleDragLeave : undefined}
      onDrop={draggable ? (e) => handleDrop(e, task.id) : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      listName={taskListNames.get(task.id)}
    />
  );

  return (
    <>
    {deleteConfirm && (
      <ConfirmDialog
        message={`Delete ${deleteConfirm.taskIds.length === 1 ? `"${deleteConfirm.title}"` : deleteConfirm.title}?`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => { const results = await Promise.allSettled(deleteConfirm.taskIds.map((id) => onDeleteTask(id))); const failures = results.filter((r) => r.status === "rejected"); if (failures.length > 0) logger.error(`${failures.length} delete(s) failed`, failures); if (deleteConfirm.taskIds.length > 1) onClearSelection(); setDeleteConfirm(null); }}
        onCancel={() => setDeleteConfirm(null)}
      />
    )}
    <div className="tasks-container" data-custom-context>
      {/* Column Headers */}
      {activeTasks.length > 0 && (
        <div className="task-list-header" onClick={(e) => e.stopPropagation()}>
          <div className="task-header-cell task-header-checkbox"></div>
          <div
            className={`task-header-cell task-header-title sortable${sortField === "title" ? " sorted" : ""}`}
            onClick={() => handleSort("title")}
          >
            Title{sortIndicator("title")}
          </div>
          <div
            className={`task-header-cell task-header-date sortable${sortField === "dueDate" ? " sorted" : ""}`}
            onClick={() => handleSort("dueDate")}
          >
            Due Date{sortIndicator("dueDate")}
          </div>
          <div
            className={`task-header-cell task-header-importance sortable${sortField === "importance" ? " sorted" : ""}`}
            onClick={() => handleSort("importance")}
          >
            Importance{sortIndicator("importance")}
          </div>
        </div>
      )}

      {/* Active Tasks Section */}
      {activeTasks.length > 0 && (
        <div className="task-section">
          <ul className="task-list">{activeTasks.map((t) => renderTask(t, !!onReorderTasks))}</ul>
        </div>
      )}

      {/* Completed Tasks Section */}
      {completedTasks.length > 0 && (
        <div className="task-section">
          <div
            className="task-section-header"
            role="button"
            tabIndex={0}
            aria-expanded={!completedCollapsed}
            onClick={(e) => { e.stopPropagation(); setCompletedCollapsed(!completedCollapsed); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCompletedCollapsed(!completedCollapsed); } }}
          >
            <span className={`collapse-icon ${completedCollapsed ? "collapsed" : ""}`} aria-hidden>
              ▼
            </span>
            <span>Completed</span>
            <span className="task-count">{completedTasks.length}</span>
          </div>

          {!completedCollapsed && (
            <ul className="task-list">{completedTasks.map((t) => renderTask(t))}</ul>
          )}
        </div>
      )}

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-text">No tasks yet</div>
          <div className="empty-state-subtext">Add a task to get started</div>
        </div>
      )}

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
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            position: "fixed",
          }}
        >
          <li className="context-menu-item" role="menuitem" tabIndex={-1} onClick={handleCompleteTask}>
            {currentTask.completed ? "Mark as Incomplete" : "Mark as Complete"}
          </li>

          <li className="context-menu-divider" />

          <li
            className="context-menu-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleToggleAttribute("isInMyDay")}
          >
            {currentTask.isInMyDay ? "Remove from My Day" : "Add to My Day"}
          </li>

          <li
            className="context-menu-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleToggleAttribute("importance")}
          >
            {currentTask.importance === "high" ? "Mark as Normal" : "Mark as Important"}
          </li>

          <li
            className="context-menu-item context-menu-expandable"
            onClick={() => setReminderSubmenuOpen(!reminderSubmenuOpen)}
          >
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
                <li
                  className="context-menu-item context-menu-inline-option context-menu-item-danger"
                  onClick={handleRemoveReminder}
                >
                  Remove reminder
                </li>
              )}
            </div>
          </div>

          {onMoveTaskToList && allLists && allLists.filter(l => !l.isGroup && l.id !== currentTask.listId).length > 0 && (
            <>
              <li
                className="context-menu-item context-menu-expandable"
                onClick={() => setMoveSubmenuOpen(!moveSubmenuOpen)}
              >
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