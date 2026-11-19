import { addDays, dateOf } from "@/lib/time";
import { dueDateIn, periodOf, weekdaysNamedIn } from "./dates";
import { CATEGORIES, type Category, type ModelOutput, type PlanIntent, type PlanItem } from "./types";

/**
 * Step-by-step planning for small models.
 *
 * A small model (the hackathon's Qwen2.5-1.5B) picks the right action for "I
 * have 3 papers, 2 assignments, gym and an ML course this week" but can't
 * write the whole plan as one big JSON object. It can answer small questions
 * reliably, so this asks it several:
 *
 * 1. the message is cut into parts at commas and "and"; for each part the
 *    model says whether it is a to-do, and its title, count and category;
 * 2. for each distinct to-do the model gives the sessions and their hours;
 * 3. if the user asked for free-time ideas, the model suggests a few, with
 *    how long each takes, and they go on the calendar as evening activities.
 *
 * Every title, count, category, step and hour estimate comes from the model.
 * Code only cuts the message up, resolves dates ("this week" = Sunday),
 * reads stated limits ("max 4 hours a day", "keep Sunday free") and puts the
 * answers together. A part the model can't answer is reported to the user,
 * never filled in.
 */

/** Sends one instruction + message to the model and returns its raw text. */
export type Complete = (instructions: string, message: string) => Promise<string>;

const ITEM_PROMPT = `Decide if a part of a user's message is something they need to do, and describe it. Reply with JSON only, like the examples. Never ask questions.

Part: this week I have 4 chapters to read
JSON: {"todo":true,"title":"Read chapter","count":4,"category":"study"}

Part: a project report
JSON: {"todo":true,"title":"Project report","count":1,"category":"work"}

Part: swimming for 30 minutes
JSON: {"todo":true,"title":"Swimming","count":1,"category":"exercise"}

Part: finish the Python course
JSON: {"todo":true,"title":"Finish the Python course","count":1,"category":"study"}

Part: 2 homeworks
JSON: {"todo":true,"title":"Homework","count":2,"category":"study"}

Part: can you help me
JSON: {"todo":false}`;

const STEPS_PROMPT = `Split a task into work sessions of at most 2 hours each, with honest hour estimates. Reply with JSON only, like the examples. Never ask questions: if the task is vague, assume a typical version of it.

Task: Write essay (study)
JSON: {"steps":[{"title":"Outline","hours":1},{"title":"Write the draft","hours":2},{"title":"Edit and finish","hours":1}]}

Task: Assignment (study)
JSON: {"steps":[{"title":"Read the brief and plan","hours":0.5},{"title":"Do the main work","hours":2},{"title":"Check and submit","hours":1}]}

Task: Lab report (study)
JSON: {"steps":[{"title":"Organise the results","hours":1},{"title":"Write the report","hours":2},{"title":"Proofread","hours":0.5}]}

Task: Finish the statistics course (study, 5 days available)
JSON: {"steps":[{"title":"Descriptive statistics","hours":1.5},{"title":"Probability basics","hours":2},{"title":"Hypothesis testing","hours":2},{"title":"Practice problems","hours":1.5}]}

Task: Swimming (exercise, 30 minutes)
JSON: {"steps":[{"title":"Swimming","hours":0.5}]}`;

const IDEAS_PROMPT = `Suggest 3 short, restful or fun things to do in free time: rest, hobbies, time outdoors or with people. Not work, study or planning. Reply with JSON only, like the example.

Someone has a busy week of exams.
JSON: {"ideas":[{"title":"Take a walk outside","hours":0.5},{"title":"Cook something new","hours":1},{"title":"Call a friend","hours":0.5}]}`;

const FREE_TIME = /\b(free time|free times|spare time|free evenings?|other activit|hobb(y|ies)|what (else )?(can|should) i do|suggest)/i;
const LIMIT = /\b(max(imum)?|at most|no more than|up to)\b[^.]*\bhours?\b|\b(keep|leave)\b[^.]*\b(free|off)\b|\bday off\b/i;

