import "server-only";
import { randomUUID } from "node:crypto";
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { canAssignTo, ROLE_LABEL } from "@/lib/roles";
import { removeSession, setTaskStatus } from "@/lib/tasks";
import { addDays, dateOf, formatDuration, minutesOf } from "@/lib/time";
import { checkWorkload, formatDay } from "@/lib/workload";
import { composeCannotFinishEmail } from "@/lib/email";
import type { Tx } from "@/lib/notifications";
import { ModelError, runPlanner } from "./provider";
import { buildProposal } from "./scheduler";
import type {
  AssignmentStatus,
  Category,
  ChatTurn,
  EmailDraft,
  EmailStatus,
  HeldAssignment,
  HeldDecision,
  ModelOutput,
  Proposal,
  TaskStatus,
} from "./types";

/**
 * "confirmed" means on the calendar. "draft" is only found on messages from
 * before plans were added straight away.
 */
type PlanStatus = "draft" | "confirmed" | "superseded" | "discarded";

const HISTORY_LIMIT = 30;

const PROJECT_LABEL: Record<Category, string> = {
  work: "Work",
  study: "Study",
  personal: "Personal",
  exercise: "Exercise",
  rest: "Rest",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  "not-started": "not started",
  ongoing: "ongoing",
  completed: "completed",
};

type MessageRow = typeof schema.chatMessages.$inferSelect;

export const toMessageDto = (message: MessageRow) => ({
  id: message.id,
  role: message.role,
  content: message.content,
  plan: message.plan,
  planStatus: message.planStatus,
  assignments: message.assignments,
  assignmentStatus: message.assignmentStatus,
  email: message.email,
  emailStatus: message.emailStatus,
});

async function findSession(userId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.chatSessions)
    .where(
      and(
        eq(schema.chatSessions.id, sessionId),
        eq(schema.chatSessions.userId, userId),
      ),
    );
  if (!session) throw new HttpError(404, "Chat not found.");
  return session;
}

/**
 * Plans go straight onto the calendar (planStatus "confirmed"). The latest
 * plan in a chat stays "current" until the user starts on it: while none of
 * its tasks has moved past "not started", a revision replaces it and "undo"
 * takes it off. After that its tasks are the user's progress and are kept.
 */
async function isUntouched(plan: Proposal | null) {
  const ids = plan?.taskIds ?? [];
  if (ids.length === 0) return false;
  const [row] = await db
    .select({ started: count() })
    .from(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.id, ids),
        ne(schema.tasks.status, "not-started"),
      ),
    );
  return row.started === 0;
}

async function findCurrentPlan(sessionId: string) {
  const [latest] = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.sessionId, sessionId),
        eq(schema.chatMessages.planStatus, "confirmed"),
      ),
    )
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(1);
  return latest && (await isUntouched(latest.plan)) ? latest : undefined;
}

/** Deletes the tasks (and so the sessions) a plan created, unless started since. */
async function removePlanTasks(tx: Tx, userId: string, plan: Proposal) {
  const ids = plan.taskIds ?? [];
  if (ids.length === 0) return;
  await tx
    .delete(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.id, ids),
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, "not-started"),
      ),
    );
}

/** Takes a plan off the calendar, if it is still the user's untouched plan. */
async function undoPlan(userId: string, message: MessageRow) {
  if (message.planStatus !== "confirmed" || !(await isUntouched(message.plan))) {
    throw new HttpError(
      409,
      "You've already started on this plan, so I've kept it. Tell me which tasks or sessions to remove instead.",
    );
  }
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.chatMessages)
      .set({ planStatus: "discarded" })
      .where(
        and(
          eq(schema.chatMessages.id, message.id),
          eq(schema.chatMessages.planStatus, "confirmed"),
        ),
      )
      .returning({ id: schema.chatMessages.id });
    if (claimed.length === 0) throw new HttpError(409, "That plan has already changed.");
    await removePlanTasks(tx, userId, message.plan!);
  });
  return "Done, I took that plan off your calendar and Planning board. Tell me what you'd like instead whenever you're ready.";
}

/** The latest message to an assigner in this chat that hasn't been sent or cancelled. */
async function findPendingEmail(sessionId: string) {
  const [message] = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.sessionId, sessionId),
        eq(schema.chatMessages.emailStatus, "pending"),
      ),
    )
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(1);
  return message;
}

