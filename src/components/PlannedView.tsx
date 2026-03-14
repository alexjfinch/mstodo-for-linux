import { useState, useMemo } from "react";
import { Task } from "../types";
import { TaskItem } from "./TaskItem";

type Props = {
  tasks: Task[];
  onToggleTask: (id: string) => Promise<void>;
  onUpdateAttributes: (id: string, updates: Partial<Task>) => Promise<void>;
  selectedTasks: string[];
  onToggleSelection: (id: string, shiftKey: boolean) => void;
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
  selectedTasks,
  onToggleSelection,
  onOpenDetail,
}: Props) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

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
      // Use the earlier of dueDateTime and reminderDateTime for bucketing
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
      onToggleSelection(taskId, true);
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
      onRightClick={(e) => e.preventDefault()}
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
            onClick={(e) => { e.stopPropagation(); toggleSection(section.key); }}
          >
            <span
              className={`collapse-icon ${
                collapsedSections.has(section.key) ? "collapsed" : ""
              }`}
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
    </div>
  );
};