/**
 * Cuts a message into the parts a user lists: "3 papers, 2 assignments and
 * gym". Text in brackets stays with its part: "3 papers (transformers, LLMs
 * and the big bang)" is one part.
 */
export function splitParts(text: string) {
  const groups: string[] = [];
  const masked = text.replace(/\(([^)]*)\)/g, (_, inner: string) => `(@${groups.push(inner) - 1}@)`);
  return masked
    .split(/[,;\n]|\.(?:\s+|$)|\band\b|\balso\b|\bplus\b|\bthen\b/i)
    .map((part) => part.replace(/\(@(\d+)@\)/g, (_, index: string) => `(${groups[Number(index)]})`).trim())
    .filter((part) => part.length > 2);
}

/** Names the user listed in brackets: "3 papers (A, B and C)" gives A, B, C. */
export function namesIn(part: string): string[] {
  const inner = part.match(/\(([^)]*)\)/)?.[1];
  if (!inner) return [];
  return inner
    .split(/\s*[,;]\s*|\s+and\s+/i)
    .map((name) => name.replace(/^and\s+/i, "").trim())
    .filter((name) => name.length > 0);
}

const withoutBrackets = (part: string) => part.replace(/\s*\([^)]*\)/g, "").trim();

/** The first JSON object in a model answer, or null. Tolerates stray text and a trailing quote. */
export function jsonIn(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Asks until the answer is usable, once per wording given (twice when there
 * is only one). Repeating a question a small model just refused usually gets
 * the same refusal, so alternative wordings do better than plain retries.
 */
async function askJson<T>(
  complete: Complete,
  instructions: string,
  messages: string | string[],
  read: (json: Record<string, unknown>) => T | null,
): Promise<T | null> {
  const wordings = typeof messages === "string" ? [messages, messages] : messages;
  for (const message of wordings) {
    // A failed request (server down, timeout) throws: stop the whole plan
    // rather than wait out every remaining question.
    const text = await complete(instructions, message);
    if (process.env.LLM_DEBUG === "on") console.log("[stepwise]", JSON.stringify(message), "->", text.replace(/\s+/g, " ").slice(0, 200));
    const json = jsonIn(text);
    const value = json ? read(json) : null;
    if (value !== null) return value;
  }
  return null;
}

const CATEGORY_SET = new Set<string>(CATEGORIES);
const asCategory = (value: unknown): Category =>
  typeof value === "string" && CATEGORY_SET.has(value) ? (value as Category) : "work";

type Todo = { title: string; count: number; category: Category; part: string };

const readTodo = (part: string) => (json: Record<string, unknown>): Todo | false | null => {
  if (json.todo === false) return false;
  if (json.todo !== true || typeof json.title !== "string" || !json.title.trim()) return null;
  const count = Math.round(Number(json.count));
  return {
    title: json.title.trim().slice(0, 80),
    count: Number.isFinite(count) && count >= 1 ? Math.min(count, 10) : 1,
    category: asCategory(json.category),
    part,
  };
};

type Step = { title: string; hours: number };

function readSteps(json: Record<string, unknown>): Step[] | null {
  if (!Array.isArray(json.steps) || !json.steps.length) return null;
  const steps: Step[] = [];
  for (const raw of json.steps.slice(0, 8)) {
    const title = typeof raw?.title === "string" ? raw.title.trim().slice(0, 80) : "";
    const hours = Number(raw?.hours);
    if (!title || !Number.isFinite(hours) || hours <= 0) return null;
    // The scheduler books at most 2 hours per sitting: split longer ones.
    let left = Math.min(hours, 12);
    for (let part = 1; left > 0; part++) {
      const chunk = Math.min(2, left);
      steps.push({ title: hours > 2 ? `${title} (part ${part})` : title, hours: Math.round(chunk * 4) / 4 || 0.25 });
      left -= chunk;
    }
  }
  return steps;
}

/** A free-time activity; `hours` is the model's, when it gave one. */
type Idea = { title: string; hours?: number };

function readIdeas(json: Record<string, unknown>): Idea[] | null {
  if (!Array.isArray(json.ideas)) return null;
  const ideas: Idea[] = [];
  for (const raw of json.ideas.slice(0, 4)) {
    const title = (typeof raw === "string" ? raw : typeof raw?.title === "string" ? raw.title : "").trim().slice(0, 80);
    if (!title) continue;
    const hours = Number(raw?.hours);
    ideas.push({ title, ...(Number.isFinite(hours) && hours > 0 && hours <= 3 ? { hours } : {}) });
  }
  return ideas.length ? ideas : null;
}

/**
 * Free-time ideas. The model often answers this one in prose ("Here are three
 * suggestions: 1. Read a book 2. Practice yoga 3. …") rather than JSON, so
 * a numbered list in its answer is read too.
 */
async function askIdeas(complete: Complete): Promise<Idea[] | null> {
  for (const message of ["Free time ideas\nJSON:", "Free time ideas\nJSON:", "Someone has a busy week of work and study.\nJSON:"]) {
    const text = await complete(IDEAS_PROMPT, message);
    const json = jsonIn(text);
    const fromJson = json ? readIdeas(json) : null;
    if (fromJson?.length) return fromJson;
    const listed = ideasInProse(text);
    if (listed.length >= 2) return listed;
  }
  return null;
}

/**
 * Ideas the model wrote as prose: a numbered list ("1. Read a book 2. …"), a
 * bulleted one ("- Read a book - …"), or "activities like reading a book,
 * practicing yoga, or spending time in a park". Titles are tidied ("Rest:
 * Take a nap" → "Take a nap") and a length is kept when the text gives one.
 */
export function ideasInProse(text: string): Idea[] {
  const flat = text.replace(/\s+/g, " ");
  let pieces = [...flat.matchAll(/(?:^|\s)(?:\d[.)]|[-•*])\s+(.+?)(?=\s(?:\d[.)]|[-•*])\s|$)/g)].map((m) => m[1]);
  if (pieces.length < 2) {
    const like = flat.match(/\b(?:like|such as|including)\s+(.+?)(?:\.|$)/i);
    pieces = like ? like[1].split(/,\s*(?:or\s+|and\s+)?|\s+(?:or|and)\s+/) : [];
  }
  return pieces
    .map((piece) => {
      const minutes = piece.match(/(\d+)\s*min/i);
      const hoursText = piece.match(/(\d+(?:\.\d+)?)\s*hours?\b/i);
      const hours = minutes ? Number(minutes[1]) / 60 : hoursText ? Number(hoursText[1]) : /\ban hour\b/i.test(piece) ? 1 : undefined;
      let title = piece
        .replace(/^[A-Z][\w-]*(?:\s[\w-]+){0,2}:\s*/, "") // "Time outdoors: …"
        .replace(/\s*(?:for\s+)?(?:\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?)|an hour)\b/gi, "")
        .replace(/^spend\s+(?:some\s+time\s+)?/i, "")
        // Drop the explanation: "…, such as painting", "… to relax and clear your mind".
        .replace(/,?\s+(?:such as|so that|which|e\.g\.)\s.*$/i, "")
        .replace(/\s+to\s+(?:relax|unwind|recharge|rest|refresh|clear|calm|de-?stress|help|feel)\b.*$/i, "")
        .replace(/[.;,!\s]+$/, "")
        .trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      // Up to the next quarter hour: 20 minutes becomes 30, not 15.
      const rounded = hours && hours > 0 && hours <= 3 ? Math.ceil(hours * 4) / 4 : undefined;
      return { title: title.slice(0, 60), ...(rounded ? { hours: rounded } : {}) };
    })
    .filter((idea) => idea.title.length > 3)
    .slice(0, 4);
}

