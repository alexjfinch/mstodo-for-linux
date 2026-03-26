import { useState, useEffect, useCallback } from "react";
import { ReminderTiming } from "./useReminders";
import { logger } from "../services/logger";

// Lazily initialised store — cached so we don't re-load from disk on every setting change.
type TauriStore = Awaited<ReturnType<typeof import("@tauri-apps/plugin-store")["Store"]["load"]>>;
let _storeCache: TauriStore | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

async function getStore(): Promise<TauriStore> {
  if (!_storeCache) {
    const { Store } = await import("@tauri-apps/plugin-store");
    _storeCache = await Store.load("settings.json");
  }
  return _storeCache;
}

/** Persist a single setting. The in-memory set is immediate; disk flush is debounced. */
async function persistSetting(key: string, value: unknown): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    store.save().catch((err: unknown) => {
      logger.error("Failed to flush settings to disk", err);
    });
  }, 500);
}

export const useSettings = () => {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [fontSize, setFontSize] = useState<"small" | "normal" | "large">("normal");
  const [compactMode, setCompactMode] = useState(false);
  const [syncInterval, setSyncInterval] = useState(30);
  const [taskOrder, setTaskOrder] = useState<Record<string, string[]>>({});
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [reminderTiming, setReminderTiming] = useState<ReminderTiming>("15min");
  const [lastMyDayReset, setLastMyDayReset] = useState<string | null>(null);
  const [weekStartDay, setWeekStartDay] = useState<0 | 1 | 6>(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Load all persisted settings on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const enabled = await store.get<boolean>("remindersEnabled");
        const timing = await store.get<ReminderTiming>("reminderTiming");
        if (enabled !== null && enabled !== undefined) setRemindersEnabled(enabled);
        if (timing) setReminderTiming(timing);

        const savedTheme = await store.get<"light" | "dark" | "system">("theme");
        if (savedTheme) setTheme(savedTheme);
        const savedFontSize = await store.get<"small" | "normal" | "large">("fontSize");
        if (savedFontSize) setFontSize(savedFontSize);
        const savedCompact = await store.get<boolean>("compactMode");
        if (savedCompact !== null && savedCompact !== undefined) setCompactMode(savedCompact);
        const savedSyncInterval = await store.get<number>("syncInterval");
        if (savedSyncInterval !== null && savedSyncInterval !== undefined) setSyncInterval(savedSyncInterval);
        const savedTaskOrder = await store.get<Record<string, string[]>>("taskOrder");
        if (savedTaskOrder) setTaskOrder(savedTaskOrder);
        const savedLastMyDayReset = await store.get<string>("lastMyDayReset");
        if (savedLastMyDayReset) setLastMyDayReset(savedLastMyDayReset);
        const savedWeekStartDay = await store.get<0 | 1 | 6>("weekStartDay");
        if (savedWeekStartDay !== null && savedWeekStartDay !== undefined) setWeekStartDay(savedWeekStartDay);
      } catch (err: unknown) {
        logger.error("Failed to load settings from store", err);
        setSettingsError("Failed to load settings");
      }
      setSettingsLoaded(true);
    })();
  }, []);

  const handleRemindersEnabledChange = useCallback(async (enabled: boolean) => {
    setRemindersEnabled(enabled);
    setSettingsError(null);
    try { await persistSetting("remindersEnabled", enabled); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleReminderTimingChange = useCallback(async (timing: ReminderTiming) => {
    setReminderTiming(timing);
    setSettingsError(null);
    try { await persistSetting("reminderTiming", timing); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleThemeChange = useCallback(async (t: "light" | "dark" | "system") => {
    setTheme(t);
    setSettingsError(null);
    try { await persistSetting("theme", t); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleFontSizeChange = useCallback(async (s: "small" | "normal" | "large") => {
    setFontSize(s);
    setSettingsError(null);
    try { await persistSetting("fontSize", s); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleCompactModeChange = useCallback(async (c: boolean) => {
    setCompactMode(c);
    setSettingsError(null);
    try { await persistSetting("compactMode", c); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleSyncIntervalChange = useCallback(async (interval: number) => {
    setSyncInterval(interval);
    setSettingsError(null);
    try { await persistSetting("syncInterval", interval); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleMyDayReset = useCallback(async (date: string) => {
    setLastMyDayReset(date);
    setSettingsError(null);
    try { await persistSetting("lastMyDayReset", date); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleWeekStartDayChange = useCallback(async (day: 0 | 1 | 6) => {
    setWeekStartDay(day);
    setSettingsError(null);
    try { await persistSetting("weekStartDay", day); }
    catch { setSettingsError("Failed to save setting"); }
  }, []);

  const handleReorderTasks = useCallback((activeList: string, reorderedIds: string[]) => {
    setTaskOrder((prev) => {
      const next = { ...prev, [activeList]: reorderedIds };
      persistSetting("taskOrder", next).catch((err: unknown) => {
        logger.error("Failed to persist taskOrder setting", String(err));
        setSettingsError("Failed to save task order");
      });
      return next;
    });
  }, []);

  return {
    theme,
    fontSize,
    compactMode,
    syncInterval,
    taskOrder,
    remindersEnabled,
    reminderTiming,
    handleThemeChange,
    handleFontSizeChange,
    handleCompactModeChange,
    handleSyncIntervalChange,
    handleRemindersEnabledChange,
    handleReminderTimingChange,
    handleReorderTasks,
    lastMyDayReset,
    handleMyDayReset,
    weekStartDay,
    handleWeekStartDayChange,
    settingsLoaded,
    settingsError,
  };
};
