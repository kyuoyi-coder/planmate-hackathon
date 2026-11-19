import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { EmailDraft, HeldAssignment, Proposal } from "@/lib/planner/types";
import { ROLES } from "@/lib/roles";

/**
 * Calendar dates and times are stored as "floating" local strings, with no
 * timezone:
 *   date      -> "YYYY-MM-DD"
 *   date-time -> "YYYY-MM-DDTHH:mm"
 * The browser sends its own local "now" with each planning request, so the
 * schedule always matches the clock the user is looking at. Record-keeping
 * columns (created_at, expires_at) are real timestamps.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * There is no sign-up: accounts are created by the team owner with
 * `npm run user:add` (scripts/add-user.ts).
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Decides who this user may assign tasks to. See lib/roles.ts. */
  role: text("role", { enum: ROLES }).notNull().default("member"),
  /** Preferred working window, minutes from midnight. */
  dayStart: integer("day_start").notNull().default(9 * 60),
  dayEnd: integer("day_end").notNull().default(18 * 60),
  /** Most focused work the planner may schedule in one day. */
  maxWorkMinutes: integer("max_work_minutes").notNull().default(6 * 60),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie token, so a leaked database can't be replayed. */
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    /** The person who has to do the task. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Set when a teammate assigned it; null for the user's own tasks. */
    assignedById: text("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    project: text("project").notNull().default("Personal"),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: ["not-started", "ongoing", "completed"] })
      .notNull()
      .default("not-started"),
    priority: text("priority", { enum: ["critical", "high", "medium", "low"] })
      .notNull()
      .default("medium"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    /**
     * Set when the assignee told the assigner they can't finish by the due
     * date (see lib/email.ts), so the assigner's board can show it.
     */
    cannotFinishReason: text("cannot_finish_reason"),
    createdAt: createdAt(),
  },
  (table) => [index("tasks_user_idx").on(table.userId)],
);

export const blocks = pgTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    category: text("category", {
      enum: ["work", "study", "personal", "exercise", "rest"],
    })
      .notNull()
      .default("work"),
    /** Ticked off on the calendar. Drives the task's status: see lib/tasks.ts. */
    completed: boolean("completed").notNull().default(false),
    /**
     * A fixed event the user told the agent about ("a meeting every Friday at
     * 2pm"): every copy of it shares this id, so it can be removed as one.
     * Null for planned work sessions.
     */
    seriesId: text("series_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("blocks_user_start_idx").on(table.userId, table.start),
    index("blocks_series_idx").on(table.seriesId),
  ],
);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("chat_sessions_user_idx").on(table.userId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** The scheduled plan, when the assistant proposed one. */
    plan: jsonb("plan").$type<Proposal>(),
    planStatus: text("plan_status", {
      enum: ["draft", "confirmed", "superseded", "discarded"],
    }),
    /**
     * Assignments held by the burnout check, waiting for the assigner to
     * decide. See lib/workload.ts.
     */
    assignments: jsonb("assignments").$type<HeldAssignment[]>(),
    assignmentStatus: text("assignment_status", {
      enum: ["pending", "assigned", "cancelled", "superseded"],
    }),
    /**
     * A message to the assigner ("I can't finish this on time because…"),
     * drafted by the assistant and sent only after the user reviews it.
     */
    email: jsonb("email").$type<EmailDraft>(),
    emailStatus: text("email_status", {
      enum: ["pending", "sent", "cancelled", "superseded"],
    }),
    createdAt: createdAt(),
  },
  (table) => [index("chat_messages_session_idx").on(table.sessionId)],
);

/**
 * In-app notices, shown as toasts (see components/notification-toaster.tsx):
 *  - "due-tomorrow": to the assignee, the day before a teammate-assigned task is due
 *  - "task-completed": to the assigner, when the assignee completes that task
 *  - "cannot-finish": to the assigner, when the assignee says they can't make the deadline
 * One row per person, kind and task, so a notice is never repeated by accident.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    /** Who sees it. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["due-tomorrow", "task-completed", "cannot-finish"],
    }).notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    createdAt: createdAt(),
    /** When it was shown; null until then. */
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notifications_user_kind_task_idx").on(
      table.userId,
      table.kind,
      table.taskId,
    ),
  ],
);
