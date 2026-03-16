import "./TaskDetail.css";
import { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import { Task, TaskAttachment, ChecklistItem, Recurrence } from "../types";
import {
  fetchAttachments,
  uploadAttachment,
  fetchAttachmentContent,
  deleteAttachment,
  fetchChecklistItems,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
} from "../api/graph";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { CustomSelect } from "./CustomSelect";

type Props = {
  task: Task;
  accessToken: string;
  onClose: () => void;
  onUpdateAttributes: (id: string, updates: Partial<Task>) => Promise<void>;
  onToggleComplete: (id: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
};

function recurrenceToOption(r?: Recurrence): string {
  if (!r) return "none";
  // If it's a custom interval/days, still show the base type
  switch (r.pattern.type) {
    case "daily": return "daily";
    case "weekly": return "weekly";
    case "absoluteMonthly": return "monthly";
    case "absoluteYearly": return "yearly";
    default: return "none";
  }
}

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function cleanNotes(body?: Task["body"]): string {
  if (!body) return "";
  return body.content.replace(/#MyDay/g, "").trim();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain",
    csv: "text/csv",
    zip: "application/zip",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

export const TaskDetail = ({
  task,
  accessToken,
  onClose,
  onUpdateAttributes,
  onToggleComplete,
  onDeleteTask,
}: Props) => {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(cleanNotes(task.body));
  const [newCategory, setNewCategory] = useState("");
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [steps, setSteps] = useState<ChecklistItem[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [newStepName, setNewStepName] = useState("");
  const [notesEditing, setNotesEditing] = useState(false);

  // Reset local state when task changes
  useEffect(() => {
    setTitle(task.title);
    setNewCategory("");
    setUploadError(null);
    setDownloadError(null);
    setNewStepName("");
  }, [task.id]);

  // Update notes from external changes (e.g. sync) when not actively editing
  useEffect(() => {
    if (!notesEditing) {
      setNotes(cleanNotes(task.body));
    }
  }, [task.id, task.body, notesEditing]);

  // Fetch attachments and checklist items when task changes
  useEffect(() => {
    if (!task.listId) return;
    setAttachmentsLoading(true);
    fetchAttachments(task.listId, task.id, accessToken)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));

    setStepsLoading(true);
    fetchChecklistItems(task.listId, task.id, accessToken)
      .then(setSteps)
      .catch(() => setSteps([]))
      .finally(() => setStepsLoading(false));
  }, [task.id, task.listId, accessToken]);

  const handleTitleBlur = () => {
    if (title.trim() && title.trim() !== task.title) {
      onUpdateAttributes(task.id, { title: title.trim() });
    } else {
      setTitle(task.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setTitle(task.title);
      e.currentTarget.blur();
    }
  };

  const handleNotesBlur = () => {
    if (notes !== cleanNotes(task.body)) {
      onUpdateAttributes(task.id, {
        body: { content: notes, contentType: "text" },
      });
    }
  };

  const [showDueDateCalendar, setShowDueDateCalendar] = useState(false);
  const [dueDateCalendarMonth, setDueDateCalendarMonth] = useState(() =>
    task.dueDateTime ? new Date(task.dueDateTime.dateTime) : new Date()
  );
  const dueDateCalendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDueDateCalendar) return;
    const handleClick = (e: MouseEvent) => {
      if (dueDateCalendarRef.current && !dueDateCalendarRef.current.contains(e.target as Node)) {
        setShowDueDateCalendar(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDueDateCalendar]);

  const handleRecurrenceTypeChange = (opt: string) => {
    const today = new Date().toISOString().substring(0, 10);
    const startDate = task.dueDateTime?.dateTime.substring(0, 10) || today;
    if (opt === "none") {
      onUpdateAttributes(task.id, { recurrence: undefined });
      return;
    }
    const typeMap: Record<string, Recurrence["pattern"]["type"]> = {
      daily: "daily",
      weekly: "weekly",
      monthly: "absoluteMonthly",
      yearly: "absoluteYearly",
    };
    // Preserve existing interval/daysOfWeek/range if just switching type
    const existing = task.recurrence;
    onUpdateAttributes(task.id, {
      recurrence: {
        pattern: {
          type: typeMap[opt],
          interval: existing?.pattern.interval || 1,
          daysOfWeek: opt === "weekly" ? (existing?.pattern.daysOfWeek || [DAYS_OF_WEEK[new Date().getDay()]]) : undefined,
        },
        range: existing?.range || { type: "noEnd", startDate },
      },
    });
  };

  const handleRecurrenceInterval = (interval: number) => {
    if (!task.recurrence || interval < 1) return;
    onUpdateAttributes(task.id, {
      recurrence: {
        ...task.recurrence,
        pattern: { ...task.recurrence.pattern, interval },
      },
    });
  };

  const handleToggleDayOfWeek = (day: string) => {
    if (!task.recurrence) return;
    const current = task.recurrence.pattern.daysOfWeek || [];
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    if (updated.length === 0) return; // Must have at least one day
    onUpdateAttributes(task.id, {
      recurrence: {
        ...task.recurrence,
        pattern: { ...task.recurrence.pattern, daysOfWeek: updated },
      },
    });
  };

  const handleRecurrenceEndType = (endType: Recurrence["range"]["type"]) => {
    if (!task.recurrence) return;
    const today = new Date().toISOString().substring(0, 10);
    onUpdateAttributes(task.id, {
      recurrence: {
        ...task.recurrence,
        range: { ...task.recurrence.range, type: endType, startDate: task.recurrence.range.startDate || today },
      },
    });
  };

  const handleAddCategory = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newCategory.trim()) {
      const trimmed = newCategory.trim();
      const existing = task.categories || [];
      if (existing.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
        setNewCategory("");
        return;
      }
      onUpdateAttributes(task.id, { categories: [...existing, trimmed] });
      setNewCategory("");
    }
  };

  const handleRemoveCategory = (cat: string) => {
    const updated = (task.categories || []).filter((c) => c !== cat);
    onUpdateAttributes(task.id, { categories: updated });
  };

  const handleAttachFile = async () => {
    if (!task.listId) return;

    const picked = await invoke<{ name: string; content_bytes: string } | null>("pick_and_read_file");
    if (!picked) return;

    setUploading(true);
    setUploadError(null);
    try {
      await uploadAttachment(task.listId, task.id, {
        name: picked.name,
        contentType: mimeFromPath(picked.name),
        contentBytes: picked.content_bytes,
      }, accessToken);
      const updated = await fetchAttachments(task.listId, task.id, accessToken);
      setAttachments(updated);
      onUpdateAttributes(task.id, { hasAttachments: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (attachment: TaskAttachment) => {
    if (!task.listId) return;
    try {
      const { name, contentType, contentBytes } = await fetchAttachmentContent(
        task.listId, task.id, attachment.id, accessToken
      );
      // Decode base64 → binary using fetch + data URL to avoid atob's issues
      // with non-ASCII bytes in WebKitGTK.
      const resp = await fetch(`data:${contentType};base64,${contentBytes}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed. Please try again.");
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!task.listId) return;
    try {
      await deleteAttachment(task.listId, task.id, attachmentId, accessToken);
      setAttachments((prev) => {
        const remaining = prev.filter((a) => a.id !== attachmentId);
        if (remaining.length === 0) {
          onUpdateAttributes(task.id, { hasAttachments: false });
        }
        return remaining;
      });
    } catch {
      setUploadError("Could not delete attachment.");
    }
  };

  const handleAddStep = async () => {
    if (!task.listId || !newStepName.trim()) return;
    try {
      const item = await createChecklistItem(task.listId, task.id, newStepName.trim(), accessToken);
      setSteps((prev) => [...prev, item]);
      setNewStepName("");
    } catch {
      setUploadError("Failed to add step. Please try again.");
    }
  };

  const handleToggleStep = async (item: ChecklistItem) => {
    if (!task.listId) return;
    const updated = { ...item, isChecked: !item.isChecked };
    setSteps((prev) => prev.map((s) => (s.id === item.id ? updated : s)));
    try {
      await updateChecklistItem(task.listId, task.id, item.id, { isChecked: !item.isChecked }, accessToken);
    } catch {
      setSteps((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    }
  };

  const handleDeleteStep = async (itemId: string) => {
    if (!task.listId) return;
    setSteps((prev) => prev.filter((s) => s.id !== itemId));
    try {
      await deleteChecklistItem(task.listId, task.id, itemId, accessToken);
    } catch {
      // re-fetch on error
      fetchChecklistItems(task.listId, task.id, accessToken).then(setSteps).catch(() => {});
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const dueDateDisplay = task.dueDateTime
    ? new Date(task.dueDateTime.dateTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <>
    {showDeleteConfirm && (
      <ConfirmDialog
        message={`Delete "${task.title}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => { setShowDeleteConfirm(false); onDeleteTask(task.id); onClose(); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    )}
    <div className="task-detail-panel">
      <div className="task-detail-header">
        <input
          className="task-detail-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          aria-label="Task title"
        />
      </div>

      <div className="task-detail-content">
        {/* My Day */}
        <div
          className={`task-detail-row${task.isInMyDay ? " active" : ""}`}
          onClick={() => onUpdateAttributes(task.id, { isInMyDay: !task.isInMyDay })}
        >
          <span className="task-detail-row-icon">☀️</span>
          <span className="task-detail-row-label">
            {task.isInMyDay ? "Added to My Day" : "Add to My Day"}
          </span>
          {task.isInMyDay && <span className="task-detail-check">✓</span>}
        </div>

        {/* Due Date */}
        <div className="task-detail-row task-detail-date-row">
          <span className="task-detail-row-icon">📅</span>
          <span className="task-detail-row-label">Due Date</span>
          <div className="task-detail-date-wrapper">
            <button
              className="task-detail-date-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowDueDateCalendar(!showDueDateCalendar);
                setDueDateCalendarMonth(task.dueDateTime ? new Date(task.dueDateTime.dateTime) : new Date());
              }}
            >
              {dueDateDisplay || "Add date"}
            </button>
            {task.dueDateTime && (
              <button
                className="task-detail-date-clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateAttributes(task.id, { dueDateTime: undefined });
                  setShowDueDateCalendar(false);
                }}
                title="Clear due date"
              >
                ×
              </button>
            )}
          </div>
          {showDueDateCalendar && (
            <div className="mini-calendar task-detail-calendar" ref={dueDateCalendarRef}>
              <div className="calendar-header">
                <button onClick={() => setDueDateCalendarMonth(new Date(dueDateCalendarMonth.getFullYear(), dueDateCalendarMonth.getMonth() - 1, 1))}>‹</button>
                <span>{dueDateCalendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                <button onClick={() => setDueDateCalendarMonth(new Date(dueDateCalendarMonth.getFullYear(), dueDateCalendarMonth.getMonth() + 1, 1))}>›</button>
              </div>
              <div className="calendar-weekdays">
                <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
              </div>
              <div className="calendar-days">
                {(() => {
                  const year = dueDateCalendarMonth.getFullYear();
                  const month = dueDateCalendarMonth.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const today = new Date();
                  const selected = task.dueDateTime ? new Date(task.dueDateTime.dateTime) : null;
                  const cells: React.ReactNode[] = [];
                  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e-${i}`} className="calendar-day calendar-day-empty" />);
                  for (let d = 1; d <= daysInMonth; d++) {
                    const dayDate = new Date(year, month, d);
                    const isToday = dayDate.toDateString() === today.toDateString();
                    const isSel = selected && dayDate.toDateString() === selected.toDateString();
                    cells.push(
                      <button
                        key={d}
                        className={`calendar-day${isToday ? " calendar-day-today" : ""}${isSel ? " calendar-day-selected" : ""}`}
                        onClick={() => {
                          onUpdateAttributes(task.id, {
                            dueDateTime: { dateTime: `${dayDate.toISOString().substring(0, 10)}T00:00:00.0000000`, timeZone: "UTC" },
                          });
                          setShowDueDateCalendar(false);
                        }}
                      >
                        {d}
                      </button>
                    );
                  }
                  return cells;
                })()}
              </div>
              {task.dueDateTime && (
                <button
                  className="calendar-remove-btn"
                  onClick={() => {
                    onUpdateAttributes(task.id, { dueDateTime: undefined });
                    setShowDueDateCalendar(false);
                  }}
                >
                  Remove Due Date
                </button>
              )}
            </div>
          )}
        </div>

        {/* Importance */}
        <div
          className={`task-detail-row${task.importance === "high" ? " active" : ""}`}
          onClick={() =>
            onUpdateAttributes(task.id, {
              importance: task.importance === "high" ? "normal" : "high",
            })
          }
        >
          <span className="task-detail-row-icon">⭐</span>
          <span className="task-detail-row-label">
            {task.importance === "high" ? "Important" : "Mark as Important"}
          </span>
          {task.importance === "high" && <span className="task-detail-check">✓</span>}
        </div>

        {/* Steps / Checklist Items */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">
            <span className="task-detail-row-icon">✅</span>
            <span>Steps</span>
            {steps.length > 0 && (
              <span className="task-detail-steps-count">
                {steps.filter((s) => s.isChecked).length}/{steps.length}
              </span>
            )}
          </div>

          {stepsLoading ? (
            <div className="task-detail-attachments-loading">Loading…</div>
          ) : (
            <ul className="task-detail-steps-list">
              {steps.map((step) => (
                <li key={step.id} className={`task-detail-step-item${step.isChecked ? " checked" : ""}`}>
                  <label className="task-detail-step-checkbox-wrapper">
                    <input
                      type="checkbox"
                      checked={step.isChecked}
                      onChange={() => handleToggleStep(step)}
                    />
                  </label>
                  <span className="task-detail-step-name">{step.displayName}</span>
                  <button
                    className="task-detail-step-delete"
                    onClick={() => handleDeleteStep(step.id)}
                    aria-label={`Delete step ${step.displayName}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="task-detail-step-add">
            <input
              type="text"
              className="task-detail-step-input"
              placeholder="Add a step…"
              value={newStepName}
              onChange={(e) => setNewStepName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddStep(); }}
            />
          </div>
        </div>

        {/* Notes */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">
            <span className="task-detail-row-icon">📝</span>
            <span>Notes</span>
            <div className="task-detail-notes-toggle">
              <button
                className={notesEditing ? "active" : ""}
                onClick={() => setNotesEditing(true)}
              >Edit</button>
              <button
                className={!notesEditing ? "active" : ""}
                onClick={() => { setNotesEditing(false); handleNotesBlur(); }}
              >Preview</button>
            </div>
          </div>
          {notesEditing ? (
            <textarea
              className="task-detail-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add a note…"
              rows={4}
              autoFocus
            />
          ) : (
            <div
              className="task-detail-notes-preview"
              onClick={() => setNotesEditing(true)}
            >
              {notes ? <Markdown>{notes}</Markdown> : null}
            </div>
          )}
        </div>

        {/* Recurrence */}
        <div className="task-detail-section">
          <div className="task-detail-row" style={{ borderBottom: "none", paddingBottom: task.recurrence ? 4 : undefined }}>
            <span className="task-detail-row-icon">🔄</span>
            <span className="task-detail-row-label">Repeat</span>
            <CustomSelect
              className="task-detail-select"
              value={recurrenceToOption(task.recurrence)}
              onChange={handleRecurrenceTypeChange}
              options={[
                { value: "none", label: "None" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
          </div>
          {task.recurrence && (
            <div className="recurrence-options">
              <div className="recurrence-interval-row">
                <span>Every</span>
                <input
                  type="number"
                  className="recurrence-interval-input"
                  min={1}
                  max={99}
                  value={task.recurrence.pattern.interval}
                  onChange={(e) => handleRecurrenceInterval(parseInt(e.target.value, 10) || 1)}
                />
                <span>
                  {task.recurrence.pattern.type === "daily" ? "day(s)" :
                   task.recurrence.pattern.type === "weekly" ? "week(s)" :
                   task.recurrence.pattern.type === "absoluteMonthly" ? "month(s)" : "year(s)"}
                </span>
              </div>
              {task.recurrence.pattern.type === "weekly" && (
                <div className="recurrence-days-row">
                  {DAYS_OF_WEEK.map((day, i) => (
                    <button
                      key={day}
                      className={`recurrence-day-btn${(task.recurrence!.pattern.daysOfWeek || []).includes(day) ? " active" : ""}`}
                      onClick={() => handleToggleDayOfWeek(day)}
                    >
                      {DAY_LABELS[i]}
                    </button>
                  ))}
                </div>
              )}
              <div className="recurrence-end-row">
                <span>Ends</span>
                <CustomSelect
                  className="task-detail-select"
                  value={task.recurrence.range.type}
                  onChange={(v) => handleRecurrenceEndType(v as Recurrence["range"]["type"])}
                  options={[
                    { value: "noEnd", label: "Never" },
                    { value: "endDate", label: "On a date" },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">
            <span className="task-detail-row-icon">🏷️</span>
            <span>Categories</span>
          </div>
          <div className="task-detail-categories">
            {(task.categories || []).map((cat) => (
              <span key={cat} className="task-detail-category-tag">
                {cat}
                <button
                  className="task-detail-category-remove"
                  onClick={() => handleRemoveCategory(cat)}
                  aria-label={`Remove ${cat}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              className="task-detail-category-input"
              placeholder="Add category…"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={handleAddCategory}
            />
          </div>
        </div>
        {/* Attachments */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">
            <span className="task-detail-row-icon">📎</span>
            <span>Attachments</span>
          </div>

          {attachmentsLoading ? (
            <div className="task-detail-attachments-loading">Loading…</div>
          ) : (
            <div className="task-detail-attachments-list">
              {attachments.map((att) => (
                <div key={att.id} className="task-detail-attachment-item">
                  <span className="task-detail-attachment-name" title={att.name}>
                    {att.name}
                  </span>
                  <span className="task-detail-attachment-size">
                    {formatFileSize(att.size)}
                  </span>
                  <button
                    className="task-detail-attachment-action"
                    onClick={() => handleDownload(att)}
                    title="Download"
                  >
                    ⬇
                  </button>
                  <button
                    className="task-detail-attachment-action task-detail-attachment-delete"
                    onClick={() => handleDeleteAttachment(att.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadError && (
            <div className="task-detail-attachment-error">{uploadError}</div>
          )}
          {downloadError && (
            <div className="task-detail-attachment-error">{downloadError}</div>
          )}

          <button
            className="task-detail-attach-btn"
            onClick={() => { setUploadError(null); handleAttachFile(); }}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "+ Attach File"}
          </button>
        </div>
      </div>

      <div className="task-detail-footer">
        <button className="task-detail-complete-btn" onClick={() => onToggleComplete(task.id)}>
          {task.completed ? "Mark Incomplete" : "Mark Complete"}
        </button>
        <button className="task-detail-delete-btn" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
    </>
  );
};
