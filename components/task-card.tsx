import { CalendarDays } from "lucide-react";

export type TaskStatus = "not-started" | "ongoing" | "completed";
export type TaskPriority = "critical" | "high" | "medium" | "low";

export type TaskCardProps = {
  title: string;
  description: string;
  project: string;
  dueDate: string;
  status: TaskStatus;
  priority?: TaskPriority;
  assignedBy?: string;
  /** On the assigner's "Assigned by you" board: who is doing it. */
  assignedTo?: string;
  /** The assignee said they can't finish it on time, and why. */
  cannotFinishReason?: string;
};

export const priorityStyles: Record<
  TaskPriority,
  { label: string; description: string; className: string }
> = {
  critical: {
    label: "Critical",
    description: "Must do",
    className: "bg-clay text-clay-foreground",
  },
  high: {
    label: "High",
    description: "Should do",
    className: "bg-clay/20 text-warn",
  },
  medium: {
    label: "Medium",
    description: "Can postpone",
    className: "bg-muted text-foreground/80",
  },
  low: {
    label: "Low",
    description: "Optional",
    className: "border border-border text-muted-foreground",
  },
};

// Neutral glass for not started, an ember tint in progress, lime once done.
const statusStyles: Record<
  TaskStatus,
  { label: string; card: string; badge: string; dot: string }
> = {
  "not-started": {
    label: "Not started",
    card: "border-border bg-card",
    badge: "bg-muted text-foreground/70",
    dot: "bg-foreground/40",
  },
  ongoing: {
    label: "Ongoing",
    card: "border-clay/35 bg-clay/10",
    badge: "bg-clay/20 text-warn",
    dot: "bg-clay",
  },
  completed: {
    label: "Completed",
    card: "border-primary/30 bg-primary/10",
    badge: "bg-primary/20 text-accent-foreground",
    dot: "bg-primary",
  },
};

export default function TaskCard({
  title,
  description,
  project,
  dueDate,
  status,
  priority,
  assignedBy,
  assignedTo,
  cannotFinishReason,
}: TaskCardProps) {
  const styles = statusStyles[status];
  const taskPriority = priority ? priorityStyles[priority] : undefined;
  const [year, month, day] = dueDate.split("-").map(Number);
  const formattedDueDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));

  return (
    <article
      className={`sheet space-y-3 rounded-xl border p-4 ${styles.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-lg font-medium leading-snug text-navy">{title}</h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${styles.badge}`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${styles.dot}`}
            />
            {styles.label}
          </span>
          {taskPriority && (
            <span
              aria-label={`Priority: ${taskPriority.label}, ${taskPriority.description}`}
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${taskPriority.className}`}
            >
              {taskPriority.label}
            </span>
          )}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {assignedBy && (
        <p className="text-xs text-navy/75">
          Assigned by <span className="font-semibold text-navy">{assignedBy}</span>
        </p>
      )}
      {cannotFinishReason && status !== "completed" && (
        <p className="rounded-lg bg-clay/15 px-2.5 py-1.5 text-xs text-warn">
          <span className="font-semibold">Can&apos;t finish on time:</span>{" "}
          {cannotFinishReason}
        </p>
      )}
      {assignedTo && (
        <p className="text-xs text-navy/75">
          Assigned to <span className="font-semibold text-navy">{assignedTo}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-current/10 pt-2 text-xs font-medium text-navy/75">
        <p>{project}</p>
        <time dateTime={dueDate} className="inline-flex items-center gap-1.5">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {formattedDueDate}
        </time>
      </div>
    </article>
  );
}
