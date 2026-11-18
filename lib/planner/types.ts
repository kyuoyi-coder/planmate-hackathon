import { z } from "zod";
import { isDate } from "@/lib/time";

export const CATEGORIES = [
  "work",
  "study",
  "personal",
  "exercise",
  "rest",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Categories that count against the daily focused-work limit. */
export const isFocusWork = (category: Category) =>
  category === "work" || category === "study";

// The model's output is parsed leniently: a small local model will get details
// wrong, so anything recoverable is coerced to a sensible default rather than
// rejected.
const optionalDate = z
  .unknown()
  .transform((value) => (isDate(value) ? value : undefined));

const hours = z.coerce.number().positive().max(100);

const stepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  hours,
});

const itemSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const item = raw as Record<string, unknown>;
    // Accept `{ title, hours }` with no steps as a single-session item.
    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      return {
        ...item,
        steps: [{ title: item.title, hours: item.hours ?? 1 }],
      };
    }
    return item;
  },
  z.object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(CATEGORIES).catch("work"),
    priority: z.enum(PRIORITIES).catch("medium"),
    dueDate: optionalDate,
    notes: z.string().max(1000).optional().catch(undefined),
    steps: z.array(stepSchema).min(1).max(60),
  }),
);

const constraintsSchema = z
  .object({
    maxHoursPerDay: z.coerce.number().positive().max(16).optional().catch(undefined),
    daysOff: z
      .array(z.unknown())
      .transform((days) => days.filter(isDate))
      .optional()
      .catch(undefined),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .catch({ startDate: undefined, endDate: undefined });

export const planIntentSchema = z.object({
  items: z.array(itemSchema).min(1).max(40),
  constraints: constraintsSchema.optional(),
});

/** What the model wants scheduled. The scheduler turns this into time blocks. */
export type PlanIntent = z.infer<typeof planIntentSchema>;
export type PlanItem = PlanIntent["items"][number];

export const TASK_STATUSES = ["not-started", "ongoing", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_SYNONYMS: Record<string, TaskStatus> = {
  done: "completed",
  complete: "completed",
  finished: "completed",
  "in progress": "ongoing",
  "in-progress": "ongoing",
  started: "ongoing",
  todo: "not-started",
  "to do": "not-started",
  "not started": "not-started",
};

export const taskUpdatesSchema = z
  .array(
    z.object({
      task: z.coerce.string().trim().min(1),
      status: z.preprocess((value) => {
        const text = String(value).trim().toLowerCase();
        return STATUS_SYNONYMS[text] ?? text;
      }, z.enum(TASK_STATUSES)),
    }),
  )
  .min(1)
  .max(40);

export type TaskUpdate = z.infer<typeof taskUpdatesSchema>[number];

/** "Tell my leader I can't finish T2 because…": which task, and why. */
export const emailRequestSchema = z.object({
  task: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(1000),
});
export type EmailRequest = z.infer<typeof emailRequestSchema>;

// One removal names either a whole task ("T2") or one of its sessions ("S5").
export const removalsSchema = z
  .array(
    z
      .object({
        task: z.coerce.string().trim().min(1).optional(),
        session: z.coerce.string().trim().min(1).optional(),
      })
      .refine((removal) => removal.task || removal.session),
  )
  .min(1)
  .max(40);

export type Removal = z.infer<typeof removalsSchema>[number];

export const assignmentsSchema = z
  .array(
    z.object({
      assignee: z.coerce.string().trim().min(1),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).catch(""),
      priority: z.enum(PRIORITIES).catch("medium"),
      dueDate: optionalDate,
    }),
  )
  .min(1)
  .max(20);

export type Assignment = z.infer<typeof assignmentsSchema>[number];

export const modelOutputSchema = z.object({
  action: z
    .enum([
      "ask",
      "propose",
      "confirm",
      "cancel",
      "update",
      "assign",
      "remove",
      "email",
      "chat",
    ])
    .catch("chat"),
  reply: z.string().catch(""),
  plan: z.unknown().optional(),
  /** For "propose": true when the plan is a revision of the current plan. */
  revise: z.boolean().catch(false).optional(),
  taskUpdates: z.unknown().optional(),
  assignments: z.unknown().optional(),
  removals: z.unknown().optional(),
  email: z.unknown().optional(),
});

/**
 * One turn from the planning model.
 *  - ask:     needs more information before it can plan
 *  - propose: a new plan, or a revision of the current one; it goes straight
 *             onto the calendar, replacing the current plan
 *  - confirm: the user approved a held assignment (or is happy with the plan)
 *  - cancel:  the user dropped a held assignment, or wants the current plan undone
 *  - update:  change the status of existing tasks
 *  - assign:  give new tasks to teammates
 *  - remove:  delete existing tasks and their calendar sessions
 *  - email:   draft a message to whoever assigned a task, saying the user
 *             can't finish it on time and why; sent after the user reviews it
 *  - chat:    ordinary conversation, no plan change
 */
export type ModelOutput = {
  action:
    | "ask"
    | "propose"
    | "confirm"
    | "cancel"
    | "update"
    | "assign"
    | "remove"
    | "email"
    | "chat";
  reply: string;
  plan?: PlanIntent;
  /**
   * With "propose": the plan is a revision of the current plan and replaces
   * it. Otherwise a new plan is added alongside whatever is on the calendar.
   */
  revise?: boolean;
  taskUpdates?: TaskUpdate[];
  assignments?: Assignment[];
  removals?: Removal[];
  email?: EmailRequest;
};

export type ProposedBlock = {
  itemIndex: number;
  title: string;
  start: string;
  end: string;
  category: Category;
};

export type ProposalDay = {
  date: string;
  /** Focused work this plan adds to the day. */
  plannedMinutes: number;
  /** Focused work already on the calendar that day. */
  existingMinutes: number;
};

/** A scheduled plan. It is put on the calendar as soon as it is made. */
export type Proposal = {
  intent: PlanIntent;
  blocks: ProposedBlock[];
  days: ProposalDay[];
  warnings: string[];
  dailyLimitMinutes: number;
  totalMinutes: number;
  /** The tasks this plan created, so a revision or undo can replace them. */
  taskIds?: string[];
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type PlannerContext = {
  /** The user's local wall-clock time, "YYYY-MM-DDTHH:mm". */
  now: string;
  /**
   * Time phrases in the user's latest message resolved to exact dates
   * (lib/planner/dates.ts), so the model does not have to work them out.
   */
  userDates?: string[];
  userName: string;
  prefs: { dayStart: number; dayEnd: number; maxWorkMinutes: number };
  /** The user's tasks. `ref` ("T1", "T2", …) is how the model points at one. */
  tasks: {
    ref: string;
    title: string;
    dueDate: string;
    priority: Priority;
    status: TaskStatus;
    assignedBy?: string;
    /**
     * The task's sessions on the calendar, in time order. `ref` ("S1", "S2",
     * …) is how the model points at one. Empty for a task with nothing planned.
     */
    sessions: {
      ref: string;
      title: string;
      /** "YYYY-MM-DD" */
      date: string;
      /** "HH:mm" */
      start: string;
      end: string;
      completed: boolean;
    }[];
  }[];
  /**
   * Teammates this user's role allows them to assign tasks to. Empty for a
   * member. `ref` ("M1", "M2", …) is how the model points at one.
   */
  teammates: { ref: string; name: string; role: string }[];
  /**
   * The plan from this chat that is on the calendar and can still be changed
   * as a whole (the user hasn't started on it). A "propose" replaces it.
   */
  currentPlan?: PlanIntent;
  /**
   * Assignments the app is holding because the assignee looks overloaded.
   * The user has been shown the warning and has not decided yet.
   */
  /** A message to an assigner the user hasn't sent or cancelled yet. */
  pendingEmail?: { task: string; to: string };
  heldAssignments?: {
    assignee: string;
    title: string;
    dueDate: string;
    priority: Priority;
  }[];
};

/** What the burnout check found about one person for one period. */
export type WorkloadCheck = {
  /** The period checked: today to the task's due date. */
  from: string;
  to: string;
  plannedMinutes: number;
  capacityMinutes: number;
  limitMinutes: number;
  days: { date: string; minutes: number }[];
  /** Why they count as overloaded. Empty when they have room. */
  reasons: string[];
  /** Unfinished tasks already due in the period… */
  openTasks: number;
  /** …and how many of those have no time planned on the calendar yet. */
  unscheduledTasks: number;
  /** Teammates with room in the same period, lightest first. */
  alternatives: { id?: string; name: string; plannedMinutes: number }[];
  /** The first later day on which the assignee has room. */
  laterDay?: { date: string; minutes: number };
};

/** An assignment held for the assigner's decision. */
export type HeldAssignment = {
  assigneeId: string;
  assigneeName: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  workload: WorkloadCheck;
};

export type AssignmentStatus = "pending" | "assigned" | "cancelled" | "superseded";

/** What the assigner chose in the workload popup. */
export type HeldDecision =
  | { action: "confirm" }
  | { action: "cancel" }
  /** Give held assignment `index` to someone else. */
  | { action: "reassign"; index: number; assigneeId: string }
  /** Keep the person, move held assignment `index` to a new due date. */
  | { action: "reschedule"; index: number; dueDate: string };

/** A message to the person who assigned a task, waiting for the user's review. */
export type EmailDraft = {
  taskId: string;
  taskTitle: string;
  dueDate: string;
  /** The assigner. */
  toId: string;
  toName: string;
  toEmail: string;
  subject: string;
  body: string;
  /** The reason in the user's words, shown on the assigner's board. */
  reason: string;
};

export type EmailStatus = "pending" | "sent" | "cancelled" | "superseded";
