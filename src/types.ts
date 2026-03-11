export type ListName = "My Day" | "Important" | "Planned" | "Assigned to Me" | "Flagged Emails" | "Tasks";

export type TaskAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  lastModifiedDateTime: string;
};

export type TaskList = {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName?: "none" | "defaultList" | "flaggedEmails";
  isGroup?: boolean;      // local-only: renders as collapsible heading, not a task list
  parentGroupId?: string; // local-only: the group this sub-list belongs to
};

export type ChecklistItem = {
  id: string;
  displayName: string;
  isChecked: boolean;
};

export type Recurrence = {
  pattern: {
    type: "daily" | "weekly" | "absoluteMonthly" | "absoluteYearly";
    interval: number;
    daysOfWeek?: string[];
  };
  range: { type: "noEnd" | "endDate" | "numbered"; startDate: string };
};

export type Task = {
  id: string;
  title: string;
  completed: boolean;
  listId?: string;
  status?: "notStarted" | "inProgress" | "completed";
  isInMyDay?: boolean;
  importance?: "low" | "normal" | "high";
  dueDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  body?: {
    content: string;
    contentType: "text" | "html";
  };
  recurrence?: Recurrence;
  categories?: string[];
  hasAttachments?: boolean;
  checklistItems?: ChecklistItem[];
  lastModified?: number;
};