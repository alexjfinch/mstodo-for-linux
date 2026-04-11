import "./TaskList.css";
import { useState, useRef, useMemo } from "react";
import { Task, TaskList as TaskListType } from "../types";
import { TaskItem } from "./TaskItem";
import { TaskContextMenu } from "./TaskContextMenu";
import { useTaskContextMenu } from "../hooks/useTaskContextMenu";

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
  weekStartDay?: 0 | 1 | 6;
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
  weekStartDay = 1,
}: Props) => {
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const {
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
  } = useTaskContextMenu({
    tasks,
    selectedTasks,
    onUpdateAttributes,
    onToggleTask,
    onDeleteTask,
    onClearSelection,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
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

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && !task.completed) onToggleSelection(taskId, true);
    } else {
      onOpenDetail(taskId);
    }
  };

  const dragGhostRef = useRef<HTMLElement | null>(null);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);

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
      weekStartDay={weekStartDay}
    />
  );

  return (
    <>
    <TaskContextMenu
      contextMenu={contextMenu}
      currentTask={currentTask}
      menuRef={menuRef}
      deleteConfirm={deleteConfirm}
      reminderSubmenuOpen={reminderSubmenuOpen}
      setReminderSubmenuOpen={setReminderSubmenuOpen}
      moveSubmenuOpen={moveSubmenuOpen}
      setMoveSubmenuOpen={setMoveSubmenuOpen}
      reminderOptions={reminderOptions}
      onClose={closeMenu}
      onCompleteTask={handleCompleteTask}
      onToggleAttribute={handleToggleAttribute}
      onSetReminder={handleSetReminder}
      onRemoveReminder={handleRemoveReminder}
      onDeleteTask={handleDeleteTask}
      onDeleteConfirmed={handleDeleteConfirmed}
      onCancelDelete={() => setDeleteConfirm(null)}
      onMoveTaskToList={onMoveTaskToList}
      allLists={allLists}
    />
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
    </div>
    </>
  );
};
