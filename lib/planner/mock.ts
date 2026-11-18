import { addDays, dateOf, diffDays, WEEKDAYS, weekdayName, weekdayOf } from "@/lib/time";
import type {
  Category,
  ChatTurn,
  ModelOutput,
  PlanIntent,
  PlanItem,
  PlannerContext,
  Priority,
  TaskStatus,
} from "./types";

/**
 * A rule-based stand-in for the planning model, used while LLM_PROVIDER=mock.
 * It follows the same contract as the real model (see prompt.ts) so the whole
 * chat -> proposal -> revise -> confirm flow can be built and demoed without
 * one. It only understands simple phrasings; it is not meant to be clever.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, "a couple of": 2, "a few": 3,
};
const COUNT = `(\\d+|${Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
const WEEKDAY = WEEKDAYS.map((day) => day.toLowerCase()).join("|");

const TIMEFRAME =
  new RegExp(
    `\\b(?:with?in|during|for|by the end of|by|before|until|on)?\\s*(?:the\\s+)?(?:this week(?:end)?|next week|today|tomorrow|(?:next|in) \\d+ days|${WEEKDAY})\\b`,
    "gi",
  );

type Template = {
  match: RegExp;
  category: Category;
  steps: (title: string) => { title: string; hours: number }[];
};

const TEMPLATES: Template[] = [
  {
    match: /\b(review|read)\b.*\b(paper|article|chapter|book)|\b(paper|article)s?\b.*\b(review|read)/,
    category: "study",
    steps: (title) => [{ title, hours: 1.5 }],
  },
  {
    match: /\b(assignment|homework|project|report|essay|lab|problem set|thesis)/,
    category: "study",
    steps: () => [
      { title: "Understand the brief and outline", hours: 1 },
      { title: "Do the main work", hours: 1.5 },
      { title: "Review and polish", hours: 0.5 },
    ],
  },
  {
    match: /\b(exam|test|quiz|midterm|final)/,
    category: "study",
    steps: () => [
      { title: "Review notes", hours: 1.5 },
      { title: "Practice questions", hours: 1.5 },
      { title: "Final recap", hours: 1 },
    ],
  },
  {
    match: /\b(presentation|slides|talk|pitch|demo)/,
    category: "work",
    steps: () => [
      { title: "Outline the story", hours: 1 },
      { title: "Build the slides", hours: 1.5 },
      { title: "Rehearse", hours: 0.5 },
    ],
  },
  {
    match: /\b(meeting|call|interview|sync)/,
    category: "work",
    steps: (title) => [{ title, hours: 1 }],
  },
  {
    match: /\b(gym|workout|run|jog|exercise|yoga|swim|walk)/,
    category: "exercise",
    steps: (title) => [{ title, hours: 1 }],
  },
];

const CURRICULA: { match: RegExp; name: string; topics: string[] }[] = [
  {
    match: /^(ml|machine learning)$/,
    name: "ML",
    topics: [
      "What ML is, supervised vs unsupervised, the train/validate/test workflow",
      "Linear regression, loss functions and gradient descent",
      "Classification: logistic regression and evaluation metrics",
      "Overfitting, regularisation and cross-validation",
      "Decision trees, random forests and boosting",
      "Neural network basics and backpropagation",
      "Unsupervised learning (k-means, PCA) and a small end-to-end project",
    ],
  },
];

const GENERIC_TOPICS = [
  "Overview and key concepts",
  "Core fundamentals",
  "Worked examples",
  "Practice problems",
  "Advanced topics",
  "Apply it in a small project",
  "Review and self-test",
];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const singular = (word: string) =>
  word.replace(/ies$/, "y").replace(/([^s])s$/, "$1");
const roundQuarter = (hours: number) => Math.max(0.25, Math.round(hours * 4) / 4);

function nextWeekday(today: string, weekday: number) {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7);
}

/** First day of the plan, when the user asks for a period that starts later. */
function parseStartDate(text: string, today: string) {
  const lower = text.toLowerCase();
  const sunday = nextWeekday(today, 0);
  if (/\bnext week\b/.test(lower)) return addDays(sunday, 1);
  if (/\bthis weekend\b/.test(lower)) return weekdayOf(today) === 0 ? today : nextWeekday(today, 6);
  // "tomorrow I have…" starts tomorrow; "by tomorrow" is only a deadline.
  if (/\btomorrow\b/.test(lower) && !/\b(by|before|until)\s+tomorrow\b/.test(lower)) {
    return addDays(today, 1);
  }
  return undefined;
}

