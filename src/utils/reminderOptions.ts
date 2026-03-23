export type ReminderOption = {
  label: string;
  subLabel: string;
  getDateTime: () => string;
};

export function getReminderOptions(): ReminderOption[] {
  const now = new Date();

  // "Later today" — next even hour, minimum 1h from now
  const laterToday = new Date(now);
  laterToday.setMinutes(0, 0, 0);
  laterToday.setHours(laterToday.getHours() + 2);
  // If it's past 21:00 push to tomorrow 09:00 instead
  const tooLateToday = laterToday.getHours() >= 23 || laterToday.getDate() !== now.getDate();

  // "Tomorrow" — tomorrow at 09:00
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  // "Next week" — next Monday at 09:00
  const nextMonday = new Date(now);
  const dayOfWeek = nextMonday.getDay(); // 0=Sun
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

  const formatDayTime = (d: Date) =>
    `${d.toLocaleDateString(undefined, { weekday: "short" })} ${formatTime(d)}`;

  const toIso = (d: Date) => d.toISOString();

  const options: ReminderOption[] = [];

  if (!tooLateToday) {
    options.push({
      label: "Later today",
      subLabel: formatTime(laterToday),
      getDateTime: () => toIso(laterToday),
    });
  }

  options.push({
    label: "Tomorrow",
    subLabel: formatDayTime(tomorrow),
    getDateTime: () => toIso(tomorrow),
  });

  options.push({
    label: "Next week",
    subLabel: formatDayTime(nextMonday),
    getDateTime: () => toIso(nextMonday),
  });

  return options;
}
