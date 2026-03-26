import "./Settings.css";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { StoredAccount } from "../hooks/useAuth";
import { CustomSelect } from "./CustomSelect";
import { ReminderTiming, TIMING_LABELS } from "../hooks/useReminders";

type Section = "appearance" | "sync" | "notifications" | "shortcuts" | "account" | "import_export" | "about";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onAddAccount: () => Promise<void>;
  onSwitchAccount: (accountId: string) => void;
  onRemoveAccount: (accountId: string) => void;
  accounts: StoredAccount[];
  activeAccountId: string | null;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  fontSize: "small" | "normal" | "large";
  onFontSizeChange: (size: "small" | "normal" | "large") => void;
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
  syncInterval: number;
  onSyncIntervalChange: (interval: number) => void;
  onManualSync: () => Promise<void>;
  remindersEnabled: boolean;
  onRemindersEnabledChange: (enabled: boolean) => void;
  reminderTiming: ReminderTiming;
  onReminderTimingChange: (timing: ReminderTiming) => void;
  weekStartDay: 0 | 1 | 6;
  onWeekStartDayChange: (day: 0 | 1 | 6) => void;
  isOnline: boolean;
  syncing: boolean;
  syncError: string | null;
  lastSyncTime: Date | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: () => Promise<number | null>;
  onImportTodoist: () => Promise<number | null>;
  onImportEvernote: () => Promise<number | null>;
  onImportCsv: () => Promise<number | null>;
};

const NAV_ITEMS: { key: Section; label: string; icon: string }[] = [
  { key: "appearance", label: "Appearance", icon: "🎨" },
  { key: "sync", label: "Sync", icon: "🔄" },
  { key: "notifications", label: "Notifications", icon: "🔔" },
  { key: "shortcuts", label: "Shortcuts", icon: "⌨️" },
  { key: "account", label: "Account", icon: "👤" },
  { key: "import_export", label: "Import & Export", icon: "📦" },
  { key: "about", label: "About", icon: "ℹ️" },
];

const SHORTCUTS = [
  ["Click task", "Open task detail panel"],
  ["Click task (panel open)", "Switch to that task / close if same"],
  ["Shift + Click", "Multi-select tasks"],
  ["Escape", "Close panel / clear selection"],
  ["Enter (task input)", "Add new task"],
  ["Enter (title field)", "Save task title"],
  ["Enter (category field)", "Add category tag"],
  ["Right-click task", "Context menu"],
];

