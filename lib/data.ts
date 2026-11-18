import "server-only";
import { aliasedTable, and, asc, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { countOpenSharedTasks } from "@/lib/notifications";
import { addDays, minutesOf, startOfWeek, toNaive } from "@/lib/time";

/**
 * The data access layer: every read the pages make goes through here.
 * Each function resolves the signed-in user itself, so a caller can never
 * ask for someone else's data by passing an id.
 */

export const TIMEZONE_COOKIE = "planmate_tz";

/**
 * Today's date on the user's own clock. The browser stores its timezone in a
 * cookie (see components/timezone-cookie.tsx); until it has, the server's
 * local date is used.
 */
export async function getToday() {
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE)?.value;
  // The current time is request-specific: wait for the request before reading it.
  await connection();
  const now = new Date();
  if (timeZone) {
    try {
      // en-CA formats dates as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
    } catch {
      // Not a timezone this runtime knows; fall through.
    }
  }
  return toNaive(now).slice(0, 10);
}

export async function getBlocks() {
  const user = await requireUser();
  return db
    .select({
      id: schema.blocks.id,
      title: schema.blocks.title,
      start: schema.blocks.start,
      end: schema.blocks.end,
      category: schema.blocks.category,
      completed: schema.blocks.completed,
      // From the block's task, so the calendar can highlight urgent work.
      priority: schema.tasks.priority,
    })
    .from(schema.blocks)
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.blocks.taskId))
    .where(eq(schema.blocks.userId, user.id))
    .orderBy(asc(schema.blocks.start));
}
export type BlockDto = Awaited<ReturnType<typeof getBlocks>>[number];

/** Every task the signed-in user has to do, including ones teammates assigned. */
export async function getTasks() {
  const user = await requireUser();
  const assigner = aliasedTable(schema.users, "assigner");
  return db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      description: schema.tasks.description,
      project: schema.tasks.project,
      dueDate: schema.tasks.dueDate,
      status: schema.tasks.status,
      priority: schema.tasks.priority,
      assignedBy: assigner.name,
      cannotFinishReason: schema.tasks.cannotFinishReason,
    })
    .from(schema.tasks)
    .leftJoin(assigner, eq(assigner.id, schema.tasks.assignedById))
    .where(eq(schema.tasks.userId, user.id))
    .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt));
}

/** Tasks the signed-in user assigned to teammates, so they can follow progress. */
export async function getTasksAssignedByMe() {
  const user = await requireUser();
  const assignee = aliasedTable(schema.users, "assignee");
  return db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      description: schema.tasks.description,
      project: schema.tasks.project,
      dueDate: schema.tasks.dueDate,
      status: schema.tasks.status,
      priority: schema.tasks.priority,
      assignedTo: assignee.name,
      cannotFinishReason: schema.tasks.cannotFinishReason,
    })
    .from(schema.tasks)
    .innerJoin(assignee, eq(assignee.id, schema.tasks.userId))
    .where(
      and(
        eq(schema.tasks.assignedById, user.id),
        ne(schema.tasks.userId, user.id),
      ),
    )
    .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt));
}

/** The signed-in user's unfinished tasks from teammates (sidebar badge). */
export async function getOpenSharedTaskCount() {
  const user = await requireUser();
  return countOpenSharedTasks(user.id, await getToday());
}

/** Everyone with an account in this workspace. */
export async function getMembers() {
  const user = await requireUser();
  const members = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
    })
    .from(schema.users)
    .orderBy(asc(schema.users.createdAt));
  return members.map((member) => ({ ...member, isYou: member.id === user.id }));
}

export async function getChatSessions() {
  const user = await requireUser();
  return db
    .select({
      id: schema.chatSessions.id,
      title: schema.chatSessions.title,
      preview: sql<string | null>`(
        select m.content from chat_messages m
        where m.session_id = "chat_sessions"."id"
        order by m.created_at desc limit 1
      )`,
    })
    .from(schema.chatSessions)
    .where(eq(schema.chatSessions.userId, user.id))
    .orderBy(desc(schema.chatSessions.updatedAt))
    .limit(50);
}
export type ChatSessionDto = Awaited<ReturnType<typeof getChatSessions>>[number];

export async function getChatMessages(sessionId: string) {
  const user = await requireUser();
  const [session] = await db
    .select({ id: schema.chatSessions.id })
    .from(schema.chatSessions)
    .where(
      and(
        eq(schema.chatSessions.id, sessionId),
        eq(schema.chatSessions.userId, user.id),
      ),
    );
  if (!session) throw new HttpError(404, "Chat not found.");

  const messages = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      plan: schema.chatMessages.plan,
      planStatus: schema.chatMessages.planStatus,
      assignments: schema.chatMessages.assignments,
      assignmentStatus: schema.chatMessages.assignmentStatus,
      email: schema.chatMessages.email,
      emailStatus: schema.chatMessages.emailStatus,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .orderBy(asc(schema.chatMessages.createdAt));
  return messages;
}
export type ChatMessageDto = Awaited<ReturnType<typeof getChatMessages>>[number];