/** A length the user gave: "for 1 hour", "45 minutes", "1.5 hrs", "half an hour". */
export function statedHours(text: string): number | undefined {
  const lower = text.toLowerCase();
  if (/\bhalf an hour\b/.test(lower)) return 0.5;
  if (/\ban hour and a half\b/.test(lower)) return 1.5;
  if (/\b(?:an|one) hour\b/.test(lower)) return 1;
  const hours = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = lower.match(/\b(\d+)\s*(?:minutes?|mins?)\b/);
  const total = (hours ? Number(hours[1]) : 0) + (minutes ? Number(minutes[1]) / 60 : 0);
  // To the next quarter hour, like the scheduler's slots.
  return total > 0 && total <= 12 ? Math.ceil(total * 4) / 4 : undefined;
}

/** "Review papers" x3 is about one "Review paper". */
const single = (todo: Todo) => (todo.count > 1 ? todo.title.replace(/s$/i, "") : todo.title);

/**
 * The title of the index-th of a to-do: "Review paper: How transformer works"
 * when the user named them in brackets, otherwise "Review paper 2".
 */
function titleOf(todo: Todo, index: number) {
  const names = namesIn(todo.part);
  if (names.length === todo.count && names[index]) return `${single(todo)}: ${names[index]}`;
  return numbered(todo.title, index, todo.count);
}

