import { useState, useEffect, useCallback } from "react";
import { ReminderTiming } from "./useReminders";

/** Persist a single setting to the Tauri store. */
async function persistSetting(key: string, value: unknown): Promise<void> {
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load("settings.json");
  await store.set(key, value);
  await store.save();
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load all persisted settings on mount
  useEffect(() => {
    (async () => {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("settings.json");
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
      setSettingsLoaded(true);
    })();
  }, []);

  const handleRemindersEnabledChange = useCallback(async (enabled: boolean) => {
    setRemindersEnabled(enabled);
    await persistSetting("remindersEnabled", enabled);
  }, []);

  const handleReminderTimingChange = useCallback(async (timing: ReminderTiming) => {
    setReminderTiming(timing);
    await persistSetting("reminderTiming", timing);
  }, []);

  const handleThemeChange = useCallback(async (t: "light" | "dark" | "system") => {
    setTheme(t);
    await persistSetting("theme", t);
  }, []);

  const handleFontSizeChange = useCallback(async (s: "small" | "normal" | "large") => {
    setFontSize(s);
    await persistSetting("fontSize", s);
  }, []);

  const handleCompactModeChange = useCallback(async (c: boolean) => {
    setCompactMode(c);
    await persistSetting("compactMode", c);
  }, []);

  const handleSyncIntervalChange = useCallback(async (interval: number) => {
    setSyncInterval(interval);
    await persistSetting("syncInterval", interval);
  }, []);

  const handleMyDayReset = useCallback(async (date: string) => {
    setLastMyDayReset(date);
    await persistSetting("lastMyDayReset", date);
  }, []);

  const handleReorderTasks = useCallback((activeList: string, reorderedIds: string[]) => {
    const next = { ...taskOrder, [activeList]: reorderedIds };
    setTaskOrder(next);
    // Best-effort persistence (fire-and-forget, outside of setState)
    persistSetting("taskOrder", next).catch(() => {});
  }, [taskOrder]);

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
    settingsLoaded,
  };
};