/**
 * Sends a reviewed message to the person who assigned a task, inside
 * PlanMate: they get a notification, and the task is marked so their board
 * shows the reason. The email itself goes from the user's own email app via
 * a mailto: link (the popup's Send opens it; the chat card offers it too).
 *
 * @param openedInMailApp whether "Send" in the popup has just opened it.
 */
async function sendPendingEmail(
  user: CurrentUser,
  message: MessageRow,
  openedInMailApp: boolean,
  edits?: { subject: string; body: string },
) {
  const draft = message.email;
  if (!draft) throw new HttpError(400, "This message has no email.");
  const final = { ...draft, ...edits };

  await db.transaction(async (tx) => {
    // Claim it first, so a double click can't send it twice.
    const claimed = await tx
      .update(schema.chatMessages)
      .set({ emailStatus: "sent", email: final })
      .where(
        and(
          eq(schema.chatMessages.id, message.id),
          eq(schema.chatMessages.emailStatus, "pending"),
        ),
      )
      .returning({ id: schema.chatMessages.id });
    if (claimed.length === 0) {
      throw new HttpError(409, "This message has already been sent or cancelled.");
    }
    await tx
      .update(schema.tasks)
      .set({ cannotFinishReason: final.reason })
      .where(and(eq(schema.tasks.id, final.taskId), eq(schema.tasks.userId, user.id)));
    const notice = `${user.name} can't finish "${final.taskTitle}" by ${formatDay(final.dueDate)}. Reason: ${final.reason}`;
    await tx
      .insert(schema.notifications)
      .values({
        id: randomUUID(),
        userId: final.toId,
        kind: "cannot-finish",
        taskId: final.taskId,
        message: notice,
      })
      .onConflictDoUpdate({
        target: [
          schema.notifications.userId,
          schema.notifications.kind,
          schema.notifications.taskId,
        ],
        set: { message: notice, createdAt: sql`now()`, seenAt: null },
      });
  });

  const inApp = `${final.toName} has been told in PlanMate: they'll get a notification, and their board shows the reason.`;
  return openedInMailApp
    ? `${inApp} I've also opened the email in your email app. Press Send there so it reaches their inbox too.`
    : `${inApp} To email it as well, use "Open in email app" on the message above.`;
}

async function findHeldAssignments(sessionId: string) {
  const [held] = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.sessionId, sessionId),
        eq(schema.chatMessages.assignmentStatus, "pending"),
      ),
    )
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(1);
  return held;
}

const settleAssignments = (messageId: string, status: AssignmentStatus) =>
  db
    .update(schema.chatMessages)
    .set({ assignmentStatus: status })
    .where(
      and(
        eq(schema.chatMessages.id, messageId),
        eq(schema.chatMessages.assignmentStatus, "pending"),
      ),
    )
    .returning({ id: schema.chatMessages.id });

async function createAssignedTask(
  assignerId: string,
  assignment: Pick<
    HeldAssignment,
    "assigneeId" | "title" | "description" | "priority" | "dueDate"
  >,
) {
  await db.insert(schema.tasks).values({
    id: randomUUID(),
    userId: assignment.assigneeId,
    assignedById: assignerId,
    title: assignment.title,
    description: assignment.description,
    project: "Team",
    dueDate: assignment.dueDate,
    priority: assignment.priority,
  });
}

/**
 * The assigner decided to go ahead despite the workload warning. The held
 * assignments are created exactly as they were shown.
 */
async function commitHeldAssignments(assigner: CurrentUser, message: MessageRow) {
  const claimed = await settleAssignments(message.id, "assigned");
  if (claimed.length === 0) {
    throw new HttpError(409, "This assignment is no longer waiting for a decision.");
  }
  const held = message.assignments ?? [];
  for (const assignment of held) {
    // Roles may have changed since the warning was shown.
    const [assignee] = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, assignment.assigneeId));
    if (!assignee || !canAssignTo(assigner.role, assignee.role)) {
      throw new HttpError(403, `You can no longer assign tasks to ${assignment.assigneeName}.`);
    }
    await createAssignedTask(assigner.id, assignment);
  }
  return `Done, I assigned ${held.map((assignment) => `"${assignment.title}" to ${assignment.assigneeName} (due ${formatDay(assignment.dueDate)})`).join(", ")} as you asked. It's worth letting them know it's on top of an already full plate.`;
}

