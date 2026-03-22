import * as chrono from "chrono-node";

/**
 * Format a Date as a Microsoft Graph due-date string using local calendar date,
 * avoiding UTC conversion artifacts that cause off-by-one date errors in
 * non-UTC timezones.  Always produces "YYYY-MM-DDT00:00:00.0000000".
 */
export function localDateToGraphDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00.0000000`;
}

type ParsedTask = {
  title: string;
  dueDateTime?: { dateTime: string; timeZone: string };
};

export function parseTaskInput(input: string): ParsedTask {
  const results = chrono.parse(input, new Date(), { forwardDate: true });

  if (results.length === 0) {
    return { title: input };
  }

  // Use the first detected date
  const match = results[0];
  const date = match.start.date();

  // Guard against invalid/NaN dates from ambiguous input
  if (isNaN(date.getTime())) {
    return { title: input };
  }

  // Remove the date phrase from the title
  const before = input.slice(0, match.index).trim();
  const after = input.slice(match.index + match.text.length).trim();
  let title = [before, after].filter(Boolean).join(" ");

  // Clean up leftover prepositions/connectors at the end
  title = title.replace(/\s+(on|by|at|due|before|until)$/i, "").trim();

  // If nothing left, keep original
  if (!title) title = input;

  // Microsoft Graph API enforces a 255-character limit on task titles
  if (title.length > 255) title = title.slice(0, 255);

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return {
    title,
    dueDateTime: {
      dateTime: `${yyyy}-${mm}-${dd}T00:00:00.0000000`,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}