// --- Reports -----------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Metrics = {
  workHours: number;
  personalHours: number;
  exerciseHours: number;
  restHours: number;
  unscheduledHours: number;
  overtimeHours: number;
  completedTasks: number;
  plannedTasks: number;
  boundaryChecksPassed: number;
  boundaryChecks: number;
  preferredHoursDays: number;
  observedDays: number;
};
export type ReportPoint = { period: string } & Metrics;

const emptyMetrics = (): Metrics => ({
  workHours: 0,
  personalHours: 0,
  exerciseHours: 0,
  restHours: 0,
  unscheduledHours: 0,
  overtimeHours: 0,
  completedTasks: 0,
  plannedTasks: 0,
  boundaryChecksPassed: 0,
  boundaryChecks: 0,
  preferredHoursDays: 0,
  observedDays: 0,
});

const roundMetrics = (metrics: Metrics) =>
  Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Math.round(value * 10) / 10]),
  ) as Metrics;

/** Work-life balance figures for the current week and month. */
export async function getReport() {
  const user = await requireUser();
  const today = await getToday();

  const weekStart = startOfWeek(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = today.split("-").map(Number);
  const monthEnd = addDays(
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`,
    -1,
  );
  const weekEnd = addDays(weekStart, 6);
  const rangeStart = weekStart < monthStart ? weekStart : monthStart;
  const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd;

  const [blocks, tasks] = await Promise.all([
    db
      .select({
        start: schema.blocks.start,
        end: schema.blocks.end,
        category: schema.blocks.category,
      })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.userId, user.id),
          gte(schema.blocks.end, `${rangeStart}T00:00`),
          lt(schema.blocks.start, `${addDays(rangeEnd, 1)}T00:00`),
        ),
      ),
    db
      .select({ dueDate: schema.tasks.dueDate, status: schema.tasks.status })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.userId, user.id),
          gte(schema.tasks.dueDate, rangeStart),
          lt(schema.tasks.dueDate, addDays(rangeEnd, 1)),
        ),
      ),
  ]);

  const windowMinutes = user.dayEnd - user.dayStart;

  const metricsForDay = (date: string): Metrics => {
    const dayStart = `${date}T00:00`;
    const nextDay = `${addDays(date, 1)}T00:00`;
    const minutes = { focus: 0, personal: 0, exercise: 0, rest: 0 };
    let focusOutsideHours = 0;
    let scheduledInWindow = 0;

    for (const block of blocks) {
      if (block.end <= dayStart || block.start >= nextDay) continue;
      const start = block.start <= dayStart ? 0 : minutesOf(block.start);
      const end = block.end >= nextDay ? 24 * 60 : minutesOf(block.end);
      const inWindow = Math.max(
        0,
        Math.min(end, user.dayEnd) - Math.max(start, user.dayStart),
      );
      scheduledInWindow += inWindow;

      if (block.category === "work" || block.category === "study") {
        minutes.focus += end - start;
        focusOutsideHours += end - start - inWindow;
      } else {
        minutes[block.category] += end - start;
      }
    }

    const overLimit = Math.max(0, minutes.focus - user.maxWorkMinutes);
    const dueToday = tasks.filter((task) => task.dueDate === date);

    return {
      workHours: minutes.focus / 60,
      personalHours: minutes.personal / 60,
      exerciseHours: minutes.exercise / 60,
      restHours: minutes.rest / 60,
      // Free time left inside the user's working hours.
      unscheduledHours: Math.max(0, windowMinutes - scheduledInWindow) / 60,
      overtimeHours: Math.max(overLimit, focusOutsideHours) / 60,
      completedTasks: dueToday.filter((task) => task.status === "completed").length,
      plannedTasks: dueToday.length,
      // Two checks a day: within the daily limit, and within preferred hours.
      boundaryChecksPassed:
        (overLimit === 0 ? 1 : 0) + (focusOutsideHours === 0 ? 1 : 0),
      boundaryChecks: 2,
      preferredHoursDays: focusOutsideHours === 0 ? 1 : 0,
      observedDays: 1,
    };
  };

  const weekly: ReportPoint[] = DAY_LABELS.map((period, offset) => ({
    period,
    ...roundMetrics(metricsForDay(addDays(weekStart, offset))),
  }));

  const monthly: ReportPoint[] = [];
  for (
    let start = monthStart, week = 1;
    start <= monthEnd;
    start = addDays(start, 7), week++
  ) {
    const total = emptyMetrics();
    for (
      let date = start;
      date <= monthEnd && date < addDays(start, 7);
      date = addDays(date, 1)
    ) {
      const day = metricsForDay(date);
      for (const key of Object.keys(total) as (keyof Metrics)[]) {
        total[key] += day[key];
      }
    }
    monthly.push({ period: `Week ${week}`, ...roundMetrics(total) });
  }

  return { weekly, monthly };
}
