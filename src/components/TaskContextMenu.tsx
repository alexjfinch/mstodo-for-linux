import { Task, TaskList as TaskListType } from "../types";
import { ReminderOption } from "../utils/reminderOptions";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeleteConfirmState } from "../hooks/useTaskContextMenu";

type Props = {
  contextMenu: { visible: boolean; x: number; y: number; taskId: string | null };
  currentTask: Task | null;
  menuRef: React.RefObject<HTMLUListElement | null>;
  deleteConfirm: DeleteConfirmState;
  reminderSubmenuOpen: boolean;
  setReminderSubmenuOpen: (v: boolean) => void;
  moveSubmenuOpen: boolean;
  setMoveSubmenuOpen: (v: boolean) => void;
  reminderOptions: ReminderOption[];
  onClose: () => void;
  onCompleteTask: () => Promise<void>;
  onToggleAttribute: (attribute: "isInMyDay" | "importance") => Promise<void>;
  onSetReminder: (dateTime: string) => void;
  onRemoveReminder: () => void;
  onDeleteTask: () => void;
  onDeleteConfirmed: () => Promise<void>;
  onCancelDelete: () => void;
  onMoveTaskToList?: (taskId: string, targetListId: string) => Promise<void>;
  allLists?: TaskListType[];
};

export const TaskContextMenu = ({
  contextMenu,
  currentTask,
  menuRef,
  deleteConfirm,
  reminderSubmenuOpen,
  setReminderSubmenuOpen,
  moveSubmenuOpen,
  setMoveSubmenuOpen,
  reminderOptions,
  onClose,
  onCompleteTask,
  onToggleAttribute,
  onSetReminder,
  onRemoveReminder,
  onDeleteTask,
  onDeleteConfirmed,
  onCancelDelete,
  onMoveTaskToList,
  allLists,
}: Props) => {
  const menuElRef = menuRef as React.RefObject<HTMLUListElement>;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
      e.preventDefault();
      const items = menuElRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;
      const active = document.activeElement as HTMLElement;
      const idx = Array.from(items).indexOf(active);
      const forward = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
      const next = forward
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next?.focus();
    }
  };

  const moveableLists = allLists?.filter((l) => !l.isGroup && l.id !== currentTask?.listId) ?? [];

  return (
    <>
      {deleteConfirm && (
        <ConfirmDialog
          message={`Delete ${deleteConfirm.taskIds.length === 1 ? `"${deleteConfirm.title}"` : deleteConfirm.title}?`}
          confirmLabel="Delete"
          danger
          onConfirm={onDeleteConfirmed}
          onCancel={onCancelDelete}
        />
      )}

      {contextMenu.visible && currentTask && (
        <ul
          ref={menuElRef}
          className="context-menu"
          role="menu"
          aria-label="Task actions"
          data-no-close-detail
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          style={{ top: contextMenu.y, left: contextMenu.x, position: "fixed" }}
        >
          <li className="context-menu-item" role="menuitem" tabIndex={-1} onClick={onCompleteTask}>
            {currentTask.completed ? "Mark as Incomplete" : "Mark as Complete"}
          </li>

          <li className="context-menu-divider" />

          <li
            className="context-menu-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => onToggleAttribute("isInMyDay")}
          >
            {currentTask.isInMyDay ? "Remove from My Day" : "Add to My Day"}
          </li>

          <li
            className="context-menu-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => onToggleAttribute("importance")}
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
                  onClick={() => onSetReminder(opt.getDateTime())}
                >
                  <span>{opt.label}</span>
                  <span className="context-menu-hint">{opt.subLabel}</span>
                </li>
              ))}
              {currentTask.reminderDateTime && (
                <li
                  className="context-menu-item context-menu-inline-option context-menu-item-danger"
                  onClick={onRemoveReminder}
                >
                  Remove reminder
                </li>
              )}
            </div>
          </div>

          {onMoveTaskToList && moveableLists.length > 0 && (
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
                  {moveableLists.map((l) => (
                    <li
                      key={l.id}
                      className="context-menu-item context-menu-inline-option"
                      onClick={() => {
                        onMoveTaskToList(currentTask.id, l.id);
                        onClose();
                      }}
                    >
                      <span>{l.emoji || "📝"}</span>
                      <span>{l.displayName}</span>
                    </li>
                  ))}
                </div>
              </div>
            </>
          )}

          <li className="context-menu-divider" />

          <li
            className="context-menu-item context-menu-item-danger"
            role="menuitem"
            tabIndex={-1}
            onClick={onDeleteTask}
          >
            Delete Task
          </li>
        </ul>
      )}
    </>
  );
};