function parseEndDate(text: string, today: string) {
  const lower = text.toLowerCase();
  const sunday = nextWeekday(today, 0);
  if (/\btoday\b/.test(lower)) return today;
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\bnext week\b/.test(lower)) return addDays(sunday, 7);
  if (/\bthis week/.test(lower)) return sunday;
  const inDays = lower.match(/\b(?:next|in) (\d+) days\b/);
  if (inDays) return addDays(today, Math.max(0, Number(inDays[1]) - 1));
  const day = lower.match(new RegExp(`\\b(?:by|before|until|on)\\s+(${WEEKDAY})\\b`));
  if (day) return nextWeekday(today, WEEKDAYS.findIndex((d) => d.toLowerCase() === day[1]));
  return undefined;
}

function studyItem(topic: string, days: number): PlanItem {
  const key = topic.toLowerCase();
  const curriculum = CURRICULA.find((entry) => entry.match.test(key));
  const topics = curriculum?.topics ?? GENERIC_TOPICS;
  const sessions = Math.min(Math.max(days, 3), topics.length);
  // With fewer days than topics, merge neighbouring topics into one session.
  const steps = Array.from({ length: sessions }, (_, index) => {
    const from = Math.floor((index * topics.length) / sessions);
    const to = Math.floor(((index + 1) * topics.length) / sessions);
    return { title: topics.slice(from, to).join(" + "), hours: 1.5 };
  });

  return {
    title: `Study ${curriculum?.name ?? topic}`,
    category: "study",
    priority: "medium",
    dueDate: undefined,
    notes: undefined,
    steps,
  };
}

function parseItems(text: string, days: number) {
  const items: PlanItem[] = [];
  const studied: string[] = [];

  const segments = text
    .replace(TIMEFRAME, " ")
    .split(/[,;\n.!?]|\band\b|\bthen\b|\bplus\b|\balso\b/i)
    .map((segment) =>
      segment
        .trim()
        .replace(
          /^(?:(?:i|we)(?:'ve| have)? (?:got|have|need|want|must|should)(?: to)?|there (?:is|are)|to|do|finish|complete)\s+/i,
          "",
        )
        .trim(),
    )
    .filter(Boolean);

  for (const segment of segments) {
    const lower = segment.toLowerCase();

    const study = lower.match(
      /\b(?:study|learn|understand|master|revise|get better at)\s+(?:for\s+|about\s+)?(.+)/,
    );
    if (study) {
      const topic = study[1].replace(/\s+/g, " ").trim();
      const item = studyItem(topic, days);
      items.push(item);
      studied.push(item.title.replace(/^Study /, ""));
      continue;
    }

    const priority: Priority = /\b(urgent(ly)?|asap|critical)\b/.test(lower)
      ? "critical"
      : /\b(important|high[- ]priority)\b/.test(lower)
        ? "high"
        : "medium";
    const plain = lower
      .replace(/\b(urgent(ly)?|asap|critical|important|high[- ]priority)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const counted = plain.match(new RegExp(`^${COUNT}\\s+(.+)$`));
    const count = counted
      ? Math.min(NUMBER_WORDS[counted[1]] ?? Number(counted[1]), 12)
      : 1;
    const phrase = (counted ? counted[2] : plain).trim();
    const template = TEMPLATES.find((entry) => entry.match.test(phrase));

    // Without a count or a recognised kind of task, this is probably
    // conversation ("help me plan"), not something to schedule.
    if (!counted && !template) continue;
    if (phrase.length < 3 || /^(plan|schedule|help|thing|task)s?\b/.test(phrase)) continue;

    const [nounPart, verbPart] = phrase.split(/\s+to\s+/);
    const noun = nounPart
      .split(" ")
      .map((word, index, words) => (index === words.length - 1 ? singular(word) : word))
      .join(" ");
    const verb = verbPart?.split(" ")[0];
    const base =
      verb && !/^(complete|do|finish|submit|attend|go)$/.test(verb)
        ? `${capitalize(verb)} ${noun}`
        : capitalize(noun);

    for (let index = 1; index <= count; index++) {
      const title = count > 1 ? `${base} ${index}` : base;
      items.push({
        title,
        category: template?.category ?? "work",
        priority,
        dueDate: undefined,
        notes: undefined,
        steps: template?.steps(title) ?? [{ title, hours: 1.5 }],
      });
    }
  }

  return { items, studied };
}

const hoursOf = (items: PlanItem[]) =>
  items.reduce(
    (sum, item) => sum + item.steps.reduce((total, step) => total + step.hours, 0),
    0,
  );

/** Items whose title shares a meaningful word with the user's message. */
function matchItems<T extends { title: string }>(items: T[], text: string) {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1)
      .map(singular),
  );
  const exact = items.filter((item) => text.toLowerCase().includes(item.title.toLowerCase()));
  if (exact.length) return exact;
  const stop = new Set(["the", "and", "for", "study", "review", "to", "of"]);
  const numbers = text.match(/\b\d+\b/g) ?? [];
  const byWord = items.filter((item) =>
    item.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !stop.has(word) && !/^\d+$/.test(word))
      .some((word) => words.has(singular(word))),
  );
  // "paper 3" means that one paper, not every paper.
  const byNumber = byWord.filter((item) =>
    numbers.some((number) => new RegExp(`\\b${number}$`).test(item.title)),
  );
  return byNumber.length ? byNumber : byWord;
}