export const Settings = ({
  isOpen,
  onClose,
  onSignOut,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  accounts,
  activeAccountId,
  theme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  compactMode,
  onCompactModeChange,
  syncInterval,
  onSyncIntervalChange,
  onManualSync,
  remindersEnabled,
  onRemindersEnabledChange,
  reminderTiming,
  onReminderTimingChange,
  weekStartDay,
  onWeekStartDayChange,
  isOnline,
  syncing,
  syncError,
  lastSyncTime,
  onExportJson,
  onExportCsv,
  onImportJson,
  onImportTodoist,
  onImportEvernote,
  onImportCsv,
}: Props) => {
  const [activeSection, setActiveSection] = useState<Section>("appearance");
  const [manualSyncing, setManualSyncing] = useState(false);
  const [importStatus, setImportStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    if (isOpen) {
      invoke<boolean>("get_autostart_enabled").then(setAutostartEnabled).catch(() => {});
      getVersion().then(setAppVersion).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSignOut = () => {
    onClose();
    onSignOut();
  };

  const handleManualSync = async () => {
    setManualSyncing(true);
    try {
      await onManualSync();
    } finally {
      setManualSyncing(false);
    }
  };

  const renderContent = () => {
    switch (activeSection) {
      case "appearance":
        return (
          <>
            <h3 className="settings-section-title">Appearance</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Theme</div>
                <div className="settings-item-description">Choose your preferred colour scheme</div>
              </div>
              <div className="settings-button-group">
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
                    className={`settings-option-btn${theme === t ? " active" : ""}`}
                    onClick={() => onThemeChange(t)}
                  >
                    {t === "light" ? "☀️ Light" : t === "dark" ? "🌙 Dark" : "💻 System"}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Font Size</div>
                <div className="settings-item-description">Adjust text size throughout the app</div>
              </div>
              <div className="settings-button-group">
                {(["small", "normal", "large"] as const).map((s) => (
                  <button
                    key={s}
                    className={`settings-option-btn${fontSize === s ? " active" : ""}`}
                    onClick={() => onFontSizeChange(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Compact Mode</div>
                <div className="settings-item-description">Reduce spacing between task rows</div>
              </div>
              <button
                className={`settings-toggle${compactMode ? " active" : ""}`}
                onClick={() => onCompactModeChange(!compactMode)}
                role="switch"
                aria-checked={compactMode}
                aria-label="Toggle compact mode"
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Week Starts On</div>
                <div className="settings-item-description">Choose the first day of the week in calendars</div>
              </div>
              <div className="settings-button-group">
                {([
                  { value: 1, label: "Monday" },
                  { value: 0, label: "Sunday" },
                  { value: 6, label: "Saturday" },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    className={`settings-option-btn${weekStartDay === value ? " active" : ""}`}
                    onClick={() => onWeekStartDayChange(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Start on Login</div>
                <div className="settings-item-description">Automatically launch the app when you log in</div>
              </div>
              <button
                className={`settings-toggle${autostartEnabled ? " active" : ""}`}
                onClick={() => {
                  const next = !autostartEnabled;
                  invoke("set_autostart_enabled", { enabled: next })
                    .then(() => setAutostartEnabled(next))
                    .catch(() => {});
                }}
                role="switch"
                aria-checked={autostartEnabled}
                aria-label="Toggle start on login"
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </>
        );

      case "sync":
        return (
          <>
            <h3 className="settings-section-title">Sync</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Auto-sync Interval</div>
                <div className="settings-item-description">How often to sync with Microsoft To Do</div>
              </div>
              <CustomSelect
                className="settings-select"
                value={String(syncInterval)}
                onChange={(v) => onSyncIntervalChange(Number(v))}
                options={[
                  { value: "30", label: "Every 30 seconds" },
                  { value: "60", label: "Every minute" },
                  { value: "300", label: "Every 5 minutes" },
                  { value: "0", label: "Manual only" },
                ]}
              />
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Manual Sync</div>
                <div className="settings-item-description">Sync all tasks and lists right now</div>
              </div>
              <button
                className="settings-action-btn"
                onClick={handleManualSync}
                disabled={manualSyncing}
              >
                {manualSyncing ? "Syncing…" : "Sync Now"}
              </button>
            </div>
          </>
        );

      case "notifications":
        return (
          <>
            <h3 className="settings-section-title">Notifications</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Due Date Reminders</div>
                <div className="settings-item-description">
                  Get notified when tasks are due or overdue
                </div>
              </div>
              <button
                className={`settings-toggle${remindersEnabled ? " active" : ""}`}
                onClick={() => onRemindersEnabledChange(!remindersEnabled)}
                role="switch"
                aria-checked={remindersEnabled}
                aria-label="Toggle reminders"
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            {remindersEnabled && (
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-label">Reminder Timing</div>
                  <div className="settings-item-description">
                    When to send the reminder relative to the due date
                  </div>
                </div>
                <CustomSelect
                  className="settings-select"
                  value={reminderTiming}
                  onChange={(v) => onReminderTimingChange(v as ReminderTiming)}
                  options={Object.entries(TIMING_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </div>
            )}

            {remindersEnabled && (
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-label">How it works</div>
                  <div className="settings-item-description">
                    Reminders check every 60 seconds while the app is running.
                    You'll receive both a desktop notification and an in-app toast
                    for each task that becomes due. Each task triggers at most one
                    reminder per session.
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case "shortcuts":
        return (
          <>
            <h3 className="settings-section-title">Keyboard Shortcuts</h3>
            <table className="shortcuts-table">
              <tbody>
                {SHORTCUTS.map(([key, action]) => (
                  <tr key={key}>
                    <td><kbd>{key}</kbd></td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );

      case "account": {
        const activeAccount = accounts.find((a) => a.id === activeAccountId);
        const otherAccounts = accounts.filter((a) => a.id !== activeAccountId);
        return (
          <>
            <h3 className="settings-section-title">Active Account</h3>

            {activeAccount && (
              <div className="settings-account-card settings-account-card--active">
                <div className="settings-account-avatar">
                  {(activeAccount.displayName || activeAccount.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="settings-account-info">
                  <div className="settings-account-name">
                    {activeAccount.displayName || "Microsoft Account"}
                  </div>
                  <div className="settings-account-email">{activeAccount.email}</div>
                </div>
                <span className="settings-badge">Active</span>
              </div>
            )}

            <div className="settings-item-standalone">
              <button className="settings-sign-out-btn" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>

            {otherAccounts.length > 0 && (
              <>
                <h3 className="settings-section-title" style={{ marginTop: "1.5rem" }}>
                  Other Accounts
                </h3>
                {otherAccounts.map((account) => (
                  <div key={account.id} className="settings-account-card">
                    <div className="settings-account-avatar">
                      {(account.displayName || account.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="settings-account-info">
                      <div className="settings-account-name">
                        {account.displayName || "Microsoft Account"}
                      </div>
                      <div className="settings-account-email">{account.email}</div>
                    </div>
                    <div className="settings-account-actions">
                      <button
                        className="settings-action-btn"
                        onClick={() => { onSwitchAccount(account.id); onClose(); }}
                      >
                        Switch
                      </button>
                      <button
                        className="settings-action-btn settings-action-btn--danger"
                        onClick={() => onRemoveAccount(account.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <h3 className="settings-section-title" style={{ marginTop: "1.5rem" }}>
              Add Account
            </h3>
            <div className="settings-item-standalone">
              <button className="settings-action-btn settings-action-btn--primary" onClick={onAddAccount}>
                + Add Microsoft Account
              </button>
            </div>
          </>
        );
      }

      case "import_export": {
        const runImport = async (fn: () => Promise<number | null>) => {
          setImportStatus(null);
          setImportBusy(true);
          try {
            await fn(); // success shown via toast
            setImportStatus(null);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Import failed.";
            setImportStatus({ message, isError: true });
          } finally {
            setImportBusy(false);
          }
        };

        return (
          <>
            <h3 className="settings-section-title">Export</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Export as JSON</div>
                <div className="settings-item-description">
                  Full backup of all your tasks and lists — use this to restore later
                </div>
              </div>
              <button className="settings-action-btn" onClick={onExportJson}>
                Download
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Export as CSV</div>
                <div className="settings-item-description">
                  All tasks in a spreadsheet-friendly format
                </div>
              </div>
              <button className="settings-action-btn" onClick={onExportCsv}>
                Download
              </button>
            </div>

            <h3 className="settings-section-title" style={{ marginTop: "1.5rem" }}>Import</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">From JSON backup</div>
                <div className="settings-item-description">
                  Restore tasks from a previous JSON export
                </div>
              </div>
              <button
                className="settings-action-btn"
                onClick={() => runImport(onImportJson)}
                disabled={importBusy}
              >
                Import
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">From Todoist</div>
                <div className="settings-item-description">
                  Import from a Todoist CSV export (File → Export → as CSV)
                </div>
              </div>
              <button
                className="settings-action-btn"
                onClick={() => runImport(onImportTodoist)}
                disabled={importBusy}
              >
                Import
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">From Evernote</div>
                <div className="settings-item-description">
                  Import from an Evernote .enex export file
                </div>
              </div>
              <button
                className="settings-action-btn"
                onClick={() => runImport(onImportEvernote)}
                disabled={importBusy}
              >
                Import
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">From CSV</div>
                <div className="settings-item-description">
                  Generic CSV — needs a title/task/name column; optionally due date, notes, priority
                </div>
              </div>
              <button
                className="settings-action-btn"
                onClick={() => runImport(onImportCsv)}
                disabled={importBusy}
              >
                Import
              </button>
            </div>

            {importStatus && (
              <div
                className={`settings-item-description${importStatus.isError ? " settings-item-description--error" : ""}`}
                style={{ padding: "0 0 0.5rem 0" }}
              >
                {importStatus.isError ? "⚠️ " : "✓ "}{importStatus.message}
              </div>
            )}

            <div className="settings-item" style={{ marginTop: "0.5rem" }}>
              <div className="settings-item-info">
                <div className="settings-item-label">Note</div>
                <div className="settings-item-description">
                  Imported tasks are added to your default Tasks list and synced to Microsoft To Do on the next sync.
                </div>
              </div>
            </div>
          </>
        );
      }

      case "about":
        return (
          <>
            <h3 className="settings-section-title">About</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">MS To Do for Linux</div>
                <div className="settings-item-description">Unofficial Microsoft To Do client for Linux</div>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Version</div>
                <div className="settings-item-description">{appVersion}</div>
              </div>
            </div>

            <h3 className="settings-section-title" style={{ marginTop: "1.5rem" }}>Sync Diagnostics</h3>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Connection</div>
                <div className="settings-item-description">
                  {isOnline ? "Online" : "Offline — changes will sync when reconnected"}
                </div>
              </div>
              <span className={`settings-badge${isOnline ? "" : " settings-badge--error"}`}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-label">Sync Status</div>
                <div className="settings-item-description">
                  {syncing
                    ? "Syncing with Microsoft To Do…"
                    : syncError
                    ? `Last sync failed: ${syncError}`
                    : lastSyncTime
                    ? `Last synced at ${lastSyncTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                    : "Not yet synced this session"}
                </div>
              </div>
              <span className={`settings-badge${syncing ? "" : syncError ? " settings-badge--error" : " settings-badge--success"}`}>
                {syncing ? "Syncing" : syncError ? "Error" : lastSyncTime ? "OK" : "Pending"}
              </span>
            </div>

            {syncError && (
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-label">Last Error</div>
                  <div className="settings-item-description settings-item-description--error">{syncError}</div>
                </div>
              </div>
            )}
          </>
        );
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="settings-body">
        <nav className="settings-nav">
          <ul className="settings-nav-list" role="tablist" aria-label="Settings sections">
            {NAV_ITEMS.map((item, i) => (
              <li
                key={item.key}
                role="tab"
                tabIndex={activeSection === item.key ? 0 : -1}
                aria-selected={activeSection === item.key}
                className={`settings-nav-item${activeSection === item.key ? " active" : ""}`}
                onClick={() => setActiveSection(item.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveSection(item.key);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = NAV_ITEMS[(i + 1) % NAV_ITEMS.length];
                    setActiveSection(next.key);
                    const tabs = e.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]');
                    tabs?.[(i + 1) % NAV_ITEMS.length]?.focus();
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prev = NAV_ITEMS[(i - 1 + NAV_ITEMS.length) % NAV_ITEMS.length];
                    setActiveSection(prev.key);
                    const tabs = e.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]');
                    tabs?.[(i - 1 + NAV_ITEMS.length) % NAV_ITEMS.length]?.focus();
                  }
                }}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="settings-content">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};