/**
 * The chat message that goes with a held assignment. The details (reasons,
 * chart, alternatives) are in the popup the assigner sees; this is the
 * plain-text version, which also works when replying in words.
 */
function describeHeld(held: HeldAssignment) {
  const { workload } = held;
  const first = held.assigneeName.split(" ")[0];
  const lines = [
    `⚠️ ${held.assigneeName} already looks overloaded, so I haven't assigned "${held.title}" (due ${formatDay(held.dueDate)}) yet.`,
    ...workload.reasons.map((reason) => `• ${reason}`),
  ];
  if (workload.unscheduledTasks > 0) {
    lines.push(
      `• ${workload.unscheduledTasks} of their tasks due in that period ${workload.unscheduledTasks === 1 ? "isn't" : "aren't"} on their calendar yet, so the real load is higher`,
    );
  }
  const options = [
    workload.alternatives.length
      ? `give it to ${workload.alternatives.map((person) => person.name).join(" or ")}`
      : undefined,
    workload.laterDay
      ? `move the deadline to ${formatDay(workload.laterDay.date)}`
      : "move the deadline",
    `assign it to ${first} anyway`,
  ].filter(Boolean);
  lines.push(
    "",
    `To help them avoid burning out, you could ${options.join(", ")}. It's your call: choose in the popup, or just tell me.`,
  );
  return lines.join("\n");
}

/** Writes a plan to the user's tasks and calendar; returns the new task ids. */
async function writePlan(tx: Tx, userId: string, proposal: Proposal) {
  const taskIds: string[] = [];
  for (const [itemIndex, item] of proposal.intent.items.entries()) {
    const itemBlocks = proposal.blocks.filter(
      (block) => block.itemIndex === itemIndex,
    );
    if (itemBlocks.length === 0) continue;

    const taskId = randomUUID();
    taskIds.push(taskId);
    await tx.insert(schema.tasks).values({
      id: taskId,
      userId,
      title: item.title,
      description:
        item.notes ??
        (item.steps.length > 1
          ? item.steps.map((step) => step.title).join(" → ")
          : `Planned with PlanMate AI in ${itemBlocks.length} ${itemBlocks.length === 1 ? "session" : "sessions"}.`),
      project: PROJECT_LABEL[item.category],
      dueDate: item.dueDate ?? dateOf(itemBlocks.at(-1)!.end),
      priority: item.priority,
      estimatedMinutes: itemBlocks.reduce(
        (sum, block) => sum + minutesOf(block.end) - minutesOf(block.start),
        0,
      ),
    });
    await tx.insert(schema.blocks).values(
      itemBlocks.map((block) => ({
        id: randomUUID(),
        userId,
        taskId,
        title: block.title,
        start: block.start,
        end: block.end,
        category: block.category,
      })),
    );
  }
  return taskIds;
}

/** What the assistant says about a plan it just put on the calendar. */
function describePlan(proposal: Proposal) {
  const days = new Set(proposal.blocks.map((block) => dateOf(block.start)));
  return `I added ${proposal.blocks.length} ${proposal.blocks.length === 1 ? "session" : "sessions"} (${formatDuration(proposal.totalMinutes)}) across ${days.size} ${days.size === 1 ? "day" : "days"} to your calendar, and the tasks to your Planning board. Not quite right? Tell me what to change (for example "max 4 hours a day", "keep Sunday free" or "move it to next week"), or say "undo the plan".`;
}

async function addAssistantMessage(
  sessionId: string,
  content: string,
  plan?: Proposal,
  held?: HeldAssignment[],
  executor: Tx | typeof db = db,
  email?: EmailDraft,
) {
  const [message] = await executor
    .insert(schema.chatMessages)
    .values({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content,
      plan: plan ?? null,
      // A plan in a message is already on the calendar.
      planStatus: plan ? "confirmed" : null,
      assignments: held ?? null,
      assignmentStatus: held ? "pending" : null,
      email: email ?? null,
      emailStatus: email ? "pending" : null,
    })
    .returning();
  return message;
}