function revise(text: string, draft: PlanIntent, today: string): ModelOutput | undefined {
  const lower = text.toLowerCase();
  const plan: PlanIntent = structuredClone(draft);
  plan.constraints ??= { startDate: undefined, endDate: undefined };
  const changes: string[] = [];

  const limit = lower.match(
    /(?:max(?:imum)?|at most|no more than|only|limit(?:ed)?(?: of| to)?|up to)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:h\b|hours?|hrs?)/,
  );
  if (limit) {
    plan.constraints.maxHoursPerDay = Number(limit[1]);
    changes.push(`capped focused work at ${limit[1]}h a day`);
  }

  const offDays = /\b(no (?:work|tasks?|study(?:ing)?)|free|off|nothing|rest|busy|skip|not on)\b/.test(lower)
    ? [...lower.matchAll(new RegExp(`\\b(${WEEKDAY}|today|tomorrow|weekends?)\\b`, "g"))].map(
        (match) => match[1],
      )
    : [];
  if (offDays.length) {
    const dates = new Set(plan.constraints.daysOff ?? []);
    for (let offset = 0; offset < 28; offset++) {
      const date = addDays(today, offset);
      const name = WEEKDAYS[weekdayOf(date)].toLowerCase();
      const isOff = offDays.some(
        (day) =>
          day === name ||
          (day === "today" && offset === 0) ||
          (day === "tomorrow" && offset === 1) ||
          (day.startsWith("weekend") && [0, 6].includes(weekdayOf(date))),
      );
      if (isOff) dates.add(date);
    }
    plan.constraints.daysOff = [...dates].sort();
    changes.push(`kept ${offDays.join(" and ")} free`);
  }

  if (!offDays.length && /\b(remove|drop|delete|skip|without|cancel)\b/.test(lower)) {
    const targets = matchItems(plan.items, lower);
    if (targets.length && targets.length < plan.items.length) {
      plan.items = plan.items.filter((item) => !targets.includes(item));
      changes.push(`removed ${targets.map((item) => item.title).join(", ")}`);
    }
  }

  // "Move it to next week", "reschedule it to start tomorrow".
  if (/\b(move|push|reschedule|shift|postpone|start)\b/.test(lower)) {
    const start = parseStartDate(text, today);
    if (start) {
      const length =
        plan.constraints.startDate && plan.constraints.endDate
          ? diffDays(plan.constraints.startDate, plan.constraints.endDate)
          : 6;
      const end = parseEndDate(text, today);
      const newEnd = end && end > start ? end : addDays(start, length);
      plan.constraints.startDate = start;
      plan.constraints.endDate = newEnd;
      // A deadline before the new start would leave nothing to schedule.
      for (const item of plan.items) {
        if (item.dueDate && item.dueDate < start) item.dueDate = newEnd;
      }
      changes.push(
        `moved it to ${weekdayName(start)} ${start} – ${weekdayName(newEnd)} ${newEnd}`,
      );
    }
  }

  const shorter = /\b(less|shorter|reduce|fewer|cut|too (?:much|long))\b/.test(lower);
  const longer = /\b(more time|longer|extra|increase|too (?:little|short))\b/.test(lower);
  if (!limit && (shorter || longer)) {
    const targets = matchItems(plan.items, lower);
    const factor = shorter ? 0.7 : 1.3;
    for (const item of targets) {
      for (const step of item.steps) step.hours = roundQuarter(step.hours * factor);
    }
    if (targets.length) {
      changes.push(
        `${shorter ? "shortened" : "lengthened"} ${targets.map((item) => item.title).join(", ")}`,
      );
    }
  }

  if (!offDays.length) {
    const due = lower.match(new RegExp(`\\b(?:due|by|before)\\s+(?:on\\s+)?(${WEEKDAY}|today|tomorrow)\\b`));
    const targets = due ? matchItems(plan.items, lower) : [];
    if (due && targets.length) {
      const date =
        due[1] === "today"
          ? today
          : due[1] === "tomorrow"
            ? addDays(today, 1)
            : nextWeekday(today, WEEKDAYS.findIndex((d) => d.toLowerCase() === due[1]));
      for (const item of targets) item.dueDate = date;
      changes.push(`set ${targets.map((item) => item.title).join(", ")} due ${due[1]}`);
    }
  }

  if (!changes.length && /\b(add|also|another|plus|include)\b/.test(lower)) {
    const from = plan.constraints.startDate ?? today;
    const end = plan.constraints.endDate ?? addDays(from, 6);
    const { items } = parseItems(text, diffDays(from, end) + 1);
    if (items.length) {
      plan.items.push(...items);
      changes.push(`added ${items.map((item) => item.title).join(", ")}`);
    }
  }

  if (!changes.length) return undefined;
  return {
    action: "propose",
    reply: `Done: I ${changes.join(", and ")}, and updated your calendar. Anything else to change?`,
    plan,
    revise: true,
  };
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  "not-started": "not started",
  ongoing: "ongoing",
  completed: "completed",
};

