import "server-only";
import { and, gte, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { WorkloadCheck } from "@/lib/planner/types";
import {
  addDays,
  diffDays,
  formatDuration,
  minutesOf,
  weekdayName,
} from "@/lib/time";

/**
 * The burnout check behind task assignment.
 *
 * Before a task is assigned, the assignee's real calendar is checked for the
 * period the task would have to be done in (today to the due date). If they
 * already look overloaded, the assignment is held and the assigner is told
 * why, with lighter-loaded teammates and a later date as alternatives. It is
 * advice only: the assigner can still go ahead.
 *
 * Someone counts as overloaded when any of these is true:
 */
/** …planned focused work fills this share of their capacity for the period, */
const HEAVY_SHARE = 0.8;
/** …or the due date itself is this full, */
const FULL_DAY_SHARE = 0.8;
/** …or this many unfinished tasks are already due in the period, */
const MANY_TASKS = 6;
/** …or any day in the period is already over their daily limit. */

const MAX_WINDOW_DAYS = 28;
/** How far ahead to look for a lighter day to suggest. */
const LOOKAHEAD_DAYS = 14;
/** A day this empty is worth suggesting as a later deadline. */
const LIGHT_DAY_SHARE = 0.5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatDay = (date: string) =>
  `${weekdayName(date).slice(0, 3)} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

type Person = { id: string; name: string };

type Load = {
  limit: number;
  /** Focused minutes planned per date. */
  byDate: Map<string, number>;
  openTasks: { dueDate: string; scheduled: boolean }[];
};

async function loadFor(people: Person[], from: string, until: string) {
  const ids = people.map((person) => person.id);
  const loads = new Map<string, Load>();
  if (ids.length === 0) return loads;

  const [limits, blocks, tasks] = await Promise.all([
    db
      .select({ id: schema.users.id, limit: schema.users.maxWorkMinutes })
      .from(schema.users)
      .where(inArray(schema.users.id, ids)),
    db
      .select({
        userId: schema.blocks.userId,
        start: schema.blocks.start,
        end: schema.blocks.end,
      })
      .from(schema.blocks)
      .where(
        and(
          inArray(schema.blocks.userId, ids),
          inArray(schema.blocks.category, ["work", "study"]),
          gte(schema.blocks.start, `${from}T00:00`),
          lt(schema.blocks.start, `${addDays(until, 1)}T00:00`),
        ),
      ),
    db
      .select({
        userId: schema.tasks.userId,
        dueDate: schema.tasks.dueDate,
        estimatedMinutes: schema.tasks.estimatedMinutes,
      })
      .from(schema.tasks)
      .where(
        and(
          inArray(schema.tasks.userId, ids),
          ne(schema.tasks.status, "completed"),
          gte(schema.tasks.dueDate, from),
          lt(schema.tasks.dueDate, addDays(until, 1)),
        ),
      ),
  ]);

  for (const { id, limit } of limits) {
    loads.set(id, { limit, byDate: new Map(), openTasks: [] });
  }
  for (const block of blocks) {
    const load = loads.get(block.userId);
    if (!load) continue;
    const date = block.start.slice(0, 10);
    load.byDate.set(
      date,
      (load.byDate.get(date) ?? 0) + minutesOf(block.end) - minutesOf(block.start),
    );
  }
  for (const task of tasks) {
    loads.get(task.userId)?.openTasks.push({
      dueDate: task.dueDate,
      // A task with no planned time is work that isn't on the calendar yet.
      scheduled: task.estimatedMinutes > 0,
    });
  }
  return loads;
}

const datesBetween = (from: string, to: string) =>
  Array.from({ length: diffDays(from, to) + 1 }, (_, offset) => addDays(from, offset));

function reasonsFor(load: Load, from: string, to: string, dueDate?: string) {
  const dates = datesBetween(from, to);
  const planned = dates.reduce((sum, date) => sum + (load.byDate.get(date) ?? 0), 0);
  const capacity = dates.length * load.limit;
  const reasons: string[] = [];

  const overDays = dates.filter((date) => (load.byDate.get(date) ?? 0) > load.limit);
  if (overDays.length) {
    reasons.push(
      `already over their ${formatDuration(load.limit)} daily limit on ${overDays.map(formatDay).join(", ")}`,
    );
  }
  if (planned >= capacity * HEAVY_SHARE) {
    reasons.push(
      `${formatDuration(planned)} of focused work already planned ${from === to ? `on ${formatDay(from)}` : `from ${formatDay(from)} to ${formatDay(to)}`}, ${Math.round((planned / capacity) * 100)}% of what their daily limit allows`,
    );
  }
  const onDueDate = dueDate ? (load.byDate.get(dueDate) ?? 0) : 0;
  if (dueDate && from !== to && onDueDate >= load.limit * FULL_DAY_SHARE) {
    reasons.push(
      `the due date, ${formatDay(dueDate)}, already has ${formatDuration(onDueDate)} planned`,
    );
  }
  const dueInPeriod = load.openTasks.filter((task) => task.dueDate <= to);
  if (dueInPeriod.length >= MANY_TASKS) {
    reasons.push(`${dueInPeriod.length} unfinished tasks already due in that period`);
  }

  return { reasons, planned, capacity, dates, dueInPeriod };
}

/**
 * Checks whether `assignee` has room for a new task due on `dueDate`.
 * Returns the check when they look overloaded, or null when they have room.
 *
 * @param explicitDue whether the assigner named the date, or it is the default.
 * @param others teammates the assigner could assign to instead.
 */
export async function checkWorkload(input: {
  assignee: Person;
  others: Person[];
  today: string;
  dueDate: string;
  explicitDue: boolean;
}): Promise<{ overloaded: boolean; check: WorkloadCheck }> {
  const { assignee, others, today, explicitDue } = input;
  const from = today;
  const to = addDays(
    from,
    Math.min(Math.max(diffDays(from, input.dueDate), 0), MAX_WINDOW_DAYS - 1),
  );
  const lookahead = addDays(to, LOOKAHEAD_DAYS);

  const loads = await loadFor([assignee, ...others], from, lookahead);
  const load = loads.get(assignee.id) ?? { limit: 360, byDate: new Map(), openTasks: [] };
  const own = reasonsFor(load, from, to, explicitDue ? input.dueDate : undefined);

  // Teammates with room in the same period, lightest first.
  const alternatives = others
    .map((person) => {
      const theirs = loads.get(person.id);
      if (!theirs) return undefined;
      const result = reasonsFor(theirs, from, to, explicitDue ? input.dueDate : undefined);
      return result.reasons.length
        ? undefined
        : { id: person.id, name: person.name, plannedMinutes: result.planned };
    })
    .filter((entry) => entry !== undefined)
    .sort((a, b) => a.plannedMinutes - b.plannedMinutes)
    .slice(0, 3);

  // The first later day on which the assignee has real room.
  const laterDate = datesBetween(addDays(to, 1), lookahead).find(
    (date) => (load.byDate.get(date) ?? 0) <= load.limit * LIGHT_DAY_SHARE,
  );

  const unscheduled = own.dueInPeriod.filter((task) => !task.scheduled).length;
  return {
    overloaded: own.reasons.length > 0,
    check: {
      from,
      to,
      plannedMinutes: own.planned,
      capacityMinutes: own.capacity,
      limitMinutes: load.limit,
      days: own.dates.map((date) => ({
        date,
        minutes: load.byDate.get(date) ?? 0,
      })),
      reasons: own.reasons,
      openTasks: own.dueInPeriod.length,
      unscheduledTasks: unscheduled,
      alternatives,
      laterDay: laterDate
        ? { date: laterDate, minutes: load.byDate.get(laterDate) ?? 0 }
        : undefined,
    },
  };
}
