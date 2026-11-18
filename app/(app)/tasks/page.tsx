import { Suspense } from "react";
import { TaskBoardSkeleton } from "@/components/skeletons";
import TaskList from "@/components/task-list";
import { priorityStyles, type TaskPriority } from "@/components/task-card";

const priorityOrder: TaskPriority[] = ["critical", "high", "medium", "low"];

export default function TasksPage() {
  return (
    <main className="mx-auto my-auto w-full max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--lime)]" />
          Planning
        </p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight text-navy">
          Your tasks, all in one place
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Keep track of everything on your plate: tasks you planned with
          PlanMate AI and tasks teammates assigned to you. A task moves along
          as you tick its sessions on the calendar, or just tell PlanMate AI,
          for example &quot;I finished paper 2&quot;.
        </p>
      </header>

      <aside
        aria-label="Task priority guide"
        className="sheet space-y-3 rounded-xl border bg-card p-4"
      >
        <h2 className="text-sm font-semibold text-navy">Priority guide</h2>
        <ul className="flex flex-wrap gap-2">
          {priorityOrder.map((priority) => {
            const details = priorityStyles[priority];

            return (
              <li
                key={priority}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${details.className}`}
              >
                <span className="font-semibold">{details.label}</span>
                <span>{details.description}</span>
              </li>
            );
          })}
        </ul>
      </aside>

      <Suspense fallback={<TaskBoardSkeleton />}>
        <TaskList scope="all" />
      </Suspense>
    </main>
  );
}
