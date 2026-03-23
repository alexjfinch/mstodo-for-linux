import "./styles/theme.css";
import "./styles/global.css";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { PlannedView } from "./components/PlannedView";
import { NewTaskInput } from "./components/NewTaskInput";
import { SearchBar } from "./components/SearchBar";
import { SignIn } from "./components/SignIn";
import { Settings } from "./components/Settings";
import { TaskDetail } from "./components/TaskDetail";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ListName } from "./types";
import { parseTaskInput } from "./utils/dateParser";
import { useAuth } from "./hooks/useAuth";
import { useDatabase } from "./hooks/useDatabase";
import { useTasks } from "./hooks/useTasks";
import { useLists } from "./hooks/useLists";
import { useFilteredTasks } from "./hooks/useFilteredTasks";
import { useReminders } from "./hooks/useReminders";
import { useSettings } from "./hooks/useSettings";
import { useSelection } from "./hooks/useSelection";
import { useImportExport } from "./hooks/useImportExport";
import { useTraySync } from "./hooks/useTraySync";
import { ToastContainer } from "./components/ToastContainer";
import { ComponentBoundary } from "./components/ComponentBoundary";
import { ListBanner, SPECIAL_LISTS } from "./components/ListBanner";
import { MyDaySuggestions } from "./components/MyDaySuggestions";
import { fetchUserProfile } from "./api/graph";
import { logger } from "./services/logger";

