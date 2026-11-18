import "server-only";
import { randomUUID } from "node:crypto";
import {
  aliasedTable,
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays } from "@/lib/time";
import { formatDay } from "@/lib/workload";

/**
 * Notices between teammates, delivered as toasts:
 *  - the day before a task a teammate assigned is due, its assignee is reminded
 *  - when an assignee completes such a task, whoever assigned it is told
 * The browser asks for new notices when the app opens and every half minute
 * after (components/notification-toaster.tsx); each is shown once.
 */

/** A database handle inside a transaction. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NotificationDto = {
  id: string;
  kind: "due-tomorrow" | "task-completed" | "cannot-finish";
  message: string;
};

/** Called when a task becomes completed. Does nothing for the user's own tasks. */
export async function notifyAssignerOfCompletion(tx: Tx, taskId: string) {
  const assignee = aliasedTable(schema.users, "assignee");
  const [task] = await tx
    .select({
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      assignedById: schema.tasks.assignedById,
      userId: schema.tasks.userId,
      assigneeName: assignee.name,
    })
    .from(schema.tasks)
    .innerJoin(assignee, eq(assignee.id, schema.tasks.userId))
    .where(eq(schema.tasks.id, taskId));
  if (!task?.assignedById || task.assignedById === task.userId) return;

  const message = `${task.assigneeName} completed "${task.title}" (due ${formatDay(task.dueDate)}).`;
  // Completed again after being reopened: tell the assigner again.
  await tx
    .insert(schema.notifications)
    .values({
      id: randomUUID(),
      userId: task.assignedById,
      kind: "task-completed",
      taskId,
      message,
    })
    .onConflictDoUpdate({
      target: [
        schema.notifications.userId,
        schema.notifications.kind,
        schema.notifications.taskId,
      ],
      set: { message, createdAt: sql`now()`, seenAt: null },
    });
}

/**
 * Creates reminders for unfinished, teammate-assigned tasks due the day after
 * `today` (the user's own date). Each task is reminded about once.
 */
async function queueDueReminders(userId: string, today: string) {
  const assigner = aliasedTable(schema.users, "assigner");
  const due = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      assignerName: assigner.name,
    })
    .from(schema.tasks)
    .leftJoin(assigner, eq(assigner.id, schema.tasks.assignedById))
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNotNull(schema.tasks.assignedById),
        ne(schema.tasks.assignedById, userId),
        ne(schema.tasks.status, "completed"),
        eq(schema.tasks.dueDate, addDays(today, 1)),
      ),
    );
  if (due.length === 0) return;

  await db
    .insert(schema.notifications)
    .values(
      due.map((task) => ({
        id: randomUUID(),
        userId,
        kind: "due-tomorrow" as const,
        taskId: task.id,
        message: `"${task.title}" is due tomorrow (${formatDay(task.dueDate)})${
          task.assignerName ? `, assigned by ${task.assignerName}` : ""
        }.`,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Unfinished tasks teammates assigned to this user, for the Shared Tasks
 * badge in the sidebar; `dueSoon` counts those due by tomorrow (or overdue).
 */
export async function countOpenSharedTasks(userId: string, today: string) {
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      dueSoon: sql<number>`(count(*) filter (where ${lte(schema.tasks.dueDate, addDays(today, 1))}))::int`,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNotNull(schema.tasks.assignedById),
        ne(schema.tasks.assignedById, userId),
        ne(schema.tasks.status, "completed"),
      ),
    );
  return { open: row?.open ?? 0, dueSoon: row?.dueSoon ?? 0 };
}

/** New notices for this user, marked as shown, plus the Shared Tasks count. */
export async function takeNotifications(userId: string, today: string) {
  await queueDueReminders(userId, today);
  const shared = await countOpenSharedTasks(userId, today);
  const notices = await db.transaction(async (tx): Promise<NotificationDto[]> => {
    const unseen = await tx
      .select({
        id: schema.notifications.id,
        kind: schema.notifications.kind,
        message: schema.notifications.message,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.seenAt),
        ),
      )
      .orderBy(asc(schema.notifications.createdAt))
      .for("update", { skipLocked: true });
    if (unseen.length > 0) {
      await tx
        .update(schema.notifications)
        .set({ seenAt: sql`now()` })
        .where(inArray(schema.notifications.id, unseen.map(({ id }) => id)));
    }
    return unseen;
  });
  return { notices, shared };
}
