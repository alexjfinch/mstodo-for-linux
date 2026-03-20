import { useMemo } from "react";
import { Task, ListName, TaskList } from "../types";

export const useFilteredTasks = (
  tasks: Task[],
  activeFilter: ListName | string,
  lists: TaskList[]
) => {
  return useMemo(() => {
    const flaggedListId = lists.find(l => l.wellknownListName === "flaggedEmails")?.id;

    return tasks.filter((task) => {
      switch (activeFilter) {
        case "My Day":         return task.isInMyDay === true && !task.completed;
        case "Important":      return task.importance === "high" && !task.completed;
        case "Planned":        return !!task.dueDateTime && !task.completed;
        case "Assigned to Me": return task.listId === "__assigned__" && !task.completed;
        case "Tasks":          return task.listId !== "__assigned__" && task.listId !== flaggedListId;
        case "Flagged Emails": return task.listId === flaggedListId;
        default:               return task.listId === activeFilter;
      }
    });
  }, [tasks, activeFilter, lists]);
};