/** "I finished paper 2", "mark the report as done", "I started the slides". */
function updateStatus(lower: string, context: PlannerContext): ModelOutput | undefined {
  const status: TaskStatus | undefined =
    /\b(reopen|not started|haven'?t started|not done|undo)\b/.test(lower)
      ? "not-started"
      : /\b(mark|set|tick|check)\b.*\b(done|complete|completed|finished)\b|\b(finished|completed|done with|submitted)\b|\b(is|are) (done|complete)\b/.test(lower)
        ? "completed"
        : /\b(started|starting|working on|in progress|begun)\b/.test(lower)
          ? "ongoing"
          : undefined;
  if (!status) return undefined;

  const candidates = context.tasks.filter((task) => task.status !== status);
  const everything = /\b(all|every|everything|both)\b/.test(lower);
  const targets = matchItems(candidates, lower);
  const chosen = targets.length ? targets : everything ? candidates : [];
  if (!chosen.length) return undefined;

  if (chosen.length > 1 && !everything) {
    return {
      action: "ask",
      reply: `Which one do you mean: ${chosen.map((task) => task.title).join(", ")}? (Or say "all of them".)`,
    };
  }
  return {
    action: "update",
    reply: `Done, I marked ${chosen.map((task) => task.title).join(", ")} as ${STATUS_WORDS[status]}.`,
    taskUpdates: chosen.map((task) => ({ task: task.ref, status })),
  };
}

const REASON_QUESTION = "What's the reason";

/**
 * "I can't finish the launch checklist by Friday because I'm sick, tell my
 * leader": a message to whoever assigned the task, drafted for review.
 */
function reportDelay(text: string, context: PlannerContext): ModelOutput | undefined {
  const lower = text.toLowerCase();
  if (
    !/\b(can'?t|cannot|won'?t|unable to|not able to|won'?t be able to)\s+(finish|complete|make it|meet|get)\b|\b(email|tell|inform|let|notify|message)\s+(my\s+)?(leader|lead|manager|boss|sub-?leader)\b/.test(lower)
  ) {
    return undefined;
  }
  const assigned = context.tasks.filter((task) => task.assignedBy && task.status !== "completed");
  if (!assigned.length) {
    return {
      action: "chat",
      reply: "You don't have any unfinished tasks from a teammate, so there's nobody to tell. For your own tasks, I can move them to a later date instead.",
    };
  }
  // Match the task only in the part before the reason.
  const targets = matchItems(assigned, lower.split(/\b(?:because|due to|since)\b/)[0]);
  if (targets.length !== 1) {
    return {
      action: "ask",
      reply: `Which task can't you finish on time?\n${assigned.map((task) => `• ${task.title} (due ${task.dueDate}, from ${task.assignedBy})`).join("\n")}`,
    };
  }
  const [task] = targets;
  const reason = text
    .match(/\b(?:because|due to|since|as)\b\s*(.+)$/i)?.[1]
    ?.replace(/[,.;]?\s*(?:please\s+)?(?:can you\s+)?(?:email|tell|inform|let|notify|message)\s+(?:my\s+)?(?:leader|lead|manager|boss|sub-?leader|them|him|her).*$/i, "")
    .trim()
    .replace(/[.!]+$/, "");
  if (!reason) {
    return {
      action: "ask",
      reply: `${REASON_QUESTION} you can't finish "${task.title}" on time? I'll include it in the message to ${task.assignedBy}.`,
    };
  }
  return { action: "email", reply: "", email: { task: task.ref, reason: capitalize(reason) } };
}

/** "Send it" or "don't send it", while a message to an assigner waits for review. */
function decideEmail(lower: string, context: PlannerContext): ModelOutput | undefined {
  if (!context.pendingEmail) return undefined;
  if (/^(no|nope|cancel|don'?t( send)?|do not|never ?mind|forget it)\b/.test(lower)) {
    return { action: "cancel", reply: "" };
  }
  if (/^(yes|yep|yeah|sure|ok(ay)?|send( it)?|go ahead|confirm|looks? good)\b/.test(lower) && !/\bbut\b/.test(lower)) {
    return { action: "confirm", reply: "" };
  }
  return undefined;
}

/** "Assign prepare the demo slides to Priya by Friday, it's urgent". */
function assignTask(text: string, context: PlannerContext, today: string): ModelOutput | undefined {
  const lower = text.toLowerCase();
  if (!/\b(assign|delegate)\b/.test(lower)) return undefined;

  if (context.teammates.length === 0) {
    return {
      action: "chat",
      reply: "Your role doesn't allow assigning tasks. A team leader or sub-leader can do that.",
    };
  }

  const mentioned = context.teammates.filter((member) => {
    const [first] = member.name.toLowerCase().split(" ");
    return new RegExp(`\\b(${escapeRegExp(member.name.toLowerCase())}|${escapeRegExp(first)})\\b`).test(lower);
  });
  if (mentioned.length !== 1) {
    return {
      action: "ask",
      reply: mentioned.length
        ? `Which teammate do you mean: ${mentioned.map((member) => member.name).join(" or ")}?`
        : `Who should I assign it to? You can assign to: ${context.teammates.map((member) => member.name).join(", ")}.`,
    };
  }
  const [member] = mentioned;
  const [first] = member.name.split(" ");

  const priority: Priority = /\b(urgent(ly)?|asap|critical)\b/.test(lower)
    ? "critical"
    : /\b(important|high[- ]priority)\b/.test(lower)
      ? "high"
      : "medium";
  const title = text
    .replace(new RegExp(`\\b(to|for)?\\s*(${escapeRegExp(member.name)}|${escapeRegExp(first)})\\b`, "gi"), " ")
    .replace(TIMEFRAME, " ")
    .replace(/\b(please|can you|could you|assign|delegate|a task|the task|task)\b/gi, " ")
    .replace(/\b(it'?s|it is|this is|that'?s)?\s*(very\s+)?(urgent(ly)?|asap|critical|important|high[- ]priority)\b/gi, " ")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|of|about)\s+/i, "");
  if (title.length < 3) {
    return { action: "ask", reply: `What task should I assign to ${member.name}?` };
  }

  const dueDate = parseEndDate(text, today);
  return {
    action: "assign",
    reply: `Done, I assigned "${capitalize(title)}" to ${member.name}${dueDate ? `, due ${dueDate}` : ""}${priority === "medium" ? "" : ` (${priority} priority)`}. It now shows in their Shared Tasks.`,
    assignments: [
      { assignee: member.ref, title: capitalize(title), description: "", priority, dueDate },
    ],
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const REMOVE_VERB = /\b(remove|delete|drop|cancel|get rid of|clear)\b/;
/** How the stand-in phrases its "which one?" question; also how it recognises the answer. */
const REMOVE_QUESTION = "Which should I remove?";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(day)?\b/, 0],
  [/\bmon(day)?\b/, 1],
  [/\btue(s|sday)?\b/, 2],
  [/\bwed(nesday)?\b/, 3],
  [/\bthu(r|rs|rsday)?\b/, 4],
  [/\bfri(day)?\b/, 5],
  [/\bsat(urday)?\b/, 6],
];

const formatDay = (date: string) =>
  `${weekdayName(date).slice(0, 3)} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** The day the user named ("on Sat", "tomorrow", "Nov 21", "the 21st"), as a test on a date. */
function parseDayFilter(lower: string, today: string) {
  const tests: ((date: string) => boolean)[] = [];
  if (/\btoday\b/.test(lower)) tests.push((date) => date === today);
  if (/\btomorrow\b/.test(lower)) tests.push((date) => date === addDays(today, 1));
  for (const [pattern, weekday] of DAY_WORDS) {
    if (pattern.test(lower)) tests.push((date) => weekdayOf(date) === weekday);
  }
  const dayOfMonth =
    lower.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/) ??
    lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOfMonth) tests.push((date) => Number(date.slice(8)) === Number(dayOfMonth[1]));
  return tests.length ? (date: string) => tests.some((test) => test(date)) : undefined;
}

type TaskContext = PlannerContext["tasks"][number];
type SessionContext = TaskContext["sessions"][number];

/**
 * "Remove paper 3", "remove assignment 2 on Sat", "delete all my tasks".
 *
 * A task is made of sessions on different days. Deleting is permanent, so the
 * stand-in only acts when exactly one thing can be meant; otherwise it lists
 * every candidate with its full title and date and asks.
 */
function removeTasks(lower: string, context: PlannerContext, today: string): ModelOutput | undefined {
  if (!REMOVE_VERB.test(lower)) return undefined;

  const everything = /\b(all|every|everything|both|whole|entire)\b/.test(lower);
  const matched = matchItems(context.tasks, lower);
  const chosen = matched.length ? matched : everything ? context.tasks : [];
  if (!chosen.length) return undefined;

  // A task a teammate assigned is theirs to withdraw, not the user's to delete.
  const own = chosen.filter((task) => !task.assignedBy);
  if (!own.length) {
    return {
      action: "chat",
      reply: `${chosen.map((task) => task.title).join(", ")} was assigned to you by ${chosen[0].assignedBy}, so I can't remove it. Ask them to withdraw it.`,
    };
  }

  const sessions = own.flatMap((task) => task.sessions);
  const describe = (session: SessionContext) =>
    `• ${session.title}: ${formatDay(session.date)}, ${session.start}-${session.end}${session.completed ? " (done)" : ""}`;
  const listing = (items: SessionContext[]) => items.map(describe).join("\n");
  const names = own.map((task) => task.title).join(", ");

  // Narrow by the day and by the step the user named, if they named either.
  const onDay = parseDayFilter(lower, today);
  const words = new Set(lower.split(/[^a-z0-9]+/).map(singular));
  const stepScore = (session: SessionContext) =>
    (session.title.split(": ")[1] ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && words.has(singular(word))).length;
  const bestStep = Math.max(0, ...sessions.map(stepScore));

  if (onDay || bestStep > 0) {
    let narrowed = onDay ? sessions.filter((session) => onDay(session.date)) : sessions;
    if (bestStep > 0) {
      const byStep = narrowed.filter((session) => stepScore(session) === bestStep);
      if (byStep.length) narrowed = byStep;
    }
    if (narrowed.length === 1) {
      const [session] = narrowed;
      return {
        action: "remove",
        reply: `Done, I removed "${session.title}" on ${formatDay(session.date)} from your calendar.`,
        removals: [{ session: session.ref }],
      };
    }
    if (narrowed.length === 0) {
      return {
        action: "ask",
        reply: sessions.length
          ? `I couldn't find a session of ${names} on that day. Here is what's planned:\n${listing(sessions)}\n${REMOVE_QUESTION}`
          : `${names} has nothing on the calendar. Say "remove all of ${names}" to delete the task itself.`,
      };
    }
    return {
      action: "ask",
      reply: `More than one session matches:\n${listing(narrowed)}\n${REMOVE_QUESTION} Tell me the day or the step.`,
    };
  }

  // No day or step given: act only if there is nothing to choose between.
  const single = own.length === 1 && own[0].sessions.length <= 1;
  if (everything || single) {
    return {
      action: "remove",
      reply: `Done, I removed ${names} and ${sessions.length === 1 ? "its session" : "all its sessions"} from your calendar.`,
      removals: own.map((task) => ({ task: task.ref })),
    };
  }
  const unplanned = own.filter((task) => task.sessions.length === 0);
  return {
    action: "ask",
    reply:
      `${names} has ${sessions.length} sessions on your calendar:\n${listing(sessions)}` +
      (unplanned.length ? `\n• ${unplanned.map((task) => task.title).join(", ")}: not on the calendar` : "") +
      `\n${REMOVE_QUESTION} Tell me the day (for example "the one on ${weekdayName(sessions[0].date).slice(0, 3)}"), or say "all of them".`,
  };
}

