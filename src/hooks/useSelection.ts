import { useState, useCallback } from "react";
import { Task } from "../types";

interface UseSelectionOptions {
  filteredTasks: Task[];
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  setDetailTaskId: (id: string | null) => void;
}

export function useSelection({ filteredTasks, toggleTask, deleteTask, setDetailTaskId }: UseSelectionOptions) {
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const handleClearSelection = useCallback(() => {
    setSelectedTasks([]);
  }, []);

  const handleToggleSelection = useCallback(
    (taskId: string, shiftKey: boolean) => {
      setDetailTaskId(null);
      if (!shiftKey) {
        setSelectedTasks((prev) =>
          prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
        );
      } else {
        const currentTaskIds = filteredTasks.filter((t) => !t.completed).map((t) => t.id);
        const clickedIndex = currentTaskIds.indexOf(taskId);
        setSelectedTasks((prev) => {
          if (prev.length === 0) return [taskId];
          const lastIndex = currentTaskIds.indexOf(prev[prev.length - 1]);
          if (lastIndex === -1) return [taskId];
          const start = Math.min(lastIndex, clickedIndex);
          const end = Math.max(lastIndex, clickedIndex);
          return [...new Set([...prev, ...currentTaskIds.slice(start, end + 1)])];
        });
      }
    },
    [filteredTasks, setDetailTaskId]
  );

  const handleBulkComplete = useCallback(async () => {
    await Promise.allSettled(selectedTasks.map((id) => toggleTask(id)));
    setSelectedTasks([]);
  }, [selectedTasks, toggleTask]);

  const handleBulkDelete = useCallback(async () => {
    await Promise.allSettled(selectedTasks.map((id) => deleteTask(id)));
    setSelectedTasks([]);
  }, [selectedTasks, deleteTask]);

  return {
    selectedTasks,
    setSelectedTasks,
    bulkDeleteConfirm,
    setBulkDeleteConfirm,
    handleClearSelection,
    handleToggleSelection,
    handleBulkComplete,
    handleBulkDelete,
  };
}
