import { useCallback } from "react";
import { Task, TaskList } from "../types";
import {
  buildJsonExport,
  buildCsvExport,
  downloadTextFile,
  pickImportFile,
  importFromJson,
  importFromTodoistCsv,
  importFromEvernoteEnex,
  importFromGenericCsv,
  ImportResult,
} from "../api/importExport";

// Process imports in batches to avoid 500 sequential round-trips for large files
const IMPORT_BATCH_SIZE = 10;

interface UseImportExportOptions {
  tasks: Task[];
  lists: TaskList[];
  addTask: (title: string, listId?: string, attrs?: Partial<Task>) => Promise<void>;
  pushToast: (toast: { title: string; body: string; type?: "reminder" | "success" | "error" }) => void;
}

export function useImportExport({ tasks, lists, addTask, pushToast }: UseImportExportOptions) {
  const handleExportJson = useCallback(() => {
    const content = buildJsonExport(tasks, lists);
    const date = new Date().toISOString().split("T")[0];
    downloadTextFile(`mstodo-backup-${date}.json`, content, "application/json");
    pushToast({ type: "success", title: "Export complete", body: "Tasks downloaded as a JSON backup." });
  }, [tasks, lists, pushToast]);

  const handleExportCsv = useCallback(() => {
    const content = buildCsvExport(tasks, lists);
    const date = new Date().toISOString().split("T")[0];
    downloadTextFile(`mstodo-export-${date}.csv`, content, "text/csv");
    pushToast({ type: "success", title: "Export complete", body: "Tasks downloaded as a CSV file." });
  }, [tasks, lists, pushToast]);

  const handleImport = useCallback(
    async (parser: (content: string) => ImportResult): Promise<number | null> => {
      const file = await pickImportFile();
      if (!file) return null;

      const { tasks: importedTasks, skippedDates } = parser(file.content);

      const defaultList =
        lists.find((l) => l.wellknownListName === "defaultList") ||
        lists.find((l) => l.displayName === "Tasks") ||
        lists[0];

      if (!defaultList) throw new Error("No task list found to import into.");

      for (let i = 0; i < importedTasks.length; i += IMPORT_BATCH_SIZE) {
        const batch = importedTasks.slice(i, i + IMPORT_BATCH_SIZE);
        await Promise.allSettled(
          batch.map((t) =>
            addTask(t.title, defaultList.id, {
              importance: t.importance,
              dueDateTime: t.dueDateTime,
              body: t.body,
              categories: t.categories,
              isInMyDay: t.isInMyDay,
            })
          )
        );
      }

      const count = importedTasks.length;
      const skippedNote = skippedDates
        ? ` (${skippedDates} due date${skippedDates !== 1 ? "s" : ""} could not be parsed and were skipped)`
        : "";
      pushToast({
        type: "success",
        title: "Import complete",
        body: `${count} task${count !== 1 ? "s" : ""} imported successfully.${skippedNote}`,
      });
      return count;
    },
    [lists, addTask, pushToast]
  );

  const handleImportJson = useCallback(() => handleImport(importFromJson), [handleImport]);
  const handleImportTodoist = useCallback(() => handleImport(importFromTodoistCsv), [handleImport]);
  const handleImportEvernote = useCallback(() => handleImport(importFromEvernoteEnex), [handleImport]);
  const handleImportCsv = useCallback(() => handleImport(importFromGenericCsv), [handleImport]);

  return {
    handleExportJson,
    handleExportCsv,
    handleImportJson,
    handleImportTodoist,
    handleImportEvernote,
    handleImportCsv,
  };
}
