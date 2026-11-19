import {
  addDays,
  dateOf,
  diffDays,
  formatDuration,
  minutesOf,
  toDateTime,
  weekdayName,
  weekdayOf,
} from "@/lib/time";
import {
  isFocusWork,
  PRIORITIES,
  type Category,
  type PlanIntent,
  type Proposal,
  type ProposedBlock,
} from "./types";

/**
 * Turns "what needs doing" (from the model) into concrete calendar blocks.
 *
 * This is deliberately plain code, not the model: small local models are
 * unreliable at arithmetic and calendar constraints, and the burnout rules
 * below must hold every time.
 *
 *  - focused work never exceeds the daily limit, counting what is already booked
 *  - work is spread across the days before each deadline instead of front-loaded
 *  - sessions are capped at two hours, with a break after each and lunch kept free
 *  - nothing is placed on top of an existing calendar block
 *  - weekends are filled last
 */

const SLOT = 15;
const BREAK = 15;
const MAX_SESSION = 120;
const LUNCH: Interval = [12 * 60, 13 * 60];
const EVENING_END = 21 * 60;
const LATE_END = 22 * 60;
/** How far past the requested range the planner may spill before giving up. */
const SPILL_DAYS = 14;
const MAX_HORIZON_DAYS = 120;

type Interval = [start: number, end: number];

export type ScheduleContext = {
  now: string;
  prefs: { dayStart: number; dayEnd: number; maxWorkMinutes: number };
  busy: { start: string; end: string; category: Category }[];
};

type Day = {
  date: string;
  occupied: Interval[];
  existingWork: number;
  plannedWork: number;
  /** Minutes of personal activities already placed this evening. */
  plannedLeisure: number;
};

type Unit = {
  itemIndex: number;
  title: string;
  minutes: number;
  category: Category;
};

const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

/** Earliest start in [lo, hi] where `minutes` fits between occupied intervals. */
function findSlot(occupied: Interval[], minutes: number, lo: number, hi: number) {
  let cursor = ceilTo(lo, SLOT);
  for (const [start, end] of [...occupied].sort((a, b) => a[0] - b[0])) {
    if (end <= cursor) continue;
    if (cursor + minutes <= start) break;
    cursor = ceilTo(end, SLOT);
  }
  return cursor + minutes <= hi ? cursor : null;
}

function toUnits(intent: PlanIntent): Unit[][] {
  return intent.items.map((item, itemIndex) =>
    item.steps.flatMap((step) => {
      const total = Math.max(SLOT, ceilTo(Math.round(step.hours * 60), SLOT));
      const parts = Math.ceil(total / MAX_SESSION);
      const perPart = ceilTo(total / parts, SLOT);
      const sameTitle =
        step.title.toLowerCase() === item.title.toLowerCase() ||
        step.title.toLowerCase().startsWith(item.title.toLowerCase());
      const base = sameTitle ? step.title : `${item.title}: ${step.title}`;

      return Array.from({ length: parts }, (_, part) => ({
        itemIndex,
        title: parts > 1 ? `${base} (${part + 1}/${parts})` : base,
        minutes: perPart,
        category: item.category,
      }));
    }),
  );
}

