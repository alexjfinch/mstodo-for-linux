import "./Sidebar.css";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { ListName, TaskList } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmState = { message: string; danger?: boolean; onConfirm: () => void };

const LIST_COLORS = [
  "#2196F3", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0",
  "#00BCD4", "#FF5722", "#795548", "#607D8B", "#F44336",
];

type Props = {
  activeList: ListName | string;
  onSelectList: (list: ListName | string) => void;
  onOpenSettings: () => void;
  allLists: TaskList[];
  customLists: TaskList[];
  groups: TaskList[];
  allCustomLists: TaskList[];
  onCreateList: (name: string) => void;
  onRenameList?: (listId: string, newName: string) => void;
  onUpdateListTheme?: (listId: string, updates: { emoji?: string | null; themeColor?: string | null }) => void;
  onDeleteList?: (listId: string) => void;
  onCreateSubList: (groupId: string, name: string) => void;
  onCreateGroup: (name: string) => void;
  onConvertToGroup: (listId: string) => void;
  onMoveToGroup: (listId: string, groupId: string | null) => void;
  isOnline: boolean;
  syncing: boolean;
  syncError: string | null;
  lastSyncTime: Date | null;
  taskCounts?: Record<string, number>;
  onMoveTaskToList?: (taskId: string, targetListId: string) => Promise<void>;
  onAddToMyDay?: (taskId: string) => void;
  onMarkImportant?: (taskId: string) => void;
};

