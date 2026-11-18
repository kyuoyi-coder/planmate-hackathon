import TaskBoard, { type TaskGroup } from "@/components/task-board";
import type { TaskStatus } from "@/components/task-card";
import { getTasks, getTasksAssignedByMe } from "@/lib/data";

const STATUS_COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: "not-started", title: "Not started" },
  { status: "ongoing", title: "Ongoing" },
  { status: "completed", title: "Completed" },
];

/**
 * Loads the signed-in user's tasks on the server and groups them by status.
 * `scope="shared"` keeps only the ones a teammate assigned, and
 * `scope="assigned-by-me"` shows the tasks this user gave to teammates. The
 * board it renders is a Client Component only for its due-date filter.
 */
export default async function TaskList({
  scope,
}: {
  scope: "all" | "shared" | "assigned-by-me";
}) {
  const tasks =
    scope === "assigned-by-me"
      ? (await getTasksAssignedByMe()).map((task) => ({ ...task, assignedBy: null }))
      : (await getTasks())
          .filter((task) => scope === "all" || task.assignedBy)
          .map((task) => ({ ...task, assignedTo: null }));

  const groups: TaskGroup[] = STATUS_COLUMNS.map(({ status, title }) => ({
    status,
    title,
    tasks: tasks
      .filter((task) => task.status === status)
      .map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        project: task.project,
        dueDate: task.dueDate,
        priority: task.priority,
        assignedBy: task.assignedBy ?? undefined,
        assignedTo: task.assignedTo ?? undefined,
        cannotFinishReason: task.cannotFinishReason ?? undefined,
      })),
  }));

  return <TaskBoard groups={groups} />;
}