export function buildProposal(
  intent: PlanIntent,
  context: ScheduleContext,
): Proposal {
  const { prefs } = context;
  const constraints: Partial<NonNullable<PlanIntent["constraints"]>> =
    intent.constraints ?? {};
  const actualToday = dateOf(context.now);
  // First day of the plan. "Next week" starts next Monday; nothing may be
  // scheduled before it, and never in the past.
  const today =
    constraints.startDate && constraints.startDate > actualToday
      ? constraints.startDate
      : actualToday;
  const startsToday = today === actualToday;
  const nowMinutes = ceilTo(minutesOf(context.now), 30);
  const dailyLimit = constraints.maxHoursPerDay
    ? Math.round(constraints.maxHoursPerDay * 60)
    : prefs.maxWorkMinutes;
  const daysOff = new Set(constraints.daysOff ?? []);
  const warnings = new Set<string>();

  // --- Planning range -------------------------------------------------------
  const dueDates = intent.items.map((item) =>
    item.dueDate && item.dueDate >= today ? item.dueDate : undefined,
  );
  intent.items.forEach((item, index) => {
    if (item.dueDate && !dueDates[index]) {
      warnings.add(
        `"${item.title}" is due ${item.dueDate}, before this plan starts, so I planned it as early as possible.`,
      );
    }
  });
  const knownDues = dueDates.filter((date): date is string => Boolean(date));
  const horizonEnd =
    constraints.endDate && constraints.endDate >= today
      ? constraints.endDate
      : (knownDues.sort().at(-1) ?? addDays(today, 6));
  const lastDue = [horizonEnd, ...knownDues].sort().at(-1)!;
  const dayCount =
    Math.min(diffDays(today, lastDue), MAX_HORIZON_DAYS) + 1 + SPILL_DAYS;

  const days: Day[] = Array.from({ length: dayCount }, (_, offset) => {
    const date = addDays(today, offset);
    const dayStart = `${date}T00:00`;
    const nextDay = `${addDays(date, 1)}T00:00`;
    const day: Day = { date, occupied: [], existingWork: 0, plannedWork: 0, plannedLeisure: 0 };

    for (const block of context.busy) {
      if (block.end <= dayStart || block.start >= nextDay) continue;
      const start = block.start <= dayStart ? 0 : minutesOf(block.start);
      const end = block.end >= nextDay ? 24 * 60 : minutesOf(block.end);
      day.occupied.push([start, end]);
      if (isFocusWork(block.category)) day.existingWork += end - start;
    }
    return day;
  });

  const dueIndex = (itemIndex: number) =>
    Math.max(
      Math.min(diffDays(today, dueDates[itemIndex] ?? horizonEnd), days.length - 1),
      startIndex(itemIndex),
    );
  // First day an item may use: its own startDate (an item moved to next
  // week), never before the plan starts.
  function startIndex(itemIndex: number) {
    const start = intent.items[itemIndex].startDate;
    return start && start > today ? Math.min(diffDays(today, start), days.length - 1) : 0;
  }

  // --- Ordering: nearest deadline first, then priority; items interleaved ---
  const unitsByItem = toUnits(intent);
  const itemOrder = intent.items
    .map((_, index) => index)
    .sort(
      (a, b) =>
        dueIndex(a) - dueIndex(b) ||
        PRIORITIES.indexOf(intent.items[a].priority) -
          PRIORITIES.indexOf(intent.items[b].priority) ||
        a - b,
    );
  // Where each session would sit if its item were spread evenly up to the
  // deadline. Placing sessions in that order fills the days front to back.
  const queue = itemOrder
    .flatMap((itemIndex) => {
      const units = unitsByItem[itemIndex];
      return units.map((unit, position) => ({
        unit,
        // Centred in its share of the window, so a single-session item lands
        // mid-range instead of always on the first day.
        ideal:
          startIndex(itemIndex) +
          Math.floor(
            ((position + 0.5) * (dueIndex(itemIndex) - startIndex(itemIndex) + 1)) / units.length,
          ),
      }));
    })
    .sort((a, b) => a.ideal - b.ideal);

  // --- Placement ------------------------------------------------------------
  const blocks: ProposedBlock[] = [];
  const lastDayOfItem = new Map<number, number>();
  // Where an item's latest session ends on that day: its next step can't go
  // earlier the same day ("Finalize" before "Write the draft").
  const lastEndOfItem = new Map<number, number>();
  const lateItems = new Set<string>();

  const tryDay = (
    unit: Unit,
    index: number,
    options: { overLimit?: boolean; anyTime?: boolean } = {},
  ) => {
    const day = days[index];
    if (daysOff.has(day.date)) return null;

    const focus = isFocusWork(unit.category);
    const load = day.existingWork + day.plannedWork;
    if (focus && !options.overLimit && load + unit.minutes > dailyLimit) {
      return null;
    }

    const earliest = Math.max(
      index === 0 && startsToday ? nowMinutes : 0,
      lastDayOfItem.get(unit.itemIndex) === index ? (lastEndOfItem.get(unit.itemIndex) ?? 0) : 0,
    );
    // Focused work goes in working hours; personal items go in the evening.
    // Only when no evening has room (`anyTime`) may they use free daytime.
    const windows: Interval[] = focus
      ? [[prefs.dayStart, options.overLimit ? LATE_END : prefs.dayEnd]]
      : options.anyTime
        ? [
            [prefs.dayEnd, EVENING_END],
            [prefs.dayStart, EVENING_END],
          ]
        : [[prefs.dayEnd, EVENING_END]];
    const occupied = focus ? [...day.occupied, LUNCH] : day.occupied;

    for (const [lo, hi] of windows) {
      const start = findSlot(occupied, unit.minutes, Math.max(lo, earliest), hi);
      if (start !== null) return start;
    }
    return null;
  };

  const place = (unit: Unit, index: number, start: number) => {
    const day = days[index];
    day.occupied.push([start, start + unit.minutes + BREAK]);
    if (isFocusWork(unit.category)) day.plannedWork += unit.minutes;
    else day.plannedLeisure += unit.minutes;
    lastDayOfItem.set(unit.itemIndex, index);
    lastEndOfItem.set(unit.itemIndex, start + unit.minutes);
    blocks.push({
      itemIndex: unit.itemIndex,
      title: unit.title,
      start: toDateTime(day.date, start),
      end: toDateTime(day.date, start + unit.minutes),
      category: unit.category,
    });
  };

  for (const { unit, ideal } of queue) {
    const item = intent.items[unit.itemIndex];
    const due = dueIndex(unit.itemIndex);
    const previous = lastDayOfItem.get(unit.itemIndex);
    const first = Math.max(startIndex(unit.itemIndex), Math.min(previous ?? 0, due));

    const focusUnit = isFocusWork(unit.category);
    const pickBest = (options: { anyTime?: boolean } = {}) => {
      let best: { index: number; start: number; score: number } | undefined;
      for (let index = first; index <= due; index++) {
        const start = tryDay(unit, index, options);
        if (start === null) continue;
        const day = days[index];
        const weekend = [0, 6].includes(weekdayOf(day.date));
        // Lower is better: prefer lighter days, near the ideal day. Slipping
        // later costs more than starting early, so work doesn't pile up at the end.
        // Personal activities also spread out over the evenings.
        const score =
          day.existingWork +
          day.plannedWork +
          (focusUnit ? 0 : 2 * day.plannedLeisure) +
          (index > ideal ? 90 * (index - ideal) : 30 * (ideal - index)) +
          (index === previous ? 90 : 0) +
          (weekend ? 45 : 0);
        if (!best || score < best.score) best = { index, start, score };
      }
      return best;
    };
    // A personal activity tries every evening before any daytime slot.
    const best = pickBest() ?? (focusUnit ? undefined : pickBest({ anyTime: true }));
    if (best) {
      place(unit, best.index, best.start);
      continue;
    }

    // No room before the deadline within the daily limit: prefer running late
    // over overloading a day.
    let placed = false;
    for (let index = Math.max(due + 1, previous ?? 0, startIndex(unit.itemIndex)); index < days.length; index++) {
      const start = tryDay(unit, index, { anyTime: true });
      if (start === null) continue;
      place(unit, index, start);
      lateItems.add(item.title);
      placed = true;
      break;
    }
    if (placed) continue;

    for (let index = first; index <= due && !placed; index++) {
      const start = tryDay(unit, index, { overLimit: true, anyTime: true });
      if (start === null) continue;
      place(unit, index, start);
      warnings.add(
        `${weekdayName(days[index].date)} ${days[index].date} goes over your daily limit to fit "${item.title}".`,
      );
      placed = true;
    }
    if (!placed) {
      warnings.add(
        `I couldn't find any free time for "${unit.title}". It is left out of this plan.`,
      );
    }
  }

  if (lateItems.size > 0) {
    warnings.add(
      `Not everything fits in time within your ${formatDuration(dailyLimit)} daily limit, so part of this runs past its deadline: ${[...lateItems].join(", ")}. You could raise the limit, extend the deadline, or drop something.`,
    );
  }

  // --- Summary --------------------------------------------------------------
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  const lastUsed = days.findLastIndex((day) => day.plannedWork > 0);
  const summaryEnd = Math.max(
    lastUsed,
    Math.min(diffDays(today, horizonEnd), days.length - 1),
  );
  const summaryDays = days.slice(0, summaryEnd + 1).map((day) => ({
    date: day.date,
    plannedMinutes: day.plannedWork,
    existingMinutes: day.existingWork,
  }));

  const totalMinutes = blocks.reduce(
    (sum, block) => sum + minutesOf(block.end) - minutesOf(block.start),
    0,
  );
  const workingDays = summaryDays.filter((day) => !daysOff.has(day.date));
  const focusTotal = summaryDays.reduce(
    (sum, day) => sum + day.plannedMinutes + day.existingMinutes,
    0,
  );
  if (
    workingDays.length > 0 &&
    focusTotal / workingDays.length > dailyLimit * 0.85 &&
    warnings.size === 0
  ) {
    warnings.add(
      "This is a full schedule with little slack. Consider dropping or postponing a low-priority item.",
    );
  }

  return {
    intent,
    blocks,
    days: summaryDays,
    warnings: [...warnings],
    dailyLimitMinutes: dailyLimit,
    totalMinutes,
  };
}