/** "Read chapter" x3 becomes "Read chapter 1", "Read chapter 2", "Read chapter 3". */
const numbered = (title: string, index: number, count: number) =>
  count > 1 ? `${title.replace(/s$/i, "")} ${index + 1}` : title;

const priorityOf = (part: string) =>
  /\burgent|asap|critical\b/i.test(part) ? "critical" : /\bimportant|high priority\b/i.test(part) ? "high" : "medium";

const formatHours = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)} min` : `${Math.round(hours * 4) / 4} h`;

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Builds a "propose" by asking the model small questions. Returns null when
 * the model found nothing to plan in the message.
 */
export async function planStepByStep(
  complete: Complete,
  message: string,
  now: string,
): Promise<ModelOutput | null> {
  const today = dateOf(now);
  const period = periodOf(message, today);
  const parts = splitParts(message);
  const wantsIdeas = FREE_TIME.test(message);

  // 1. Which parts are to-dos. Limits and the free-time request are handled below.
  const todos: Todo[] = [];
  const unclear: string[] = [];
  for (const part of parts) {
    if (FREE_TIME.test(part) || LIMIT.test(part)) continue;
    // Names in brackets are kept for the titles; the model only sees "3 papers to review".
    const todo = await askJson(complete, ITEM_PROMPT, `Part: ${withoutBrackets(part)}\nJSON:`, readTodo(part));
    if (todo === null) unclear.push(part);
    else if (todo) todos.push(todo);
  }
  if (!todos.length) return null;

  // 2. Sessions for each distinct to-do, asked once per kind.
  const daysLeft = period.dueDate ? Math.max(1, Math.round((Date.parse(period.dueDate) - Date.parse(today)) / 86_400_000) + 1) : undefined;
  const items: PlanItem[] = [];
  const failed: string[] = [];
  for (const todo of todos) {
    const due = dueDateIn(todo.part, today) ?? period.dueDate;
    // The user said how long it takes ("gym for 1 hour"): one sitting of
    // exactly that, rather than the model's own idea of a gym routine.
    const stated = statedHours(todo.part);
    if (stated !== undefined && stated <= 2) {
      for (let index = 0; index < todo.count; index++) {
        items.push({
          title: titleOf(todo, index),
          category: todo.category,
          priority: priorityOf(todo.part),
          dueDate: due,
          steps: [{ title: titleOf(todo, index), hours: stated }],
        });
      }
      continue;
    }
    const detail = [
      todo.category,
      stated !== undefined ? `about ${stated} hours in total` : "",
      daysLeft && todo.category === "study" ? `${daysLeft} days available` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const steps = await askJson(
      complete,
      STEPS_PROMPT,
      // Ask about one of them ("Assignment", not "Assignments": the count is
      // already known, and a plural makes the model ask "how many?").
      [
        `Task: ${single(todo)} (${detail})\nJSON:`,
        // The model refuses some "work" tasks ("specify the details of the
        // assignment") that it estimates readily as "study".
        todo.category === "work"
          ? `Task: ${single(todo)} (study)\nJSON:`
          : `Task: ${single(todo)} (a typical ${todo.category} task; assume the usual amount of work)\nJSON:`,
        `Task: one ${single(todo).toLowerCase()}\nJSON:`,
      ],
      readSteps,
    );
    if (!steps) {
      failed.push(todo.title);
      continue;
    }
    for (let index = 0; index < todo.count; index++) {
      items.push({
        title: titleOf(todo, index),
        category: todo.category,
        priority: priorityOf(todo.part),
        dueDate: due,
        steps,
      });
    }
  }
  if (!items.length) return null;

  // 3. Free-time ideas, if asked for. They go on the calendar too, as
  // low-priority "rest" items: the scheduler puts those in the evening,
  // outside working hours and the daily focus limit.
  const ideas = wantsIdeas ? await askIdeas(complete) : null;
  // Without a length from the model, an activity gets an hour, and the reply says so.
  const guessedLength = ideas?.some((idea) => idea.hours === undefined) ?? false;
  for (const idea of ideas ?? []) {
    const hours = Math.round((idea.hours ?? 1) * 4) / 4;
    items.push({
      title: idea.title,
      category: "rest",
      priority: "low",
      dueDate: period.dueDate,
      steps: [{ title: idea.title, hours }],
    });
  }

  // Stated limits: "max 4 hours a day", "keep Sunday free".
  const constraints: NonNullable<PlanIntent["constraints"]> = { startDate: undefined, endDate: undefined };
  const hoursCap = message.match(/\b(?:max(?:imum)?|at most|no more than|up to)\s+(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/i);
  if (hoursCap) constraints.maxHoursPerDay = Number(hoursCap[1]);
  const freeParts = parts.filter((part) => /\b(keep|leave)\b.*\b(free|off)\b|\bday off\b/i.test(part));
  const lastDay = period.endDate ?? period.dueDate ?? addDays(today, 13);
  const daysOff = freeParts.flatMap((part) => weekdaysNamedIn(part, period.startDate ?? today, lastDay));
  if (daysOff.length) constraints.daysOff = [...new Set(daysOff)];
  if (period.startDate) constraints.startDate = period.startDate;
  if (period.endDate) constraints.endDate = period.endDate;

  const listing = todos
    .filter((todo) => !failed.includes(todo.title))
    .map((todo) => (todo.count > 1 ? `${todo.count}× ${todo.title}` : todo.title))
    .join(", ");
  const reply = [
    `Your plan is on your calendar: ${listing}${period.dueDate ? `, all done by ${shortDate(period.dueDate)}` : ""}. Tell me what to change, or say "undo the plan".`,
    ideas?.length
      ? `I also added some time for yourself in the evenings: ${ideas
          .map((idea) => `${idea.title} (${formatHours(idea.hours ?? 1)})`)
          .join(", ")}.${guessedLength ? " I gave each about an hour." : ""} If you'd rather do something else or at another time, just tell me.`
      : "",
    failed.length ? `I couldn't estimate ${failed.join(", ")}. Tell me roughly how long it takes and I'll add it.` : "",
    unclear.length ? `I wasn't sure what you meant by "${unclear.join('", "')}".` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    action: "propose",
    reply,
    revise: false,
    plan: { items, ...(Object.values(constraints).some((value) => value !== undefined) ? { constraints } : {}) },
  };
}
