import * as chrono from "chrono-node";

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