/**
 * One chat turn: stores the user's message, asks the planning model what to
 * do, and turns its answer into a reply, a scheduled draft, or a confirmed plan.
 */
export async function handleChatMessage(input: {
  user: CurrentUser;
  sessionId?: string;
  content: string;
  now: string;
}) {
  const { user, content, now } = input;

  const session = input.sessionId
    ? await findSession(user.id, input.sessionId)
    : (
        await db
          .insert(schema.chatSessions)
          .values({ id: randomUUID(), userId: user.id })
          .returning()
      )[0];

  const [userMessage] = await db
    .insert(schema.chatMessages)
    .values({ id: randomUUID(), sessionId: session.id, role: "user", content })
    .returning();

  const recent = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, session.id))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(HISTORY_LIMIT);
  const history: ChatTurn[] = recent
    .reverse()
    .map(({ role, content }) => ({ role, content }));

  const currentPlan = await findCurrentPlan(session.id);
  const heldMessage = await findHeldAssignments(session.id);
  const emailMessage = await findPendingEmail(session.id);
  const assigner = aliasedTable(schema.users, "assigner");
  // Unfinished tasks first, so they are the ones kept if the list is cut off.
  const tasks = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      priority: schema.tasks.priority,
      status: schema.tasks.status,
      assignedBy: assigner.name,
      assignedById: schema.tasks.assignedById,
    })
    .from(schema.tasks)
    .leftJoin(assigner, eq(assigner.id, schema.tasks.assignedById))
    .where(eq(schema.tasks.userId, user.id))
    .orderBy(
      sql`${schema.tasks.status} = 'completed'`,
      asc(schema.tasks.dueDate),
      asc(schema.tasks.createdAt),
    )
    .limit(40);
  const refOf = (index: number) => `T${index + 1}`;

  // Each task's calendar sessions, so the model can tell them apart by date
  // and remove a single one.
  const sessionRows = await db
    .select({
      id: schema.blocks.id,
      taskId: schema.blocks.taskId,
      title: schema.blocks.title,
      start: schema.blocks.start,
      end: schema.blocks.end,
      completed: schema.blocks.completed,
    })
    .from(schema.blocks)
    .where(eq(schema.blocks.userId, user.id))
    .orderBy(asc(schema.blocks.start));
  const taskIds = new Set(tasks.map((task) => task.id));
  const sessions = sessionRows
    .filter((row) => row.taskId && taskIds.has(row.taskId))
    .map((row, index) => ({ ...row, ref: `S${index + 1}` }));

  // Only the people this user's role may assign to are offered to the model.
  const teammates = (
    await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
      })
      .from(schema.users)
      .orderBy(asc(schema.users.name))
  ).filter(
    (member) => member.id !== user.id && canAssignTo(user.role, member.role),
  );
  const memberRefOf = (index: number) => `M${index + 1}`;

  const prefs = {
    dayStart: user.dayStart,
    dayEnd: user.dayEnd,
    maxWorkMinutes: user.maxWorkMinutes,
  };

  let output: ModelOutput;
  try {
    output = await runPlanner(history, {
      now,
      userName: user.name,
      prefs,
      tasks: tasks.map((task, index) => ({
        ref: refOf(index),
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        status: task.status,
        assignedBy: task.assignedBy ?? undefined,
        sessions: sessions
          .filter((session) => session.taskId === task.id)
          .map((session) => ({
            ref: session.ref,
            title: session.title,
            date: dateOf(session.start),
            start: session.start.slice(11),
            end: session.end.slice(11),
            completed: session.completed,
          })),
      })),
      teammates: teammates.map((member, index) => ({
        ref: memberRefOf(index),
        name: member.name,
        role: ROLE_LABEL[member.role],
      })),
      currentPlan: currentPlan?.plan?.intent,
      pendingEmail: emailMessage?.email
        ? { task: emailMessage.email.taskTitle, to: emailMessage.email.toName }
        : undefined,
      heldAssignments: heldMessage?.assignments?.map((held) => ({
        assignee: held.assigneeName,
        title: held.title,
        dueDate: held.dueDate,
        priority: held.priority,
      })),
    });
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    console.error(error);
    output = { action: "chat", reply: `⚠️ ${error.message}` };
  }

  let assistantMessage: MessageRow;
  let dataChanged = false;
  // What this turn did to a plan or assignment that was awaiting a decision,
  // so the chat can update the card it is showing.
  const settled: {
    plan?: PlanStatus;
    /** The plan message `plan` applies to. */
    planMessageId?: string;
    assignment?: AssignmentStatus;
    email?: EmailStatus;
  } = {};
  // "Yes" or "cancel" refers to whichever of these is the most recent.
  const deciding = [
    heldMessage && { kind: "assignment" as const, at: heldMessage.createdAt },
    emailMessage && { kind: "email" as const, at: emailMessage.createdAt },
    currentPlan && { kind: "plan" as const, at: currentPlan.createdAt },
  ]
    .filter((entry) => !!entry)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.kind;

  if (output.action === "propose" && output.plan) {
    // A revision replaces this chat's current plan; a new plan goes alongside.
    const replacing = output.revise ? currentPlan : undefined;
    const replacedTaskIds = new Set(replacing?.plan?.taskIds ?? []);
    const busy = (
      await db
        .select({
          start: schema.blocks.start,
          end: schema.blocks.end,
          category: schema.blocks.category,
          taskId: schema.blocks.taskId,
        })
        .from(schema.blocks)
        .where(
          and(
            eq(schema.blocks.userId, user.id),
            gte(schema.blocks.end, `${dateOf(now)}T00:00`),
          ),
        )
    ).filter((block) => !block.taskId || !replacedTaskIds.has(block.taskId));
    const proposal = buildProposal(output.plan, { now, prefs, busy });

    if (proposal.blocks.length === 0) {
      assistantMessage = await addAssistantMessage(
        session.id,
        `I couldn't fit that into your calendar, so nothing has changed. ${proposal.warnings.join(" ")}`,
      );
    } else {
      const note =
        output.revise && !replacing
          ? "You've already started on the earlier plan, so I kept it as it is and added this as a new plan.\n\n"
          : "";
      assistantMessage = await db.transaction(async (tx) => {
        if (replacing) {
          const claimed = await tx
            .update(schema.chatMessages)
            .set({ planStatus: "superseded" })
            .where(
              and(
                eq(schema.chatMessages.id, replacing.id),
                eq(schema.chatMessages.planStatus, "confirmed"),
              ),
            )
            .returning({ id: schema.chatMessages.id });
          if (claimed.length === 0) {
            throw new HttpError(409, "That plan changed in the meantime. Please try again.");
          }
          await removePlanTasks(tx, user.id, replacing.plan!);
        }
        const taskIds = await writePlan(tx, user.id, proposal);
        return addAssistantMessage(
          session.id,
          note + (output.reply || describePlan(proposal)),
          { ...proposal, taskIds },
          undefined,
          tx,
        );
      });
      dataChanged = true;
      if (replacing) {
        settled.plan = "superseded";
        settled.planMessageId = replacing.id;
      }
    }
  } else if (output.action === "update" && output.taskUpdates) {
    const changed: string[] = [];
    for (const update of output.taskUpdates) {
      const key = update.task.toLowerCase();
      const task =
        tasks.find((_, index) => refOf(index).toLowerCase() === key) ??
        tasks.find((candidate) => candidate.title.toLowerCase() === key);
      if (!task) continue;
      await setTaskStatus(user.id, task.id, update.status);
      changed.push(`${task.title} is now ${STATUS_LABEL[update.status]}`);
    }
    dataChanged = changed.length > 0;
    assistantMessage = await addAssistantMessage(
      session.id,
      changed.length === 0
        ? "I couldn't find that task on your board. Which one do you mean?"
        : output.reply || `Updated: ${changed.join(", ")}.`,
    );
  } else if (output.action === "assign" && output.assignments) {
    const today = dateOf(now);
    const assigned: string[] = [];
    const held: HeldAssignment[] = [];
    for (const assignment of output.assignments) {
      const key = assignment.assignee.toLowerCase();
      // `teammates` is already limited to who this role may assign to.
      const member =
        teammates.find((_, index) => memberRefOf(index).toLowerCase() === key) ??
        teammates.find((candidate) => candidate.name.toLowerCase() === key);
      if (!member) continue;

      const task = {
        assigneeId: member.id,
        assigneeName: member.name,
        title: assignment.title,
        description: assignment.description,
        priority: assignment.priority,
        dueDate: assignment.dueDate ?? addDays(today, 7),
      };
      // The burnout check: is this person already overloaded for the period
      // the task has to be done in? If so, hold it and let the assigner decide.
      const { overloaded, check } = await checkWorkload({
        assignee: member,
        others: teammates.filter((other) => other.id !== member.id),
        today,
        dueDate: task.dueDate,
        explicitDue: Boolean(assignment.dueDate),
      });
      if (overloaded) {
        held.push({ ...task, workload: check });
        continue;
      }
      await createAssignedTask(user.id, task);
      assigned.push(
        `"${task.title}" to ${member.name}, due ${formatDay(task.dueDate)} (they have ${check.plannedMinutes ? formatDuration(check.plannedMinutes) : "nothing"} planned until then)`,
      );
    }

    // A new request replaces whatever was being held before.
    if (heldMessage && (assigned.length || held.length)) {
      await settleAssignments(heldMessage.id, "superseded");
      settled.assignment = "superseded";
    }
    const done = assigned.length ? `Done, I assigned ${assigned.join(", ")}.` : "";
    assistantMessage = await addAssistantMessage(
      session.id,
      assigned.length === 0 && held.length === 0
        ? "I couldn't assign that: the person isn't someone your role can assign tasks to."
        : [done, ...held.map(describeHeld)].filter(Boolean).join("\n\n"),
      undefined,
      held.length ? held : undefined,
    );
  } else if (output.action === "remove" && output.removals) {
    const removed: string[] = [];
    const refused: string[] = [];
    for (const removal of output.removals) {
      // A single session: the task stays unless this was its last one.
      if (removal.session) {
        const sessionKey = removal.session.toLowerCase();
        const session = sessions.find(
          (candidate) => candidate.ref.toLowerCase() === sessionKey,
        );
        if (!session) continue;
        const result = await removeSession(user.id, session.id);
        removed.push(
          `${result.title} (${dateOf(session.start)})${result.taskRemoved ? ", which was its last session, so the task is gone too" : ""}`,
        );
        continue;
      }
      if (!removal.task) continue;
      const key = removal.task.toLowerCase();
      const task =
        tasks.find((_, index) => refOf(index).toLowerCase() === key) ??
        tasks.find((candidate) => candidate.title.toLowerCase() === key);
      if (!task) continue;
      // Whatever the model says, a task a teammate assigned is not the
      // user's to delete.
      if (task.assignedBy) {
        refused.push(`"${task.title}" (assigned by ${task.assignedBy})`);
        continue;
      }
      // Its calendar sessions go with it (blocks.task_id cascades).
      await db
        .delete(schema.tasks)
        .where(
          and(eq(schema.tasks.id, task.id), eq(schema.tasks.userId, user.id)),
        );
      removed.push(task.title);
    }
    dataChanged = removed.length > 0;
    const refusal = refused.length
      ? ` I can't remove ${refused.join(", ")}: ask the person who assigned it.`
      : "";
    assistantMessage = await addAssistantMessage(
      session.id,
      removed.length === 0
        ? refused.length
          ? refusal.trim()
          : "I couldn't find that task on your board. Which one do you mean?"
        : (output.reply ||
            `Removed ${removed.join(", ")}.`) + refusal,
    );
  } else if (output.action === "email" && output.email) {
    const key = output.email.task.toLowerCase();
    const task =
      tasks.find((_, index) => refOf(index).toLowerCase() === key) ??
      tasks.find((candidate) => candidate.title.toLowerCase() === key);
    if (!task) {
      assistantMessage = await addAssistantMessage(
        session.id,
        "I couldn't find that task on your board. Which one can't you finish?",
      );
    } else if (!task.assignedById || task.assignedById === user.id) {
      assistantMessage = await addAssistantMessage(
        session.id,
        `"${task.title}" is your own task, so there's nobody to tell. Want me to move it to a later date instead?`,
      );
    } else if (task.status === "completed") {
      assistantMessage = await addAssistantMessage(
        session.id,
        `"${task.title}" is already marked as completed, so there's nothing to report.`,
      );
    } else {
      const [assignerRow] = await db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, task.assignedById));
      const draft = composeCannotFinishEmail({
        senderName: user.name,
        task,
        to: assignerRow,
        reason: output.email.reason,
      });
      // A new draft replaces one that was never sent.
      if (emailMessage) {
        await db
          .update(schema.chatMessages)
          .set({ emailStatus: "superseded" })
          .where(
            and(
              eq(schema.chatMessages.id, emailMessage.id),
              eq(schema.chatMessages.emailStatus, "pending"),
            ),
          );
        settled.email = "superseded";
      }
      assistantMessage = await addAssistantMessage(
        session.id,
        `I've drafted a message to ${assignerRow.name} about "${task.title}". Review it in the popup, edit it if you like, then send or cancel. Nothing is sent until you say so.`,
        undefined,
        undefined,
        db,
        draft,
      );
    }
  } else if (output.action === "confirm" && deciding === "email" && emailMessage) {
    const reply = await sendPendingEmail(user, emailMessage, false);
    assistantMessage = await addAssistantMessage(session.id, reply);
    settled.email = "sent";
    dataChanged = true;
  } else if (output.action === "cancel" && deciding === "email" && emailMessage) {
    await db
      .update(schema.chatMessages)
      .set({ emailStatus: "cancelled" })
      .where(eq(schema.chatMessages.id, emailMessage.id));
    settled.email = "cancelled";
    assistantMessage = await addAssistantMessage(
      session.id,
      output.reply || "Okay, I didn't send it. Nothing was sent.",
    );
  } else if (output.action === "confirm" && deciding === "assignment" && heldMessage) {
    const reply = await commitHeldAssignments(user, heldMessage);
    assistantMessage = await addAssistantMessage(session.id, reply);
    settled.assignment = "assigned";
  } else if (output.action === "cancel" && deciding === "assignment" && heldMessage) {
    await settleAssignments(heldMessage.id, "cancelled");
    settled.assignment = "cancelled";
    assistantMessage = await addAssistantMessage(
      session.id,
      output.reply || "Okay, I haven't assigned it. Nothing was changed.",
    );
  } else if (output.action === "cancel" && deciding === "plan" && currentPlan) {
    // "Undo the plan": take this chat's current plan off the calendar.
    const reply = await undoPlan(user.id, currentPlan);
    settled.plan = "discarded";
    settled.planMessageId = currentPlan.id;
    dataChanged = true;
    assistantMessage = await addAssistantMessage(session.id, reply);
  } else {
    assistantMessage = await addAssistantMessage(
      session.id,
      output.reply ||
        (output.action === "confirm"
          ? "Great, it's already on your calendar. Tell me if you want to change anything."
          : "Could you tell me a bit more about what you need to get done?"),
    );
  }

  const title =
    session.title === "New chat" ? content.slice(0, 40) : session.title;
  await db
    .update(schema.chatSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(schema.chatSessions.id, session.id));

  return {
    session: { id: session.id, title },
    messages: [userMessage, assistantMessage].map(toMessageDto),
    dataChanged,
    settled,
  };
}

