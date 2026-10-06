import { useCallback } from "react";
import { Task, TaskList } from "../types";
import {
  buildJsonExport,
  buildCsvExport,
  saveTextFile,
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
  const exportFile = useCallback(
    async (filename: string, content: string, successBody: string) => {
      try {
        const saved = await saveTextFile(filename, content);
        if (saved) pushToast({ type: "success", title: "Export complete", body: successBody });
      } catch (err) {
        pushToast({ type: "error", title: "Export failed", body: err instanceof Error ? err.message : String(err) });
      }
    },
    [pushToast]
  );

  const handleExportJson = useCallback(() => {
    const date = new Date().toISOString().split("T")[0];
    return exportFile(`mstodo-backup-${date}.json`, buildJsonExport(tasks, lists), "Tasks saved as a JSON backup.");
  }, [tasks, lists, exportFile]);

  const handleExportCsv = useCallback(() => {
    const date = new Date().toISOString().split("T")[0];
    return exportFile(`mstodo-export-${date}.csv`, buildCsvExport(tasks, lists), "Tasks saved as a CSV file.");
  }, [tasks, lists, exportFile]);

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

      let totalFailed = 0;
      for (let i = 0; i < importedTasks.length; i += IMPORT_BATCH_SIZE) {
        const batch = importedTasks.slice(i, i + IMPORT_BATCH_SIZE);
        const results = await Promise.allSettled(
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
        totalFailed += results.filter((r) => r.status === "rejected").length;
      }

      const succeeded = importedTasks.length - totalFailed;
      const skippedNote = skippedDates
        ? ` (${skippedDates} due date${skippedDates !== 1 ? "s" : ""} could not be parsed and were skipped)`
        : "";
      const failedNote = totalFailed > 0
        ? ` ${totalFailed} task${totalFailed !== 1 ? "s" : ""} failed to import.`
        : "";
      pushToast({
        type: totalFailed > 0 && succeeded === 0 ? "error" : "success",
        title: "Import complete",
        body: `${succeeded} task${succeeded !== 1 ? "s" : ""} imported successfully.${skippedNote}${failedNote}`,
      });
      return succeeded;
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
