import { addDays, dateOf, weekdayOf } from "@/lib/time";
import { weekdaysNamedIn } from "./dates";
import { jsonIn, type Complete } from "./stepwise";
import type { ModelOutput, PlanIntent, PlanItem } from "./types";

/**
 * Changing the current plan step by step, for small models.
 *
 * "Move the 3 papers and 2 assignments to next week; this week I only need
 * ML, gym and some activities" needs the whole plan rewritten, which a small
 * model can't do in one answer. Instead:
 *
 * 1. the message is cut into phrases ("remove review 3 papers and 2
 *    assignments to next week", "this week I only need to study ML", …);
 * 2. code finds which items of the current plan each phrase names, from the
 *    user's own words ("papers" → Review paper 1-3, "activities" → the
 *    free-time items); items nobody mentions are never touched;
 * 3. the model reads each phrase and decides: keep, next-week or drop. A
 *    phrase that is only a list ("gym", "and the yoga") carries on the
 *    decision of the phrase before it.
 */

type Decision = "keep" | "next-week" | "drop";

const DECISION_PROMPT = `Read one phrase from a user who is changing their plan, and say what they want done with the things it mentions. Reply with JSON only, like the examples. The decision is "keep" (still this week), "next-week" (move to next week) or "drop" (delete). "Remove X to next week" or "push X to next week" means next-week. Never ask questions.

Phrase: push the 2 essays to next week
JSON: {"decision":"next-week"}

Phrase: this week I only want yoga
JSON: {"decision":"keep"}

Phrase: some relaxing things in the evening
JSON: {"decision":"keep"}

Phrase: remove the reading to next week
JSON: {"decision":"next-week"}

Phrase: delete the yoga
JSON: {"decision":"drop"}

Phrase: cancel the swimming, I'm sick
JSON: {"decision":"drop"}`;

