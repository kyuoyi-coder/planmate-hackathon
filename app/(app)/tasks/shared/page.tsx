import { Suspense } from "react";
import { TaskBoardSkeleton } from "@/components/skeletons";
import TaskList from "@/components/task-list";
import { requireUser } from "@/lib/auth";
import { canAssign } from "@/lib/roles";

export default function SharedTaskPage() {
  return (
    <main className="mx-auto my-auto w-full max-w-7xl space-y-8 px-4 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--lime)]" />
          Shared space
        </p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight text-navy">
          Shared tasks from your team
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Keep track of tasks teammates have assigned to you. Each task shows
          who assigned it and is grouped by its current status. You get a
          reminder the day before each one is due. Team leaders and
          sub-leaders assign tasks by asking PlanMate AI, for example
          &quot;assign the demo slides to Priya by Friday&quot;.
        </p>
      </header>

      <Suspense fallback={<TaskBoardSkeleton />}>
        <TaskList scope="shared" />
      </Suspense>

      {/* Only leaders and sub-leaders assign tasks, so only they see this. */}
      <Suspense fallback={null}>
        <AssignedByYou />
      </Suspense>
    </main>
  );
}

async function AssignedByYou() {
  const user = await requireUser();
  if (!canAssign(user.role)) return null;

  return (
    <section aria-labelledby="assigned-by-you" className="space-y-4 border-t pt-8">
      <header className="space-y-2">
        <h2
          id="assigned-by-you"
          className="font-heading text-3xl font-semibold tracking-tight text-navy"
        >
          Assigned by you
        </h2>
        <p className="max-w-2xl text-muted-foreground">
          Follow the tasks you gave your team. When someone completes one, you
          get a notification and it moves to Completed here.
        </p>
      </header>
      <Suspense fallback={<TaskBoardSkeleton />}>
        <TaskList scope="assigned-by-me" />
      </Suspense>
    </section>
  );
}
