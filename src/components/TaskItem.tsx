import "./TaskItem.css";
import { useState, useRef, useEffect, useMemo } from "react";
import { Task } from "../types";

type Props = {
  task: Task;
  isSelected: boolean;
  isDragOver?: boolean;
  onToggleComplete: () => void;
  onToggleSelection: (e: React.MouseEvent) => void;
  onToggleImportance: () => void;
  onUpdateDueDate: (date: string | undefined) => void;
  onRightClick: (e: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
};

export const TaskItem = ({
  task,
  isSelected,
  isDragOver,
  onToggleComplete,
  onToggleSelection,
  onToggleImportance,
  onUpdateDueDate,
  onRightClick,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) => {
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [dateInputValue, setDateInputValue] = useState("");
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [isHoveringDate, setIsHoveringDate] = useState(false);

  const isOverdue = useMemo(() => {
    if (task.completed || !task.dueDateTime) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDateTime.dateTime);
    due.setHours(0, 0, 0, 0);
    return due < today;
  }, [task.completed, task.dueDateTime]);

  const dateInputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditingDate && dateInputRef.current) {
      dateInputRef.current.focus();
    }
  }, [isEditingDate]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        calendarRef.current &&
        !calendarRef.current.contains(e.target as Node)
      ) {
        setShowCalendar(false);
      }
    };

    if (showCalendar) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCalendar]);

  const formatDisplayDate = (dateTime?: { dateTime: string; timeZone: string }) => {
    if (!dateTime) return "";
    const d = new Date(dateTime.dateTime);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleDateClick = () => {
    setIsEditingDate(true);
    // Pre-populate with current date in DD/MM/YYYY format if exists
    if (task.dueDateTime) {
      const d = new Date(task.dueDateTime.dateTime);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      setDateInputValue(`${day}/${month}/${year}`);
    } else {
      setDateInputValue("");
    }
  };

  const handleCalendarIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowCalendar(!showCalendar);
    setIsEditingDate(false);
  };

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateInputValue(e.target.value);
  };

  const handleDateInputBlur = () => {
    const trimmed = dateInputValue.trim();
    
    // If empty, remove the date
    if (!trimmed) {
      onUpdateDueDate(undefined);
      setIsEditingDate(false);
      setDateInputValue("");
      return;
    }
    
    // Try to parse multiple date formats
    let parsed: Date | null = null;
    
    // Try DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyyMatch) {
      const day = parseInt(ddmmyyyyMatch[1]);
      const month = parseInt(ddmmyyyyMatch[2]) - 1;
      const year = parseInt(ddmmyyyyMatch[3]);
      parsed = new Date(year, month, day);
    }
    
    // Try YYYY-MM-DD
    if (!parsed || isNaN(parsed.getTime())) {
      const yyyymmddMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (yyyymmddMatch) {
        const year = parseInt(yyyymmddMatch[1]);
        const month = parseInt(yyyymmddMatch[2]) - 1;
        const day = parseInt(yyyymmddMatch[3]);
        parsed = new Date(year, month, day);
      }
    }
    
    // Try natural language parsing (tomorrow, today, etc.)
    if (!parsed || isNaN(parsed.getTime())) {
      parsed = new Date(dateInputValue);
    }
    
    if (parsed && !isNaN(parsed.getTime())) {
      onUpdateDueDate(parsed.toISOString());
    }
    
    setIsEditingDate(false);
    setDateInputValue("");
  };

  const handleDateInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleDateInputBlur();
    } else if (e.key === "Escape") {
      setIsEditingDate(false);
      setDateInputValue("");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (dateInputValue === "") {
        onUpdateDueDate(undefined);
        setIsEditingDate(false);
      }
    }
  };

  const handleDateSelect = (date: Date) => {
    onUpdateDueDate(date.toISOString());
    setShowCalendar(false);
  };

  const handleRemoveDate = () => {
    onUpdateDueDate(undefined);
    setShowCalendar(false);
  };

  const renderCalendar = () => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (number | null)[] = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const today = new Date();
    const selectedDate = task.dueDateTime ? new Date(task.dueDateTime.dateTime) : null;

    return (
      <div className="mini-calendar" ref={calendarRef}>
        <div className="calendar-header">
          <button
            onClick={() =>
              setCalendarDate(new Date(year, month - 1, 1))
            }
          >
            ‹
          </button>
          <span>
            {calendarDate.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <button
            onClick={() =>
              setCalendarDate(new Date(year, month + 1, 1))
            }
          >
            ›
          </button>
        </div>

        <div className="calendar-weekdays">
          <div>Su</div>
          <div>Mo</div>
          <div>Tu</div>
          <div>We</div>
          <div>Th</div>
          <div>Fr</div>
          <div>Sa</div>
        </div>

        <div className="calendar-days">
          {days.map((day, i) => {
            if (day === null) {
              return <div key={`empty-${i}`} className="calendar-day calendar-day-empty" />;
            }

            const dayDate = new Date(year, month, day);
            const isToday =
              dayDate.toDateString() === today.toDateString();
            const isSelected =
              selectedDate &&
              dayDate.toDateString() === selectedDate.toDateString();

            return (
              <button
                key={day}
                className={`calendar-day ${isToday ? "calendar-day-today" : ""} ${
                  isSelected ? "calendar-day-selected" : ""
                }`}
                onClick={() => handleDateSelect(dayDate)}
              >
                {day}
              </button>
            );
          })}
        </div>

        {task.dueDateTime && (
          <button className="calendar-remove-btn" onClick={handleRemoveDate}>
            Remove Due Date
          </button>
        )}
      </div>
    );
  };

  return (
    <li
      className={`task-item ${task.completed ? "completed" : ""} ${
        isSelected ? "selected" : ""
      }${isDragOver ? " drag-over" : ""}${isOverdue ? " overdue" : ""}`}
      onContextMenu={onRightClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Checkbox */}
      <div className="task-cell task-cell-checkbox">
        <label className="task-checkbox-wrapper">
          <input
            type="checkbox"
            className="task-checkbox"
            checked={task.completed}
            onChange={(e) => {
              e.stopPropagation();
              onToggleComplete();
            }}
            aria-label={`Mark "${task.title}" as ${task.completed ? "incomplete" : "complete"}`}
          />
        </label>
      </div>

      {/* Title */}
      <div
        className="task-cell task-cell-title"
        onClick={onToggleSelection}
      >
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {task.isInMyDay && <span className="badge-myday">My Day</span>}
          {task.hasAttachments && (
            <span className="badge-attachment" title="Has attachments">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z"/>
              </svg>
            </span>
          )}
        </div>
        {isOverdue && (
          <span className="task-overdue">Overdue. {formatDisplayDate(task.dueDateTime)}</span>
        )}
      </div>

      {/* Due Date */}
      <div 
        className="task-cell task-cell-date" 
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsHoveringDate(true)}
        onMouseLeave={() => setIsHoveringDate(false)}
      >
        {isEditingDate ? (
          <div className="date-input-wrapper">
            <button
              className="calendar-icon-btn"
              onClick={handleCalendarIconClick}
              title="Open calendar"
              aria-label="Open calendar"
            >
              📅
            </button>
            <input
              ref={dateInputRef}
              type="text"
              className="task-date-text-input"
              value={dateInputValue}
              onChange={handleDateInputChange}
              onBlur={handleDateInputBlur}
              onKeyDown={handleDateInputKeyDown}
              placeholder="e.g., 20/01/2025, 2025-01-20, tomorrow"
            />
          </div>
        ) : (
          <>
            {task.dueDateTime ? (
              <div className="date-display-wrapper">
                <div className="date-display" onClick={handleDateClick}>
                  {formatDisplayDate(task.dueDateTime)}
                </div>
                {isHoveringDate && (
                  <>
                    <button
                      className="calendar-icon-btn"
                      onClick={handleCalendarIconClick}
                      title="Open calendar"
                    >
                      📅
                    </button>
                    <button
                      className="date-clear-btn"
                      onClick={(e) => { e.stopPropagation(); onUpdateDueDate(undefined); }}
                      title="Clear due date"
                      aria-label="Clear due date"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ) : (
              isHoveringDate && (
                <div className="date-input-wrapper date-input-hover">
                  <button
                    className="calendar-icon-btn"
                    onClick={handleCalendarIconClick}
                    title="Open calendar"
                  >
                    📅
                  </button>
                  <div
                    className="task-date-text-input-placeholder"
                    onClick={handleDateClick}
                  >
                    Add date
                  </div>
                </div>
              )
            )}
          </>
        )}
        {showCalendar && renderCalendar()}
      </div>

      {/* Importance */}
      <div className="task-cell task-cell-importance" onClick={(e) => e.stopPropagation()}>
        <button
          className={`task-importance-btn ${
            task.importance === "high" ? "important" : ""
          }`}
          onClick={onToggleImportance}
        >
          <span className="importance-star">
            {task.importance === "high" ? "★" : "☆"}
          </span>
          <span className="importance-label">
            {task.importance === "high" ? "Important" : "Normal"}
          </span>
        </button>
      </div>
    </li>
  );
};