/** Words that change something; a phrase without any is just more names. */
const CUE = /\b(move|moving|push|postpone|delay|later|reschedule|remove|drop|delete|cancel|skip|don'?t|do not|no longer|anymore|keep|only|need|want|stay|still|next week|this week|instead)\b/i;

/** A message that looks like it changes the plan rather than asks for something else. */
export const CHANGE_REQUEST = /\b(move|push|postpone|delay|reschedule|remove|drop|delete|cancel|skip|next week|only need|only want|instead|don'?t want|no longer)\b/i;

const FREE_TIME_WORDS = /\b(activit(y|ies)|free[- ]time|free times|relax\w*|hobb(y|ies)|leisure|evenings?|fun stuff|rest)\b/i;
const STOP = new Set(["the", "a", "an", "of", "for", "to", "and", "my", "your", "some", "do", "doing", "complete", "finish", "study", "studying", "session", "practice", "take", "go", "get"]);

/** Too common to pick out one item by: "what is a LLM?" is named by "llm". */
const GENERIC = new Set(["what", "how", "why", "who", "when", "work", "works", "about", "with", "this", "that", "into", "from", "intro", "introduction"]);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1") : word));

/** "Review paper: How transformer works" and "Review paper 2" belong to the "Review paper" family. */
const familyOf = (title: string) => title.replace(/:.*$/, "").replace(/\s+\d+$/, "").trim();

/** Cuts a change request into phrases: commas, full stops, and "and" before a new clause. */
export function splitPhrases(text: string) {
  return text
    .split(/[,;\n]|\.(?:\s+|$)|\bbut\b|\band\s+(?=(?:this|next) week\b|i\b|we\b|let'?s\b|then\b)/i)
    .map((phrase) => phrase.replace(/^\s*(and|also|then)\s+/i, "").trim())
    .filter((phrase) => phrase.length > 1);
}

/** Which items a phrase names. Numbers pick one of a family: "paper 2". */
export function itemsNamedIn(phrase: string, items: PlanItem[]): number[] {
  const said = new Set(words(phrase));
  const freeTime = FREE_TIME_WORDS.test(phrase);
  const named: number[] = [];
  items.forEach((item, index) => {
    if (item.category === "rest" && freeTime) {
      named.push(index);
      return;
    }
    const key = words(familyOf(item.title)).filter((word) => !STOP.has(word) && !/^\d+$/.test(word));
    const ownName = words(item.title.replace(/^[^:]*:/, "")).filter((word) => !STOP.has(word) && word.length > 2);
    if (key.some((word) => said.has(word)) || (ownName.length > 0 && ownName.every((word) => said.has(word)))) {
      named.push(index);
    }
  });
  // "the LLM paper": only the paper whose own name was said.
  const ownWords = (title: string) =>
    words(title.includes(":") ? title.replace(/^[^:]*:/, "") : "").filter((word) => word.length > 2 && !STOP.has(word) && !GENERIC.has(word));
  const byName = named.filter((index) => ownWords(current(index)).some((word) => said.has(word)));
  const narrowed = named.filter(
    (index) =>
      byName.includes(index) ||
      !byName.some((other) => familyOf(current(other)) === familyOf(current(index))),
  );
  function current(index: number) {
    return items[index].title;
  }

  // "paper 2" / "assignment 1": only that one of the family.
  return narrowed.filter((index) => {
    const number = items[index].title.match(/\s(\d+)$/)?.[1];
    const family = words(familyOf(items[index].title)).at(-1);
    if (!family) return true;
    const picked = [...phrase.toLowerCase().matchAll(new RegExp(`\\b${family}s?\\s+(\\d+)\\b`, "g"))].map((m) => m[1]);
    return picked.length === 0 || (number !== undefined && picked.includes(number));
  });
}

const readDecision = (json: Record<string, unknown>): Decision | null => {
  const value = String(json.decision ?? "").toLowerCase().replace(/[\s_]/g, "-");
  if (value === "keep" || value === "next-week" || value === "drop") return value;
  if (value === "remove" || value === "delete") return "drop";
  if (value === "move" || value === "later" || value === "postpone") return "next-week";
  return null;
};

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Review paper 1", "Review paper 2" → "3× Review paper" when the whole family is listed. */
function listTitles(titles: string[]) {
  const counts = new Map<string, number>();
  for (const title of titles) counts.set(familyOf(title), (counts.get(familyOf(title)) ?? 0) + 1);
  return [...counts].map(([family, count]) => (count > 1 ? `${count}× ${family}` : titles.find((t) => familyOf(t) === family)!)).join(", ");
}

/**
 * The current plan changed as the message asks, or null when nothing in it
 * was named (the message is about something else).
 */
export async function revisePlanStepByStep(
  complete: Complete,
  message: string,
  now: string,
  current: PlanIntent,
): Promise<ModelOutput | null> {
  const today = dateOf(now);
  const sunday = addDays(today, (7 - weekdayOf(today)) % 7);
  const nextMonday = addDays(sunday, 1);
  const nextSunday = addDays(sunday, 7);

  const decisions = new Map<number, Decision>();
  let carried: Decision | null = null;
  for (const phrase of splitPhrases(message)) {
    const named = itemsNamedIn(phrase, current.items);
    if (!named.length) continue;
    let decision: Decision | null = null;
    if (CUE.test(phrase)) {
      for (let attempt = 0; attempt < 2 && decision === null; attempt++) {
        const json = jsonIn(await complete(DECISION_PROMPT, `Phrase: ${phrase}\nJSON:`));
        decision = json ? readDecision(json) : null;
      }
      carried = decision ?? carried;
    } else {
      // Just more names ("gym", "and the yoga"): same as the phrase before.
      decision = carried;
    }
    if (decision === null) continue;
    for (const index of named) decisions.set(index, decision);
  }

  const moved: string[] = [];
  const dropped: string[] = [];
  const items: PlanItem[] = [];
  current.items.forEach((item, index) => {
    const decision = decisions.get(index) ?? "keep";
    if (decision === "drop") {
      dropped.push(item.title);
      return;
    }
    if (decision === "next-week" && !(item.startDate && item.startDate >= nextMonday)) {
      moved.push(item.title);
      items.push({
        ...item,
        startDate: nextMonday,
        dueDate: item.dueDate && item.dueDate > nextSunday ? item.dueDate : nextSunday,
      });
      return;
    }
    items.push(item);
  });

  // Limits stated in the same message: "max 4 hours a day", "keep Sunday free".
  const constraints = { ...(current.constraints ?? { startDate: undefined, endDate: undefined }) };
  let limitsChanged = false;
  const cap = message.match(/\b(?:max(?:imum)?|at most|no more than|up to)\s+(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/i);
  if (cap) {
    constraints.maxHoursPerDay = Number(cap[1]);
    limitsChanged = true;
  }
  const freeDays = splitPhrases(message)
    .filter((phrase) => /\b(keep|leave)\b.*\b(free|off)\b|\bday off\b/i.test(phrase))
    .flatMap((phrase) => weekdaysNamedIn(phrase, today, moved.length ? nextSunday : sunday));
  if (freeDays.length) {
    constraints.daysOff = [...new Set([...(constraints.daysOff ?? []), ...freeDays])];
    limitsChanged = true;
  }

  if (!moved.length && !dropped.length && !limitsChanged) return null;
  // Everything dropped: that is taking the whole plan off the calendar.
  if (!items.length) {
    return { action: "cancel", reply: "Done, I took the whole plan off your calendar." };
  }
  if (moved.length && constraints.endDate && constraints.endDate < nextSunday) constraints.endDate = nextSunday;

  const thisWeek = items.filter((item) => !(item.startDate && item.startDate >= nextMonday)).map((item) => item.title);
  const reply = [
    "Done, I changed your plan.",
    moved.length ? `Moved to next week (${shortDate(nextMonday)} – ${shortDate(nextSunday)}): ${listTitles(moved)}.` : "",
    dropped.length ? `Removed: ${listTitles(dropped)}.` : "",
    limitsChanged ? `New limits: ${[cap ? `max ${constraints.maxHoursPerDay} h a day` : "", freeDays.length ? `${freeDays.map(shortDate).join(", ")} kept free` : ""].filter(Boolean).join(", ")}.` : "",
    thisWeek.length ? `This week: ${listTitles(thisWeek)}.` : "",
    `Tell me if you want anything else changed, or say "undo the plan".`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    action: "propose",
    reply,
    revise: true,
    plan: { items, ...(Object.values(constraints).some((value) => value !== undefined) ? { constraints } : {}) },
  };
}
