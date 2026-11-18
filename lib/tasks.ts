import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import { db, schema } from "@/lib/db";
import { notifyAssignerOfCompletion, type Tx } from "@/lib/notifications";

export type TaskStatus = "not-started" | "ongoing" | "completed";

/**
 * A task's status follows its calendar sessions: none ticked is "not-started",
 * some is "ongoing", all is "completed". These two functions keep the task and
 * its sessions in step whichever side the user changes.
 */

/**
 * The one place a task's status is written. When the task moves to
 * "completed" and a teammate assigned it, the assigner gets a notice.
 */
async function writeTaskStatus(
  tx: Tx,
  taskId: string,
  status: TaskStatus,
  extra: { estimatedMinutes?: number } = {},
) {
  const [before] = await tx
    .select({ status: schema.tasks.status })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  await tx
    .update(schema.tasks)
    .set({ status, ...extra })
    .where(eq(schema.tasks.id, taskId));
  if (before && before.status !== "completed" && status === "completed") {
    await notifyAssignerOfCompletion(tx, taskId);
  }
}

/** Tick or untick one calendar session, then update its task's status to match. */
export async function setBlockCompleted(
  userId: string,
  blockId: string,
  completed: boolean,
) {
  return db.transaction(async (tx) => {
    const [block] = await tx
      .update(schema.blocks)
      .set({ completed })
      .where(and(eq(schema.blocks.id, blockId), eq(schema.blocks.userId, userId)))
      .returning({ taskId: schema.blocks.taskId });
    if (!block) throw new HttpError(404, "Block not found.");
    if (!block.taskId) return { taskStatus: null };

    const sessions = await tx
      .select({ completed: schema.blocks.completed })
      .from(schema.blocks)
      .where(eq(schema.blocks.taskId, block.taskId));
    const done = sessions.filter((session) => session.completed).length;
    const taskStatus: TaskStatus =
      done === 0 ? "not-started" : done === sessions.length ? "completed" : "ongoing";

    await writeTaskStatus(tx, block.taskId, taskStatus);
    return { taskStatus };
  });
}

/** Set a task's status directly (from the chat), and tick its sessions to match. */
export async function setTaskStatus(
  userId: string,
  taskId: string,
  status: TaskStatus,
) {
  await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
    if (!owned) throw new HttpError(404, "Task not found.");
    await writeTaskStatus(tx, taskId, status);

    // "ongoing" says nothing about which sessions are done, so leave them.
    if (status !== "ongoing") {
      await tx
        .update(schema.blocks)
        .set({ completed: status === "completed" })
        .where(eq(schema.blocks.taskId, taskId));
    }
  });
}

/**
 * Remove one session from the calendar. Its task follows: with no sessions
 * left the task is deleted too (unless a teammate assigned it, in which case
 * it just goes back to "not-started"); otherwise its status and planned time
 * are recalculated from the sessions that remain.
 */
export async function removeSession(userId: string, blockId: string) {
  return db.transaction(async (tx) => {
    const [block] = await tx
      .delete(schema.blocks)
      .where(and(eq(schema.blocks.id, blockId), eq(schema.blocks.userId, userId)))
      .returning({ taskId: schema.blocks.taskId, title: schema.blocks.title });
    if (!block) throw new HttpError(404, "Session not found.");
    if (!block.taskId) return { title: block.title, taskRemoved: false };

    const remaining = await tx
      .select({
        start: schema.blocks.start,
        end: schema.blocks.end,
        completed: schema.blocks.completed,
      })
      .from(schema.blocks)
      .where(eq(schema.blocks.taskId, block.taskId));

    if (remaining.length === 0) {
      const deleted = await tx
        .delete(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, block.taskId),
            isNull(schema.tasks.assignedById),
          ),
        )
        .returning({ id: schema.tasks.id });
      if (deleted.length === 0) {
        await tx
          .update(schema.tasks)
          .set({ status: "not-started", estimatedMinutes: 0 })
          .where(eq(schema.tasks.id, block.taskId));
      }
      return { title: block.title, taskRemoved: deleted.length > 0 };
    }

    const done = remaining.filter((session) => session.completed).length;
    const minutes = (time: string) =>
      Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
    await writeTaskStatus(
      tx,
      block.taskId,
      done === 0 ? "not-started" : done === remaining.length ? "completed" : "ongoing",
      {
        estimatedMinutes: remaining.reduce(
          (sum, session) => sum + minutes(session.end) - minutes(session.start),
          0,
        ),
      },
    );
    return { title: block.title, taskRemoved: false };
  });
}