export default function App() {
  const {
    accessToken,
    loading: authLoading,
    signIn,
    signOut,
    accounts,
    activeAccountId,
    switchAccount,
    removeAccount,
    updateAccountProfile,
  } = useAuth();
  const { db, ready: dbReady, dbError } = useDatabase();
  const {
    theme, fontSize, compactMode, syncInterval, taskOrder,
    remindersEnabled, reminderTiming,
    handleThemeChange, handleFontSizeChange, handleCompactModeChange,
    handleSyncIntervalChange, handleRemindersEnabledChange,
    handleReminderTimingChange, handleReorderTasks: reorderTasks,
    lastMyDayReset, handleMyDayReset, weekStartDay, handleWeekStartDayChange,
    settingsLoaded, settingsError,
  } = useSettings();
  const [activeList, setActiveList] = useState<ListName | string>("Tasks");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const profileFetched = useRef(false);
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const pushToastRef = useRef<((toast: { title: string; body: string; type?: "reminder" | "success" | "error" }) => void) | null>(null);
  // Fetch/update account profile info (handles migrated accounts too)
  useEffect(() => {
    if (!accessToken || !activeAccountId || profileFetched.current) return;
    profileFetched.current = true;
    fetchUserProfile(accessToken)
      .then((profile) => {
        const account = accounts.find((a) => a.id === activeAccountId);
        if (account && (!account.displayName || account.id === "migrated")) {
          const newId = profile.userPrincipalName || profile.mail || profile.displayName;
          updateAccountProfile(activeAccountId, {
            displayName: profile.displayName,
            email: profile.mail || profile.userPrincipalName,
            newId: account.id === "migrated" ? newId : undefined,
          });
        }
      })
      .catch((err) => logger.warn("Failed to fetch user profile", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts is read via .find() only for the current activeAccountId; including it would re-fire on every token refresh
  }, [accessToken, activeAccountId, updateAccountProfile]);

  const {
    lists,
    loading: listsLoading,
    createList,
    createSubList,
    createGroup,
    convertToGroup,
    moveToGroup,
    renameList,
    updateListTheme,
    deleteList,
    syncLists,
  } = useLists(accessToken, db, activeAccountId);

  const currentListId = useMemo(() => {
    if (activeList === "Assigned to Me") {
      return "__assigned__";
    }
    if (activeList === "Flagged Emails") {
      return lists.find(l => l.wellknownListName === "flaggedEmails")?.id || null;
    }
    if (activeList === "Tasks" || activeList === "My Day" || activeList === "Important" || activeList === "Planned") {
      const tasksList = lists.find(l => l.wellknownListName === "defaultList") ||
        lists.find(l => l.displayName === "Tasks");
      return tasksList?.id || null;
    }
    return activeList;
  }, [activeList, lists]);

  const {
    tasks,
    loading: tasksLoading,
    addTask,
    toggleTask,
    updateAttributes,
    deleteTask,
    moveTaskToList,
    syncWithGraph,
    clearMyDay,
    isOnline,
    syncing,
    syncError,
    lastSyncTime,
  } = useTasks(accessToken, currentListId, db, activeAccountId, (info) => {
    pushToastRef.current?.({
      type: "error",
      title: "Sync failed",
      body: `A pending ${info.opType} operation could not be synced and was discarded.`,
    });
  });

  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const flaggedListId = lists.find(l => l.wellknownListName === "flaggedEmails")?.id;

    for (const task of tasks) {
      if (task.completed) continue;
      if (task.isInMyDay) counts["My Day"] = (counts["My Day"] || 0) + 1;
      if (task.importance === "high") counts["Important"] = (counts["Important"] || 0) + 1;
      if (task.dueDateTime) counts["Planned"] = (counts["Planned"] || 0) + 1;
      if (task.listId === "__assigned__") counts["Assigned to Me"] = (counts["Assigned to Me"] || 0) + 1;
      // "Tasks" shows all tasks not in special lists
      if (task.listId !== "__assigned__" && task.listId !== flaggedListId) counts["Tasks"] = (counts["Tasks"] || 0) + 1;
      if (task.listId === flaggedListId) counts["Flagged Emails"] = (counts["Flagged Emails"] || 0) + 1;
      if (task.listId) counts[task.listId] = (counts[task.listId] || 0) + 1;
    }
    return counts;
  }, [tasks, lists]);

  const rawFilteredTasks = useFilteredTasks(tasks, activeList, lists);

  // Debounce search query to avoid filtering thousands of tasks on every keystroke
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const searchResults = useMemo(() => {
    if (!deferredSearchQuery.trim()) return null;
    const q = deferredSearchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.body?.content?.toLowerCase().includes(q)
    );
  }, [tasks, deferredSearchQuery]);

  const filteredTasks = useMemo(() => {
    const source = searchResults ?? rawFilteredTasks;
    if (searchResults) return source; // no reordering for search results
    const order = taskOrder[activeList];
    if (!order || order.length === 0) return source;
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return [...source].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }, [rawFilteredTasks, searchResults, taskOrder, activeList]);

  const { toasts, dismissToast, pushToast } = useReminders(tasks, remindersEnabled, reminderTiming);
  pushToastRef.current = pushToast;

  useEffect(() => {
    if (settingsError) {
      pushToast({ title: "Settings", body: settingsError, type: "error" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsError]);

  const handleReorderTasks = useCallback((reorderedIds: string[]) => {
    reorderTasks(activeList, reorderedIds);
  }, [activeList, reorderTasks]);

  const detailTask = useMemo(
    () => (detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null),
    [detailTaskId, tasks]
  );

  const handleOpenDetail = useCallback((id: string) => {
    setDetailTaskId((prev) => (prev === id ? null : id));
    setSelectedTasks([]);
  }, []);

  const handleCloseDetail = useCallback(() => setDetailTaskId(null), []);

  // If the task open in the detail panel is deleted externally (e.g. via sync),
  // clear the stale ID so the panel closes cleanly.
  useEffect(() => {
    if (detailTaskId && !detailTask) setDetailTaskId(null);
  }, [detailTask, detailTaskId]);

  const handleManualSync = useCallback(async () => {
    await Promise.all([syncWithGraph(), syncLists()]);
  }, [syncWithGraph, syncLists]);

  const getListDisplayName = useMemo(() => {
    if (activeList === "My Day" || activeList === "Important" || activeList === "Planned" ||
        activeList === "Assigned to Me" || activeList === "Tasks" || activeList === "Flagged Emails") {
      return activeList;
    }
    return lists.find(l => l.id === activeList)?.displayName ?? "Unknown List";
  }, [activeList, lists]);

  const {
    selectedTasks,
    setSelectedTasks,
    bulkDeleteConfirm,
    setBulkDeleteConfirm,
    handleClearSelection,
    handleToggleSelection,
    handleBulkComplete,
    handleBulkDelete,
  } = useSelection({ filteredTasks, toggleTask, deleteTask, setDetailTaskId });

  const {
    handleExportJson,
    handleExportCsv,
    handleImportJson,
    handleImportTodoist,
    handleImportEvernote,
    handleImportCsv,
  } = useImportExport({ tasks, lists, addTask, pushToast });

  useTraySync({ tasks, isOnline, syncing });

  useEffect(() => {
    const root = document.documentElement;

    if (theme !== "system") {
      root.setAttribute("data-theme", theme);
      return;
    }

    // On Linux, WebKitGTK doesn't propagate the system color scheme to CSS
    // prefers-color-scheme. Read the initial theme via the freedesktop portal
    // (works cross-DE: GNOME, KDE, etc.) and listen for live changes emitted
    // by the Rust portal watcher.
    // Register the listener BEFORE invoking get_system_theme to avoid missing
    // a theme change that fires between the invoke and the listen.
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<string>("theme-changed", ({ payload }) => {
      if (!cancelled) root.setAttribute("data-theme", payload);
    }).then(fn => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    invoke<string>("get_system_theme").then(osTheme => {
      if (!cancelled) root.setAttribute("data-theme", osTheme);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-fontsize", fontSize);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.setAttribute("data-compact", String(compactMode));
  }, [compactMode]);

  // Clear selection and close panels when changing lists
  useEffect(() => {
    setSelectedTasks([]);
    setDetailTaskId(null);
    setIsSettingsOpen(false);
  }, [activeList]);

  // Close detail if the task is removed from the list
  useEffect(() => {
    if (detailTaskId && !tasks.find((t) => t.id === detailTaskId)) {
      setDetailTaskId(null);
    }
  }, [detailTaskId, tasks]);

  // Close detail when clicking outside the panel (but not on task rows or overlays like ConfirmDialog)
  useEffect(() => {
    if (!detailTaskId) return;
    const fn = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (detailPanelRef.current && !detailPanelRef.current.contains(target)) {
        // Don't close if clicking a task row (user is switching tasks) or a modal overlay
        if (target.closest(".task-item, .confirm-overlay, .context-menu")) return;
        setDetailTaskId(null);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [detailTaskId]);

  // Global Escape: clear multi-select and close detail
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTasks([]);
        setDetailTaskId(null);
      }
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, []);

  // Redirect if activeList is a group heading (not a navigable list)
  useEffect(() => {
    if (lists.find(l => l.id === activeList)?.isGroup) setActiveList("Tasks");
  }, [lists, activeList]);

  // Keep stable refs to sync functions to avoid retriggering effects
  const syncListsRef = useRef(syncLists);
  const syncWithGraphRef = useRef(syncWithGraph);
  useEffect(() => { syncListsRef.current = syncLists; }, [syncLists]);
  useEffect(() => { syncWithGraphRef.current = syncWithGraph; }, [syncWithGraph]);

  // Sync when user signs in or comes back online
  useEffect(() => {
    if (accessToken && dbReady && isOnline) {
      syncListsRef.current();
      syncWithGraphRef.current();
    }
  }, [accessToken, dbReady, isOnline]);

  // Auto-sync based on syncInterval setting (0 = manual only)
  useEffect(() => {
    if (!accessToken || !dbReady || syncInterval === 0) return;
    const interval = setInterval(() => {
      syncWithGraphRef.current();
      syncListsRef.current();
    }, syncInterval * 1000);
    return () => clearInterval(interval);
  }, [accessToken, dbReady, syncInterval]);

  // Detect day change when waking from sleep or regaining focus
  useEffect(() => {
    const checkDate = () => {
      const today = new Date().toISOString().split("T")[0];
      setCurrentDate((prev) => (prev !== today ? today : prev));
    };
    const onVisible = () => { if (document.visibilityState === "visible") checkDate(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkDate);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkDate);
    };
  }, []);

  // Reset My Day at the start of a new day — cleared tasks become suggestions
  // Wait for settingsLoaded so lastMyDayReset has its persisted value before comparing
  useEffect(() => {
    if (!dbReady || tasksLoading || !settingsLoaded) return;
    if (lastMyDayReset !== currentDate) {
      clearMyDay();
      handleMyDayReset(currentDate);
    }
  }, [dbReady, tasksLoading, settingsLoaded, currentDate, lastMyDayReset, clearMyDay, handleMyDayReset]);

  // Keep stable refs for event handlers to avoid re-subscribing Tauri listeners
  const handleManualSyncRef = useRef(handleManualSync);
  const addTaskRef = useRef(addTask);
  useEffect(() => { handleManualSyncRef.current = handleManualSync; }, [handleManualSync]);
  useEffect(() => { addTaskRef.current = addTask; }, [addTask]);

  // Listen for tray and quick-add events (subscribe once, use refs to avoid leak).
  // Store the promise directly so cleanup can await it even if it resolves after
  // the effect teardown runs (avoids the listener leaking on fast unmounts).
  useEffect(() => {
    const p1 = listen("tray-sync", () => handleManualSyncRef.current()).catch(
      (err) => { logger.warn("Failed to register tray-sync listener", String(err)); return null; }
    );
    const p2 = listen<{ title: string; dueDateTime?: { dateTime: string; timeZone: string }; categories?: string[] }>(
      "quick-add-task",
      (event) => {
        const { title, dueDateTime, categories } = event.payload;
        const attrs: Partial<typeof tasks[0]> = {};
        if (dueDateTime) attrs.dueDateTime = dueDateTime;
        if (categories) attrs.categories = categories;
        addTaskRef.current(title, undefined, Object.keys(attrs).length > 0 ? attrs : undefined);
      }
    ).catch(
      (err) => { logger.warn("Failed to register quick-add-task listener", String(err)); return null; }
    );
    return () => {
      p1.then((fn) => fn?.());
      p2.then((fn) => fn?.());
    };
  }, []);

  const handleCreateList = async (name: string) => {
    const newList = await createList(name);
    if (newList) {
      setActiveList(newList.id);
    }
  };

  const handleCreateSubList = async (groupId: string, name: string) => {
    const newList = await createSubList(groupId, name);
    if (newList) setActiveList(newList.id);
  };

  const handleCreateGroup = async (name: string) => {
    await createGroup(name);
  };

  const handleConvertToGroup = async (listId: string) => {
    if (activeList === listId) setActiveList("Tasks");
    await convertToGroup(listId);
  };

  const handleMoveToGroup = async (listId: string, groupId: string | null) => {
    await moveToGroup(listId, groupId);
  };

  const handleRenameList = async (listId: string, newName: string) => {
    await renameList(listId, newName);
  };

  const handleDeleteList = async (listId: string) => {
    await deleteList(listId);
    if (activeList === listId) {
      setActiveList("Tasks");
    }
  };

  if (authLoading || !dbReady || listsLoading) return <div className="loading">Loading…</div>;
  if (dbError) return <div className="loading">Database error: {dbError}</div>;
  if (!accessToken) return <SignIn signIn={signIn} />;

  return (
    <div className="app">
      <Titlebar />
      <div className="app-content">
        <ComponentBoundary>
        <Sidebar
          activeList={activeList}
          onSelectList={(list) => { setActiveList(list); setIsSettingsOpen(false); }}
          onOpenSettings={() => setIsSettingsOpen(prev => !prev)}
          allLists={lists}
          customLists={lists.filter(l =>
            l.wellknownListName !== "defaultList" &&
            l.wellknownListName !== "flaggedEmails" &&
            !l.isGroup &&
            !l.parentGroupId
          )}
          groups={lists.filter(l => l.isGroup)}
          allCustomLists={lists.filter(l =>
            l.wellknownListName !== "defaultList" &&
            l.wellknownListName !== "flaggedEmails"
          )}
          onCreateList={handleCreateList}
          onRenameList={handleRenameList}
          onUpdateListTheme={(id, updates) => updateListTheme(id, updates)}
          onDeleteList={handleDeleteList}
          onCreateSubList={handleCreateSubList}
          onCreateGroup={handleCreateGroup}
          onConvertToGroup={handleConvertToGroup}
          onMoveToGroup={handleMoveToGroup}
          isOnline={isOnline}
          syncing={syncing}
          syncError={syncError}
          lastSyncTime={lastSyncTime}
          taskCounts={taskCounts}
          onMoveTaskToList={moveTaskToList}
          onAddToMyDay={(taskId) => {
            updateAttributes(taskId, { isInMyDay: true });
          }}
          onMarkImportant={(taskId) => {
            const task = tasks.find(t => t.id === taskId);
            if (task) updateAttributes(taskId, { importance: task.importance === "high" ? "normal" : "high" });
          }}
        />
        </ComponentBoundary>
        <main className="main">
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSignOut={signOut}
            onAddAccount={signIn}
            onSwitchAccount={(id) => { switchAccount(id); profileFetched.current = false; }}
            onRemoveAccount={removeAccount}
            accounts={accounts}
            activeAccountId={activeAccountId}
            theme={theme}
            onThemeChange={handleThemeChange}
            fontSize={fontSize}
            onFontSizeChange={handleFontSizeChange}
            compactMode={compactMode}
            onCompactModeChange={handleCompactModeChange}
            syncInterval={syncInterval}
            onSyncIntervalChange={handleSyncIntervalChange}
            onManualSync={handleManualSync}
            remindersEnabled={remindersEnabled}
            onRemindersEnabledChange={handleRemindersEnabledChange}
            reminderTiming={reminderTiming}
            onReminderTimingChange={handleReminderTimingChange}
            weekStartDay={weekStartDay}
            onWeekStartDayChange={handleWeekStartDayChange}
            isOnline={isOnline}
            syncing={syncing}
            syncError={syncError}
            lastSyncTime={lastSyncTime}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            onImportJson={handleImportJson}
            onImportTodoist={handleImportTodoist}
            onImportEvernote={handleImportEvernote}
            onImportCsv={handleImportCsv}
          />

          {bulkDeleteConfirm && (
            <ConfirmDialog
              message={`Delete ${selectedTasks.length} task${selectedTasks.length > 1 ? "s" : ""}?`}
              confirmLabel="Delete"
              danger
              onConfirm={() => { handleBulkDelete(); setBulkDeleteConfirm(false); }}
              onCancel={() => setBulkDeleteConfirm(false)}
            />
          )}

          {SPECIAL_LISTS.has(activeList) && !searchQuery ? (
            <ListBanner activeList={activeList} displayName={getListDisplayName} />
          ) : null}

          <div className={`main-header${SPECIAL_LISTS.has(activeList) && !searchQuery ? " main-header-compact" : ""}`}>
            {(!SPECIAL_LISTS.has(activeList) || searchQuery) && (() => {
              const activeCount = filteredTasks.filter(t => !t.completed).length;
              return (
                <h2 className="list-title">
                  {searchQuery ? `Search: "${searchQuery}"` : getListDisplayName}
                  {!searchQuery && (
                    <span className="list-title-count">
                      {activeCount} task{activeCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </h2>
              );
            })()}
            <div className="main-header-actions">
              <SearchBar query={searchQuery} onQueryChange={setSearchQuery} />
              {selectedTasks.length > 0 && (
                <div className="bulk-actions">
                  <button className="bulk-complete-btn" onClick={handleBulkComplete}>
                    Complete {selectedTasks.length} task{selectedTasks.length > 1 ? "s" : ""}
                  </button>
                  <button className="bulk-delete-btn" onClick={() => setBulkDeleteConfirm(true)}>
                    Delete {selectedTasks.length} task{selectedTasks.length > 1 ? "s" : ""}
                  </button>
                  <button className="clear-selection-btn" onClick={handleClearSelection}>
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {tasksLoading ? (
            <div className="loading">Loading tasks…</div>
          ) : activeList === "Planned" ? (
            <PlannedView
              tasks={filteredTasks}
              onToggleTask={toggleTask}
              onUpdateAttributes={updateAttributes}
              onDeleteTask={deleteTask}
              onMoveTaskToList={moveTaskToList}
              allLists={lists}
              selectedTasks={selectedTasks}
              onToggleSelection={handleToggleSelection}
              onClearSelection={handleClearSelection}
              onOpenDetail={handleOpenDetail}
              weekStartDay={weekStartDay}
            />
          ) : activeList === "My Day" ? (
            <div
              className="myday-layout myday-drop-zone"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("suggestion")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  e.currentTarget.classList.add("myday-drop-active");
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  e.currentTarget.classList.remove("myday-drop-active");
                }
              }}
              onDrop={(e) => {
                e.currentTarget.classList.remove("myday-drop-active");
                if (e.dataTransfer.types.includes("suggestion")) {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData("text/plain");
                  if (taskId) updateAttributes(taskId, { isInMyDay: true });
                }
              }}
            >
              <div className="task-list-wrapper">
                <TaskList
                  tasks={filteredTasks}
                  onToggleTask={toggleTask}
                  onUpdateAttributes={updateAttributes}
                  onDeleteTask={deleteTask}
                  onMoveTaskToList={moveTaskToList}
                  allLists={lists}
                  selectedTasks={selectedTasks}
                  onToggleSelection={handleToggleSelection}
                  onClearSelection={handleClearSelection}
                  onOpenDetail={handleOpenDetail}
                  onReorderTasks={handleReorderTasks}
                  showListBadge={false}
                  defaultListId={currentListId || undefined}
                  weekStartDay={weekStartDay}
                />
              </div>
              <MyDaySuggestions
                allTasks={tasks}
                onAddToMyDay={(id) => updateAttributes(id, { isInMyDay: true })}
              />
            </div>
          ) : (
            <div className="task-list-wrapper">
              <TaskList
                tasks={filteredTasks}
                onToggleTask={toggleTask}
                onUpdateAttributes={updateAttributes}
                onDeleteTask={deleteTask}
                onMoveTaskToList={moveTaskToList}
                allLists={lists}
                selectedTasks={selectedTasks}
                onToggleSelection={handleToggleSelection}
                onClearSelection={handleClearSelection}
                onOpenDetail={handleOpenDetail}
                onReorderTasks={handleReorderTasks}
                showListBadge={activeList === "Tasks"}
                defaultListId={currentListId || undefined}
                weekStartDay={weekStartDay}
              />
            </div>
          )}

          {activeList !== "Assigned to Me" && (
            <NewTaskInput
              ref={newTaskInputRef}
              value={newTaskTitle}
              onChange={setNewTaskTitle}
              onSubmit={() => {
                const parsed = parseTaskInput(newTaskTitle);
                const viewAttributes: Partial<typeof tasks[0]> = {};
                if (activeList === "My Day") viewAttributes.isInMyDay = true;
                if (activeList === "Important") viewAttributes.importance = "high";
                if (parsed.dueDateTime) viewAttributes.dueDateTime = parsed.dueDateTime;
                // Extract #hashtags as categories — require # to follow whitespace or be at
                // the start of the string to avoid matching mid-word (e.g. "task-#tag").
                const hashtagRegex = /(?:^|\s)#([\w-]+)/g;
                const hashtags: string[] = [];
                let match;
                let cleanTitle = parsed.title;
                while ((match = hashtagRegex.exec(parsed.title)) !== null) {
                  if (match[1] !== "MyDay") hashtags.push(match[1]);
                }
                if (hashtags.length > 0) {
                  cleanTitle = cleanTitle.replace(/(?:^|\s)#[\w-]+/g, " ").replace(/\s+/g, " ").trim();
                  viewAttributes.categories = hashtags;
                }
                addTask(cleanTitle || parsed.title, undefined, Object.keys(viewAttributes).length > 0 ? viewAttributes : undefined);
                setNewTaskTitle("");
              }}
            />
          )}
        </main>
      </div>

      {detailTask && (
        <div ref={detailPanelRef}>
          <ComponentBoundary>
            <TaskDetail
              task={detailTask}
              accessToken={accessToken}
              onClose={handleCloseDetail}
              onUpdateAttributes={updateAttributes}
              onToggleComplete={toggleTask}
              onDeleteTask={deleteTask}
              weekStartDay={weekStartDay}
            />
          </ComponentBoundary>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
