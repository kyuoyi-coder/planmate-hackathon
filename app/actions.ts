"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getCurrentUser,
  type CurrentUser,
} from "@/lib/auth";
import { getChatMessages } from "@/lib/data";
import { db, schema } from "@/lib/db";
import { HttpError, toUserMessage, type ActionResult } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import {
  handleChatMessage,
  resolveEmail,
  resolveHeldAssignments,
  undoPlanFromCard,
} from "@/lib/planner/agent";
import { takeNotifications } from "@/lib/notifications";
import { setBlockCompleted } from "@/lib/tasks";
import { isDate, isDateTime } from "@/lib/time";

/**
 * Every change the app makes goes through one of these Server Actions. Each
 * one re-checks the session itself: a Server Action is a public endpoint, so
 * it never trusts that the page calling it was allowed to render.
 */
async function authed<T>(
  work: (user: CurrentUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, error: "Your session has expired. Please sign in again." };
    }
    return { ok: true, data: await work(user) };
  } catch (error) {
    // Let redirects and other framework signals through.
    unstable_rethrow(error);
    return { ok: false, error: toUserMessage(error) };
  }
}

// --- Auth ----------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().max(200),
});

export async function login(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    const { email, password } = loginSchema.parse(Object.fromEntries(formData));
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    // Same message either way, so the form doesn't reveal which emails exist.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return { error: "Incorrect email or password." };
    }
    await createSession(user.id);
  } catch (error) {
    return { error: toUserMessage(error) };
  }
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// --- Chat ----------------------------------------------------------------------

const messageSchema = z.object({
  sessionId: z.string().optional(),
  content: z.string().trim().min(1, "Type a message.").max(4000),
  /** The browser's local wall-clock time, so plans start from the user's "now". */
  now: z.string().refine(isDateTime, "Invalid local time."),
});

export async function sendChatMessage(input: z.input<typeof messageSchema>) {
  return authed(async (user) => {
    const result = await handleChatMessage({ user, ...messageSchema.parse(input) });
    // A confirmed plan or status change alters the calendar and task pages.
    if (result.dataChanged) refresh();
    return result;
  });
}

/** The "Undo" button on a plan card: takes that plan off the calendar. */
export async function undoPlan(messageId: string) {
  return authed(async (user) => {
    const result = await undoPlanFromCard(user, z.string().parse(messageId));
    refresh();
    return result;
  });
}

const date = z.string().refine(isDate, "Invalid date.");
const heldDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("reassign"),
    index: z.number().int().min(0),
    assigneeId: z.string(),
  }),
  z.object({
    action: z.literal("reschedule"),
    index: z.number().int().min(0),
    dueDate: date,
  }),
]);

/**
 * The assigner's decision in the workload popup: assign anyway, don't
 * assign, give it to someone else, or move the due date. `today` is the
 * browser's local date, which the re-check counts from.
 */
export async function resolveAssignment(
  messageId: string,
  decision: z.input<typeof heldDecisionSchema>,
  today: string,
) {
  return authed(async (user) => {
    const result = await resolveHeldAssignments(
      user,
      z.string().parse(messageId),
      heldDecisionSchema.parse(decision),
      date.parse(today),
    );
    // A new assignment shows on the "Assigned by you" board.
    if (result.assigned) refresh();
    return result;
  });
}

const emailDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    subject: z.string().trim().min(1, "Add a subject.").max(200),
    body: z.string().trim().min(1, "The message is empty.").max(5000),
  }),
  z.object({ action: z.literal("cancel") }),
]);

/**
 * "Send" or "Cancel" in the review popup for a message to whoever assigned a
 * task ("I can't finish this on time because…"). Send uses the text as the
 * user left it after reviewing.
 */
export async function decideEmail(
  messageId: string,
  decision: z.input<typeof emailDecisionSchema>,
) {
  return authed(async (user) => {
    const result = await resolveEmail(
      user,
      z.string().parse(messageId),
      emailDecisionSchema.parse(decision),
    );
    // The reason now shows on the task in Shared Tasks.
    if (result.emailStatus === "sent") refresh();
    return result;
  });
}

export async function openChat(sessionId: string) {
  return authed(() => getChatMessages(z.string().parse(sessionId)));
}

/**
 * Deletes a chat and its messages. Tasks and calendar blocks from plans that
 * were confirmed in it are kept: they belong to the user, not the chat.
 */
export async function deleteChat(sessionId: string) {
  return authed(async (user) => {
    const deleted = await db
      .delete(schema.chatSessions)
      .where(
        and(
          eq(schema.chatSessions.id, z.string().parse(sessionId)),
          eq(schema.chatSessions.userId, user.id),
        ),
      )
      .returning({ id: schema.chatSessions.id });
    if (deleted.length === 0) throw new HttpError(404, "Chat not found.");
  });
}

// --- Calendar --------------------------------------------------------------------

const dateTime = z.string().refine(isDateTime, "Invalid date-time.");
const moveSchema = z
  .object({ id: z.string(), start: dateTime, end: dateTime })
  .refine((body) => body.start < body.end, "A block must end after it starts.");

export async function moveBlock(input: z.input<typeof moveSchema>) {
  return authed(async (user) => {
    const { id, start, end } = moveSchema.parse(input);
    const updated = await db
      .update(schema.blocks)
      .set({ start, end })
      .where(and(eq(schema.blocks.id, id), eq(schema.blocks.userId, user.id)))
      .returning({ id: schema.blocks.id });
    if (updated.length === 0) throw new HttpError(404, "Block not found.");
    refresh();
  });
}

/** Tick or untick a session; its task's status follows (see lib/tasks.ts). */
export async function toggleBlock(id: string, completed: boolean) {
  return authed(async (user) => {
    await setBlockCompleted(user.id, z.string().parse(id), z.boolean().parse(completed));
    refresh();
  });
}

// --- Notifications -----------------------------------------------------------------

/**
 * New notices for the signed-in user (deadline reminders, completed tasks),
 * each returned once. `today` is the browser's local date, so "due tomorrow"
 * matches the user's own calendar.
 */
export async function pullNotifications(today: string) {
  return authed((user) => takeNotifications(user.id, date.parse(today)));
}