/** Loads a chat message, checking it belongs to one of the user's chats. */
async function findOwnMessage(user: CurrentUser, messageId: string, what: string) {
  const [row] = await db
    .select({ message: schema.chatMessages })
    .from(schema.chatMessages)
    .innerJoin(
      schema.chatSessions,
      eq(schema.chatSessions.id, schema.chatMessages.sessionId),
    )
    .where(
      and(
        eq(schema.chatMessages.id, messageId),
        eq(schema.chatSessions.userId, user.id),
      ),
    );
  if (!row) throw new HttpError(404, `${what} not found.`);
  return row.message;
}

/** The "Undo" button on a plan card: takes that plan off the calendar. */
export async function undoPlanFromCard(user: CurrentUser, messageId: string) {
  const message = await findOwnMessage(user, messageId, "Plan");
  const reply = await undoPlan(user.id, message);
  const assistantMessage = await addAssistantMessage(message.sessionId, reply);
  return {
    planStatus: "discarded" as const,
    message: toMessageDto(assistantMessage),
  };
}

/**
 * The assigner's decision on a held assignment: assign anyway, don't assign,
 * or change the person or the date. A change is checked again; if the new
 * choice also looks overloaded it is held again, with a new warning.
 */
export async function resolveHeldAssignments(
  user: CurrentUser,
  messageId: string,
  decision: HeldDecision,
  today: string,
) {
  const message = await findOwnMessage(user, messageId, "Assignment");
  if (message.assignmentStatus !== "pending") {
    throw new HttpError(409, "This assignment is no longer waiting for a decision.");
  }

  if (decision.action === "confirm" || decision.action === "cancel") {
    let reply: string;
    if (decision.action === "confirm") {
      reply = await commitHeldAssignments(user, message);
    } else {
      await settleAssignments(message.id, "cancelled");
      reply = "Okay, I haven't assigned it. Nothing was changed.";
    }
    const assistantMessage = await addAssistantMessage(message.sessionId, reply);
    return {
      assignmentStatus:
        decision.action === "confirm" ? ("assigned" as const) : ("cancelled" as const),
      message: toMessageDto(assistantMessage),
      assigned: decision.action === "confirm",
    };
  }

  const held = message.assignments ?? [];
  const item = held[decision.index];
  if (!item) throw new HttpError(400, "That assignment isn't in this warning.");

  // Only people this user's role may assign to, checked now (roles can change).
  const teammates = (
    await db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users)
      .orderBy(asc(schema.users.name))
  ).filter((member) => member.id !== user.id && canAssignTo(user.role, member.role));
  const assigneeId =
    decision.action === "reassign" ? decision.assigneeId : item.assigneeId;
  const assignee = teammates.find((member) => member.id === assigneeId);
  if (!assignee) throw new HttpError(403, "You can't assign tasks to that person.");
  const dueDate = decision.action === "reschedule" ? decision.dueDate : item.dueDate;
  if (dueDate < today) throw new HttpError(400, "Pick a due date from today on.");

  const next = { ...item, assigneeId: assignee.id, assigneeName: assignee.name, dueDate };
  const { overloaded, check } = await checkWorkload({
    assignee,
    others: teammates.filter((other) => other.id !== assignee.id),
    today,
    dueDate,
    explicitDue: true,
  });

  const claimed = await settleAssignments(message.id, "superseded");
  if (claimed.length === 0) {
    throw new HttpError(409, "This assignment is no longer waiting for a decision.");
  }
  const others = held.filter((_, index) => index !== decision.index);
  const stillHeld = overloaded ? [...others, { ...next, workload: check }] : others;
  const lines: string[] = [];
  if (!overloaded) {
    await createAssignedTask(user.id, next);
    lines.push(
      `Done, I assigned "${next.title}" to ${assignee.name}, due ${formatDay(dueDate)}. They have ${check.plannedMinutes ? formatDuration(check.plannedMinutes) : "nothing"} planned until then, so it fits.`,
    );
  }
  lines.push(...stillHeld.map(describeHeld));
  const assistantMessage = await addAssistantMessage(
    message.sessionId,
    lines.join("\n\n"),
    undefined,
    stillHeld.length ? stillHeld : undefined,
  );
  return {
    assignmentStatus: "superseded" as const,
    message: toMessageDto(assistantMessage),
    assigned: !overloaded,
  };
}

/** "Send" or "Cancel" in the email review popup. */
export async function resolveEmail(
  user: CurrentUser,
  messageId: string,
  decision: { action: "send"; subject: string; body: string } | { action: "cancel" },
) {
  const message = await findOwnMessage(user, messageId, "Message");
  if (message.emailStatus !== "pending") {
    throw new HttpError(409, "This message has already been sent or cancelled.");
  }
  let reply: string;
  if (decision.action === "send") {
    // The popup's Send button is a mailto: link, so the email app is open.
    reply = await sendPendingEmail(user, message, true, {
      subject: decision.subject,
      body: decision.body,
    });
  } else {
    await db
      .update(schema.chatMessages)
      .set({ emailStatus: "cancelled" })
      .where(eq(schema.chatMessages.id, message.id));
    reply = "Okay, I didn't send it. Nothing was sent.";
  }
  const assistantMessage = await addAssistantMessage(message.sessionId, reply);
  return {
    emailStatus: decision.action === "send" ? ("sent" as const) : ("cancelled" as const),
    message: toMessageDto(assistantMessage),
  };
}