export const Sidebar = ({
  activeList,
  onSelectList,
  onOpenSettings,
  allLists,
  customLists,
  groups,
  allCustomLists,
  onCreateList,
  onRenameList,
  onUpdateListTheme,
  onDeleteList,
  onCreateSubList,
  onCreateGroup,
  onConvertToGroup,
  onMoveToGroup,
  isOnline,
  syncing,
  syncError,
  lastSyncTime,
  taskCounts = {},
  onMoveTaskToList,
  onAddToMyDay,
  onMarkImportant,
}: Props) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [addingSubListToGroup, setAddingSubListToGroup] = useState<string | null>(null);
  const [newSubListName, setNewSubListName] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [themingListId, setThemingListId] = useState<string | null>(null);
  const [emojiInput, setEmojiInput] = useState("");
  const themePickerRef = useRef<HTMLDivElement>(null);

  // Memoize combined list to avoid re-creating on every render
  const allListsWithGroups = useMemo(() => [...allCustomLists, ...groups], [allCustomLists, groups]);

  // Close theme picker on click outside
  useEffect(() => {
    if (!themingListId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemingListId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [themingListId]);

  const flaggedEmailsList = allLists.find(l => l.wellknownListName === "flaggedEmails");

  const builtInLists: ListName[] = ["My Day", "Important", "Planned", "Assigned to Me"];
  if (flaggedEmailsList) builtInLists.push("Flagged Emails");
  builtInLists.push("Tasks");

  const getListIcon = (list: ListName) => {
    switch (list) {
      case "My Day": return "☀️";
      case "Important": return "⭐";
      case "Planned": return "📅";
      case "Assigned to Me": return "👤";
      case "Flagged Emails": return "🚩";
      case "Tasks": return "📋";
      default: return "📝";
    }
  };

  const showConfirm = (message: string, onConfirm: () => void, danger = true) => {
    setConfirmState({ message, onConfirm, danger });
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleCreateList = () => {
    if (newListName.trim()) {
      onCreateList(newListName.trim());
      setNewListName("");
      setIsCreatingList(false);
    }
  };

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      onCreateGroup(newGroupName.trim());
      setNewGroupName("");
      setIsCreatingGroup(false);
    }
  };

  const handleCreateSubList = (groupId: string) => {
    if (newSubListName.trim()) {
      onCreateSubList(groupId, newSubListName.trim());
      setNewSubListName("");
      setAddingSubListToGroup(null);
    }
  };

  const startAddingSubList = (groupId: string) => {
    setAddingSubListToGroup(groupId);
    setNewSubListName("");
    setCollapsedGroups(prev => ({ ...prev, [groupId]: false }));
  };

  const startRenaming = (listId: string, currentName: string) => {
    setRenamingListId(listId);
    setRenameValue(currentName);
  };

  const commitRename = () => {
    if (renamingListId && renameValue.trim() && onRenameList) {
      onRenameList(renamingListId, renameValue.trim());
    }
    setRenamingListId(null);
    setRenameValue("");
  };

  const startTheming = (listId: string) => {
    const list = allListsWithGroups.find(l => l.id === listId);
    setThemingListId(listId);
    setEmojiInput(list?.emoji || "");
  };

  const renderThemePicker = (listId: string) => {
    if (themingListId !== listId) return null;
    const list = allListsWithGroups.find(l => l.id === listId);
    return (
      <div ref={themePickerRef} className="sidebar-theme-picker" onClick={(e) => e.stopPropagation()}>
        <div className="sidebar-theme-colors">
          {LIST_COLORS.map(c => (
            <button
              key={c}
              className={`sidebar-theme-swatch${list?.themeColor === c ? " active" : ""}`}
              style={{ background: c }}
              onClick={() => onUpdateListTheme?.(listId, { themeColor: c })}
              aria-label={`Set color to ${c}`}
            />
          ))}
          {list?.themeColor && (
            <button
              className="sidebar-theme-swatch sidebar-theme-clear"
              onClick={() => onUpdateListTheme?.(listId, { themeColor: null })}
              title="Remove colour"
              aria-label="Remove list color"
            >×</button>
          )}
        </div>
        <div className="sidebar-theme-emoji-row">
          <input
            type="text"
            className="sidebar-theme-emoji-input"
            placeholder="Emoji"
            value={emojiInput}
            maxLength={2}
            onChange={(e) => setEmojiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdateListTheme?.(listId, { emoji: emojiInput || null });
                setThemingListId(null);
              }
            }}
          />
          <button
            className="sidebar-theme-emoji-save"
            onClick={() => { onUpdateListTheme?.(listId, { emoji: emojiInput || null }); setThemingListId(null); }}
            aria-label="Save emoji"
          >✓</button>
        </div>
        <button className="sidebar-theme-done" onClick={() => setThemingListId(null)}>Done</button>
      </div>
    );
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, listId: string) => {
    e.dataTransfer.setData("listId", listId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(groupId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the group element itself, not a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverGroupId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    setDragOverGroupId(null);
    const listId = e.dataTransfer.getData("listId");
    if (listId && listId !== groupId) {
      onMoveToGroup(listId, groupId);
      // Expand the group so the user sees the dropped list
      setCollapsedGroups(prev => ({ ...prev, [groupId]: false }));
    }
  };

  const handleDragEnd = () => {
    setDragOverGroupId(null);
  };

  // Task-to-list drop: accept tasks dragged from TaskList onto sidebar items
  const [taskDropTarget, setTaskDropTarget] = useState<string | null>(null);

  const handleTaskDragOver = (e: React.DragEvent, targetId: string) => {
    // Only accept if it's a task drag (has text/plain but no listId)
    if (e.dataTransfer.types.includes("text/plain") && !e.dataTransfer.types.includes("listId")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setTaskDropTarget(targetId);
    }
  };

  const handleTaskDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setTaskDropTarget(null);
    }
  };

  const handleTaskDrop = (e: React.DragEvent, targetId: string) => {
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    e.preventDefault();
    setTaskDropTarget(null);

    if (targetId === "My Day") {
      onAddToMyDay?.(taskId);
    } else if (targetId === "Important") {
      onMarkImportant?.(taskId);
    } else {
      // It's a real list ID — move task to that list
      onMoveTaskToList?.(taskId, targetId);
    }
  };

  return (
    <>
      <aside className={`sidebar${isCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <button
            className="hamburger-btn"
            onClick={() => setIsCollapsed(c => !c)}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 5h14v1.5H3V5zm0 4.25h14v1.5H3v-1.5zM3 13.5h14V15H3v-1.5z" />
            </svg>
          </button>
        </div>

        {/* Built-in lists */}
        <ul>
          {builtInLists.map((list) => (
            <li
              key={list}
              className={`${activeList === list ? "active" : ""}${taskDropTarget === list ? " drag-over" : ""}`}
              onClick={() => onSelectList(list)}
              title={isCollapsed ? list : undefined}
              onDragOver={(e) => handleTaskDragOver(e, list)}
              onDragLeave={handleTaskDragLeave}
              onDrop={(e) => handleTaskDrop(e, list)}
            >
              <span className="sidebar-list-icon">{getListIcon(list)}</span>
              <span className="sidebar-list-name">{list}</span>
              {taskCounts[list] > 0 && (
                <span className="sidebar-task-count">{taskCounts[list]}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="sidebar-divider" />

        {/* Groups with sub-lists */}
        {groups.map(group => {
          const subLists = allCustomLists.filter(l => l.parentGroupId === group.id);
          const isCollapsedGroup = !!collapsedGroups[group.id];
          const isDragTarget = dragOverGroupId === group.id;

          return (
            <div
              key={group.id}
              className={`sidebar-group${isDragTarget ? " drag-over" : ""}`}
              onDragOver={(e) => handleDragOver(e, group.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, group.id)}
            >
              <div className="sidebar-group-heading" title={isCollapsed ? group.displayName : undefined}>
                {!isCollapsed && (
                  <button
                    className="sidebar-group-chevron"
                    onClick={() => toggleGroupCollapse(group.id)}
                    aria-label={isCollapsedGroup ? "Expand group" : "Collapse group"}
                  >
                    {isCollapsedGroup ? "▶" : "▼"}
                  </button>
                )}
                <span className="sidebar-list-icon">📁</span>
                {renamingListId === group.id ? (
                  <input
                    type="text"
                    className="new-list-input sidebar-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") { setRenamingListId(null); setRenameValue(""); }
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="sidebar-group-name"
                    onDoubleClick={(e) => { e.stopPropagation(); startRenaming(group.id, group.displayName); }}
                  >
                    {group.displayName}
                  </span>
                )}
                {!isCollapsed && (
                  <span className="sidebar-group-actions">
                    <button
                      className="sidebar-group-add-btn"
                      onClick={() => startAddingSubList(group.id)}
                      title="Add list to group"
                      aria-label={`Add list to ${group.displayName}`}
                    >
                      +
                    </button>
                    {onDeleteList && (
                      <button
                        className="delete-list-btn sidebar-group-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          showConfirm(
                            `Delete group "${group.displayName}"? Sub-lists will become standalone.`,
                            () => onDeleteList!(group.id)
                          );
                        }}
                        aria-label={`Delete ${group.displayName}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )}
              </div>

              {!isCollapsed && !isCollapsedGroup && (
                <ul className="sidebar-sublist">
                  {subLists.map(sub => (
                    <React.Fragment key={sub.id}>
                      <li
                        className={`sidebar-sublist-item${activeList === sub.id ? " active" : ""}${taskDropTarget === sub.id ? " drag-over" : ""}`}
                        onClick={() => onSelectList(sub.id)}
                        onDragOver={(e) => handleTaskDragOver(e, sub.id)}
                        onDragLeave={handleTaskDragLeave}
                        onDrop={(e) => handleTaskDrop(e, sub.id)}
                        style={sub.themeColor ? { borderLeft: `3px solid ${sub.themeColor}` } : undefined}
                      >
                        <span className="sidebar-list-icon">{sub.emoji || "📝"}</span>
                        {renamingListId === sub.id ? (
                          <input
                            type="text"
                            className="new-list-input sidebar-rename-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              else if (e.key === "Escape") { setRenamingListId(null); setRenameValue(""); }
                            }}
                            onBlur={commitRename}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="sidebar-list-name"
                            onDoubleClick={(e) => { e.stopPropagation(); startRenaming(sub.id, sub.displayName); }}
                          >
                            {sub.displayName}
                          </span>
                        )}
                        {taskCounts[sub.id] > 0 && (
                          <span className="sidebar-task-count">{taskCounts[sub.id]}</span>
                        )}
                        <span className="sidebar-list-actions">
                          {onUpdateListTheme && (
                            <button
                              className="sidebar-theme-btn"
                              onClick={(e) => { e.stopPropagation(); startTheming(sub.id); }}
                              title="Customise"
                              aria-label={`Customize ${sub.displayName}`}
                            >🎨</button>
                          )}
                          {onDeleteList && (
                            <button
                              className="delete-list-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                showConfirm(
                                  `Delete "${sub.displayName}"?`,
                                  () => onDeleteList!(sub.id)
                                );
                              }}
                              aria-label={`Delete ${sub.displayName}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </li>
                      {renderThemePicker(sub.id)}
                    </React.Fragment>
                  ))}
                  {addingSubListToGroup === group.id ? (
                    <li className="sidebar-sublist-input-row">
                      <input
                        type="text"
                        className="new-list-input"
                        placeholder="List name"
                        value={newSubListName}
                        onChange={e => setNewSubListName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleCreateSubList(group.id);
                          else if (e.key === "Escape") { setAddingSubListToGroup(null); setNewSubListName(""); }
                        }}
                        onBlur={() => { if (!newSubListName.trim()) setAddingSubListToGroup(null); }}
                        autoFocus
                      />
                    </li>
                  ) : (
                    <li
                      className="sidebar-sublist-add-row"
                      onClick={() => startAddingSubList(group.id)}
                    >
                      <span className="sidebar-sublist-add-icon">+</span>
                      <span>Add list</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}

        {/* Standalone custom lists (not in any group) */}
        {(customLists.length > 0 || isCreatingList) && !isCollapsed && (
          <div className="sidebar-section-header">Lists</div>
        )}

        <ul className="custom-lists">
          {customLists.map((list) => (
            <React.Fragment key={list.id}>
              <li
                className={`${activeList === list.id ? "active" : ""}${taskDropTarget === list.id ? " drag-over" : ""}`}
                onClick={() => onSelectList(list.id)}
                title={isCollapsed ? list.displayName : undefined}
                draggable={!isCollapsed && renamingListId !== list.id}
                onDragStart={(e) => handleDragStart(e, list.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleTaskDragOver(e, list.id)}
                onDragLeave={handleTaskDragLeave}
                onDrop={(e) => handleTaskDrop(e, list.id)}
                style={list.themeColor ? { borderLeft: `3px solid ${list.themeColor}` } : undefined}
              >
                <span className="sidebar-list-icon">{list.emoji || "📝"}</span>
                {renamingListId === list.id ? (
                  <input
                    type="text"
                    className="new-list-input sidebar-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") { setRenamingListId(null); setRenameValue(""); }
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="sidebar-list-name"
                    onDoubleClick={(e) => { e.stopPropagation(); startRenaming(list.id, list.displayName); }}
                  >
                    {list.displayName}
                  </span>
                )}
                {taskCounts[list.id] > 0 && (
                  <span className="sidebar-task-count">{taskCounts[list.id]}</span>
                )}
                {!isCollapsed && (
                  <span className="sidebar-list-actions">
                    {onUpdateListTheme && (
                      <button
                        className="sidebar-theme-btn"
                        onClick={(e) => { e.stopPropagation(); startTheming(list.id); }}
                        title="Customise"
                        aria-label={`Customize ${list.displayName}`}
                      >🎨</button>
                    )}
                    <button
                      className="sidebar-convert-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        showConfirm(
                          `Convert "${list.displayName}" into a group heading?\nA new group will be created and this list will move inside it.`,
                          () => onConvertToGroup(list.id),
                          false
                        );
                      }}
                      title="Convert to group"
                      aria-label={`Convert ${list.displayName} to group`}
                    >
                      📁
                    </button>
                    {onDeleteList && (
                      <button
                        className="delete-list-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          showConfirm(
                            `Delete "${list.displayName}"?`,
                            () => onDeleteList!(list.id)
                          );
                        }}
                        aria-label={`Delete ${list.displayName}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )}
              </li>
              {renderThemePicker(list.id)}
            </React.Fragment>
          ))}
        </ul>

        {/* New list / New group buttons */}
        {!isCollapsed && (
          <div className="sidebar-bottom-actions">
            {isCreatingList ? (
              <div className="new-list-input-container">
                <input
                  type="text"
                  className="new-list-input"
                  placeholder="List name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateList();
                    else if (e.key === "Escape") { setIsCreatingList(false); setNewListName(""); }
                  }}
                  onBlur={() => { if (!newListName.trim()) setIsCreatingList(false); }}
                  autoFocus
                />
              </div>
            ) : isCreatingGroup ? (
              <div className="new-list-input-container">
                <input
                  type="text"
                  className="new-list-input"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                    else if (e.key === "Escape") { setIsCreatingGroup(false); setNewGroupName(""); }
                  }}
                  onBlur={() => { if (!newGroupName.trim()) setIsCreatingGroup(false); }}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <button className="new-list-btn" onClick={() => setIsCreatingList(true)}>
                  <span>+</span>
                  <span>New list</span>
                </button>
                <button className="new-list-btn" onClick={() => setIsCreatingGroup(true)}>
                  <span>📁</span>
                  <span>New group</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Settings / sync footer */}
        <div className="sidebar-footer">
          <div
            className="sidebar-sync-status"
            title={
              syncing ? "Syncing…" :
              syncError ? "Last sync failed" :
              !isOnline ? "Offline" :
              lastSyncTime ? `Last synced ${lastSyncTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` :
              "Online"
            }
          >
            {syncing ? (
              <span className="sync-icon sync-icon-spinning">⟳</span>
            ) : (
              <span className={`sync-dot ${!isOnline ? "offline" : syncError ? "error" : "online"}`} />
            )}
            {!isCollapsed && (
              <span className="sync-label">
                {syncing ? "Syncing…" : !isOnline ? "Offline" : syncError ? "Sync error" : "Online"}
              </span>
            )}
          </div>

          <button
            className="sidebar-settings-btn"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title={isCollapsed ? "Settings" : undefined}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
            </svg>
            <span className="sidebar-settings-label">Settings</span>
          </button>
        </div>
      </aside>

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          danger={confirmState.danger}
          onConfirm={() => { confirmState.onConfirm(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
};