/** A new deadline named in passing: "next Wednesday", "by Friday", "tomorrow", "the 24th". */
function parseNewDue(lower: string, today: string) {
  const weekday = DAY_WORDS.find(([pattern]) => pattern.test(lower))?.[1];
  if (weekday !== undefined) {
    // "next Wednesday" means the one in next week, not the coming one.
    const nextWeek = new RegExp(`\\bnext\\s+(${WEEKDAY}|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b`).test(lower);
    return nextWeek
      ? nextWeekday(addDays(nextWeekday(today, 0), 1), weekday)
      : nextWeekday(today, weekday);
  }
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\bnext week\b/.test(lower)) return addDays(nextWeekday(today, 0), 7);
  const day = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (day) {
    // The next date with that day of the month.
    for (let offset = 0; offset < 62; offset++) {
      const date = addDays(today, offset);
      if (Number(date.slice(8)) === Number(day[1])) return date;
    }
  }
  return undefined;
}

/**
 * The reply to a workload warning. An assignment is being held because the
 * assignee looked overloaded; the user either goes ahead, drops it, or
 * redirects it to another person or date.
 */
function decideHeld(text: string, context: PlannerContext, today: string): ModelOutput | undefined {
  const held = context.heldAssignments;
  if (!held?.length) return undefined;
  const lower = text.toLowerCase().trim();

  if (
    /\b(assign|give)(\s+(it|them|that))?\s+anyway\b|\bstill assign\b|\bgo ahead\b|^(yes|yep|yeah|sure|ok(ay)?|confirm|do it)\b/.test(lower) &&
    !/\bbut\b/.test(lower)
  ) {
    return { action: "confirm", reply: "" };
  }
  if (/^(no|nope|cancel|never ?mind|don'?t|do not|leave it|skip it|forget it)\b/.test(lower)) {
    return { action: "cancel", reply: "" };
  }

  const mentioned = context.teammates.filter((member) => {
    const [first] = member.name.toLowerCase().split(" ");
    return new RegExp(`\\b(${escapeRegExp(member.name.toLowerCase())}|${escapeRegExp(first)})\\b`).test(lower);
  });
  const redirecting = /\b(instead|rather|it to|them to|that to|give it|give them)\b/.test(lower);
  const newDue = parseNewDue(lower, today);

  // "Give it to Devin instead": the same task, another person.
  if (mentioned.length === 1 && redirecting) {
    return {
      action: "assign",
      reply: "",
      assignments: held.map((item) => ({
        assignee: mentioned[0].ref,
        title: item.title,
        description: "",
        priority: item.priority,
        dueDate: newDue ?? item.dueDate,
      })),
    };
  }
  // "Make it due next Wednesday": the same task and person, another date.
  if (mentioned.length === 0 && newDue && /\b(due|by|deadline|move|push|instead|later|until|on|next)\b/.test(lower)) {
    const sameAssignee = (name: string) =>
      context.teammates.find((member) => member.name === name)?.ref ?? name;
    return {
      action: "assign",
      reply: "",
      assignments: held.map((item) => ({
        assignee: sameAssignee(item.assignee),
        title: item.title,
        description: "",
        priority: item.priority,
        dueDate: newDue,
      })),
    };
  }
  return undefined;
}

export function mockPlanner(history: ChatTurn[], context: PlannerContext): ModelOutput {
  const text = history.findLast((turn) => turn.role === "user")?.content ?? "";
  const lower = text.toLowerCase().trim();
  const today = dateOf(context.now);

  // A held assignment is waiting for a decision: read the message as the answer.
  const decision = decideHeld(text, context, today);
  if (decision) return decision;

  const emailDecision = decideEmail(lower, context);
  if (emailDecision) return emailDecision;

  // If the last question was "What's the reason…?", this message is the answer.
  const said = history.filter((turn) => turn.content);
  const askedReason =
    said.at(-2)?.role === "assistant" &&
    said.at(-2)!.content.startsWith(REASON_QUESTION) &&
    said.at(-3)?.role === "user";
  const delay = reportDelay(
    askedReason
      ? `${said.at(-3)!.content} because ${text.replace(/^\s*(because|it'?s because)\s*/i, "")}`
      : text,
    context,
  );
  if (delay) return delay;

  const assignment = assignTask(text, context, today);
  if (assignment) return assignment;

  const statusUpdate = updateStatus(lower, context);
  if (statusUpdate) return statusUpdate;

  if (context.currentPlan) {
    if (
      /^(yes|yep|yeah|sure|ok(ay)?|confirm|looks? (good|great|fine)|sounds? (good|great)|go ahead|do it|perfect|lgtm|that works|all good|no changes?)\b/.test(
        lower,
      ) &&
      !/\bbut\b/.test(lower)
    ) {
      return { action: "confirm", reply: "" };
    }
    // "Undo the plan": take this chat's plan off the calendar again.
    if (
      /\b(undo|discard|scrap)\b|\b(take|get) (it|this|that|the plan|the whole plan) off\b|\b(remove|delete|cancel) (the|this|that|my) (whole )?plan\b/.test(lower)
    ) {
      return { action: "cancel", reply: "" };
    }
    const revised = revise(text, context.currentPlan, today);
    if (revised) return revised;
  }

  // Reached only when the message was not a change to a draft plan.
  // If the last thing said was "Which should I remove?", this message is the
  // answer ("the one on Sat"), so read it together with the original request.
  const turns = history.filter((turn) => turn.content);
  const asked = turns.at(-2)?.role === "assistant" && turns.at(-2)!.content.includes(REMOVE_QUESTION);
  const removalText =
    asked && !REMOVE_VERB.test(lower) && turns.at(-3)?.role === "user"
      ? `${turns.at(-3)!.content.toLowerCase()} ${lower}`
      : lower;
  const removal = removeTasks(removalText, context, today);
  if (removal) return removal;
  // A request to remove something that matched no task must not fall through
  // and be read as new work to plan.
  if (/\b(remove|delete|get rid of)\b/.test(removalText)) {
    return {
      action: "ask",
      reply: context.tasks.length
        ? `I couldn't find a task like that. Your tasks are: ${context.tasks.map((task) => task.title).join(", ")}. ${REMOVE_QUESTION}`
        : "You don't have any tasks to remove yet.",
    };
  }

  const startDate = parseStartDate(text, today);
  const endDate = parseEndDate(text, today);
  const from = startDate ?? today;
  const horizon = endDate && endDate >= from ? endDate : addDays(from, 6);
  const { items, studied } = parseItems(text, diffDays(from, horizon) + 1);

  if (!items.length) {
    if (context.currentPlan) {
      return {
        action: "chat",
        reply:
          "I can adjust the plan on your calendar: try \"max 4 hours a day\", \"keep Sunday free\", \"remove paper 3\", \"less time on ML\", \"add 1 presentation\", or \"undo the plan\".",
      };
    }
    return {
      action: "ask",
      reply: /^(hi|hello|hey)\b/.test(lower)
        ? `Hi ${context.userName.split(" ")[0]}! Tell me what you need to get done and by when, for example: "This week I have 2 assignments to complete, 3 papers to review, and I want to study ML."`
        : "What do you need to get done, and by when? For example: \"This week I have 2 assignments to complete, 3 papers to review, and I want to study ML.\" You can also tell me about progress, like \"I finished paper 2\", or ask me to remove a task.",
    };
  }

  const total = hoursOf(items);
  const days = diffDays(from, horizon) + 1;
  const period = /\bnext week\b/i.test(text)
    ? "next week"
    : /\bthis week/i.test(text)
      ? "the rest of this week"
      : undefined;
  const notes = [
    `I've broken that into ${items.length} ${items.length === 1 ? "item" : "items"}, about ${roundQuarter(total)}h of focused work spread over ${period ? `${period} (${weekdayName(from)} ${from} to ${weekdayName(horizon)} ${horizon})` : `${days} ${days === 1 ? "day" : "days"}`}.`,
  ];
  if (!endDate) notes.push("You didn't give a deadline, so I assumed the next 7 days.");
  for (const topic of studied) {
    notes.push(
      `For ${topic}, instead of one big "study" block I've set one topic per session so each day builds on the last. That won't cover everything in this time, but it gives you a solid foundation to continue from.`,
    );
  }
  const unfinished = context.tasks.filter((task) => task.status !== "completed").length;
  if (unfinished) {
    notes.push(
      `You also have ${unfinished} unfinished ${unfinished === 1 ? "task" : "tasks"} already on your plate, which I've left as they are.`,
    );
  }
  notes.push(
    "I've put it on your calendar. The time estimates are my assumptions: tell me if you want to change anything (hours, days off, deadlines), or say \"undo the plan\" to take it off.",
  );

  return {
    action: "propose",
    reply: notes.join("\n\n"),
    plan: { items, constraints: { startDate, endDate: horizon } },
  };
}
