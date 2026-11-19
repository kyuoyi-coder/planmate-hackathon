import { addDays, dateOf, minutesOf, weekdayName, weekdayOf, WEEKDAYS } from "@/lib/time";
import { dueDateIn } from "./dates";
import { jsonIn, statedHours, type Complete } from "./stepwise";
import { CATEGORIES, type Category, type EventRequest, type ModelOutput } from "./types";

/**
 * Fixed events ("I have a meeting every Friday at 2pm").
 *
 * Unlike planned work, an event has an exact time and may repeat. For a
 * small model the work is split: code reads the time phrases (the clock
 * time, the day, "every", "for 1 hour"), which must be exact; the model
 * says what the event is ("Weekly meeting", work) from the user's words.
 */

/** How many weeks of a weekly event are put on the calendar. */
export const WEEKLY_OCCURRENCES = 12;

const DAY_NAMES = WEEKDAYS.map((day) => day.toLowerCase());
const DAY_PATTERN = DAY_NAMES.join("|");

/**
 * The clock time in a message: "2pm", "2:30 pm", "14:00", "at 2", "noon".
 * Times after "by", "before", "until" or "due" are deadlines, not events.
 */
export function clockTimeIn(text: string): { start: number; end?: number } | null {
  const lower = text.toLowerCase();
  const time = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
  const toMinutes = (hour: string, minute: string | undefined, half: string | undefined, hint?: number) => {
    let h = Number(hour);
    const m = Number(minute ?? 0);
    if (h > 23 || m > 59) return null;
    const meridiem = half?.replace(/\./g, "");
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    // "at 2" with no am/pm: an afternoon meeting, not 2 in the morning.
    if (!meridiem && !minute && h >= 1 && h <= 7) h += 12;
    if (hint !== undefined && !meridiem && h < hint / 60) h += 12;
    return h * 60 + m;
  };

  if (/\bnoon\b|\bmidday\b/.test(lower) && !/\b(by|before|until|due)\s+(noon|midday)\b/.test(lower)) {
    return { start: 12 * 60 };
  }
  // A range: "2pm to 3:30pm", "14:00-15:00", "from 2 until 4pm".
  const range = lower.match(new RegExp(String.raw`(?:from\s+|at\s+)?\b${time}\s*(?:-|–|to|until|till)\s*${time}`));
  if (range && (range[3] || range[6] || range[2] || range[5])) {
    // "2 to 4pm": the first time takes the second one's am/pm.
    const start = toMinutes(range[1], range[2], range[3] ?? range[6]);
    const end = start === null ? null : toMinutes(range[4], range[5], range[6], start);
    if (start !== null && end !== null && end > start) return { start, end };
  }
  for (const match of lower.matchAll(new RegExp(String.raw`(\b(?:by|before|until|due|at|@)\s+)?\b${time}(?![\d:])`, "g"))) {
    const [, lead, hour, minute, half] = match;
    if (lead && /by|before|until|due/.test(lead)) continue;
    // A bare number is only a time with am/pm, minutes, or "at": not "3 papers".
    if (!half && !minute && !lead) continue;
    // "for 2 hours" / "1h" are lengths.
    const after = lower.slice((match.index ?? 0) + match[0].length);
    if (/^\s*(h|hrs?|hours?|mins?|minutes?)\b/.test(after)) continue;
    const start = toMinutes(hour, minute, half);
    if (start !== null) return { start };
  }
  return null;
}

/** The parts of an event request that code reads exactly; null if it isn't one. */
export function parseEventRequest(text: string, now: string) {
  const lower = text.toLowerCase();
  // "Review the papers by Friday at 5pm" is a deadline for work, not an event.
  if (/\b(by|before|until|due|deadline)\b/.test(lower)) return null;
  const time = clockTimeIn(text);
  if (!time) return null;
  const today = dateOf(now);

  const everyDay = lower.match(new RegExp(String.raw`\b(?:every|each|on)\s+(${DAY_PATTERN})s?\b|\b(${DAY_PATTERN})s\b`));
  // "every Friday", "each Friday", "on Fridays", "weekly".
  const weekly =
    Boolean(everyDay && (/\b(every|each)\b/.test(everyDay[0]) || /days$/.test(everyDay[0]))) ||
    /\bweekly\b|\bevery week\b/.test(lower);
  let date: string | undefined;
  const namedDay = everyDay?.[1] ?? everyDay?.[2];
  if (namedDay) {
    const weekday = DAY_NAMES.indexOf(namedDay);
    date = addDays(today, (weekday - weekdayOf(today) + 7) % 7);
  } else {
    date = dueDateIn(lower, today);
  }
  if (!date) {
    // "every week at 2pm" with no day: the next such time from today.
    if (!weekly) return null;
    date = today;
  }
  // A repeating or "on Friday" event already past today starts next week.
  // "Today at 9am" stays today: the user is putting it on their calendar.
  const nowMinutes = minutesOf(now);
  if (date === today && time.start <= nowMinutes && (weekly || namedDay)) date = addDays(date, 7);

  const stated = statedHours(lower.replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/g, ""));
  const minutes = time.end !== undefined ? time.end - time.start : stated !== undefined && stated <= 12 ? Math.round(stated * 60) : 60;
  const start = `${String(Math.floor(time.start / 60)).padStart(2, "0")}:${String(time.start % 60).padStart(2, "0")}`;
  return {
    date,
    start,
    minutes,
    repeat: weekly ? ("weekly" as const) : ("none" as const),
    lengthGiven: time.end !== undefined || stated !== undefined,
  };
}

const TITLE_PROMPT = `Name the event in the user's message and say what kind it is. Reply with JSON only, like the examples. The category is "work", "study", "personal", "exercise" or "rest". Never ask questions.

Message: I have a meeting on every Friday at 2pm
JSON: {"title":"Weekly meeting","category":"work"}

Message: dentist appointment tomorrow at 10am
JSON: {"title":"Dentist appointment","category":"personal"}

Message: football with friends on Saturday 5pm
JSON: {"title":"Football with friends","category":"exercise"}

Message: statistics lecture every Monday 9:00 to 10:30
JSON: {"title":"Statistics lecture","category":"study"}`;

export const KNOWN_EVENTS = /\b(meeting|stand-?up|call|lecture|class|seminar|appointment|interview|lunch|dinner|party|training|practice|session|workshop|exam|test)\b/i;
const CATEGORY_SET = new Set<string>(CATEGORIES);

/** The kind of event from its name, when the model only gave the name. */
function categoryOf(text: string): Category {
  if (/\b(gym|football|soccer|basketball|yoga|run|running|swim\w*|training|workout|tennis|badminton)\b/i.test(text)) return "exercise";
  if (/\b(lecture|class|seminar|tutorial|exam|lab|course|study)\b/i.test(text)) return "study";
  if (/\b(dentist|doctor|appointment|dinner|lunch|party|birthday|family|date)\b/i.test(text)) return "personal";
  return "work";
}

const formatClock = (start: string, minutes: number) => {
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + minutes;
  return `${start}–${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
};

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * An "event" action for a message like "I have a meeting every Friday at
 * 2pm", or null when the message has no clock time and day (so it is not
 * a fixed event).
 */
export async function eventStepByStep(
  complete: Complete,
  message: string,
  now: string,
  /** A name the model already gave in a tool call: "Weekly meeting". */
  givenTitle?: string,
): Promise<ModelOutput | null> {
  const parsed = parseEventRequest(message, now);
  if (!parsed) return null;

  // "Weekly meeting, every Friday 14:00-15:00": the name, without the time it repeats.
  let title: string | undefined = givenTitle?.split(/[,(]|\s+every\s+|\s+on\s+|\s+at\s+/i)[0].trim().slice(0, 80) || undefined;
  let category: Category = categoryOf(title ?? message);
  for (let attempt = 0; attempt < 2 && !title; attempt++) {
    const json = jsonIn(await complete(TITLE_PROMPT, `Message: ${message}\nJSON:`));
    if (typeof json?.title === "string" && json.title.trim()) {
      title = json.title.trim().slice(0, 80);
      if (typeof json.category === "string" && CATEGORY_SET.has(json.category)) category = json.category as Category;
    }
  }
  // The model gave no name: the user's own word for it ("meeting"), else "Event".
  if (!title) {
    const word = message.match(KNOWN_EVENTS)?.[1];
    title = word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "Event";
    if (parsed.repeat === "weekly") title = `Weekly ${title.toLowerCase()}`;
  }

  const event: EventRequest = {
    title,
    date: parsed.date,
    start: parsed.start,
    minutes: parsed.minutes,
    repeat: parsed.repeat,
    category,
    lengthAssumed: !parsed.lengthGiven,
  };
  return { action: "event", reply: "", events: [event] };
}

/** Every calendar copy of an event: one, or WEEKLY_OCCURRENCES a week apart. */
export function occurrencesOf(event: EventRequest) {
  const count = event.repeat === "weekly" ? WEEKLY_OCCURRENCES : 1;
  const [h, m] = event.start.split(":").map(Number);
  return Array.from({ length: count }, (_, week) => {
    const date = addDays(event.date, week * 7);
    const startMinutes = h * 60 + m;
    const endMinutes = startMinutes + event.minutes;
    const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return {
      start: `${date}T${clock(startMinutes)}`,
      // Past midnight: cut at the end of the day.
      end: endMinutes >= 24 * 60 ? `${date}T23:59` : `${date}T${clock(endMinutes)}`,
    };
  });
}

/** "Weekly meeting every Friday 14:00–15:00, from Fri 20 Nov" for replies and the model's context. */
export function describeEvent(event: Pick<EventRequest, "title" | "date" | "start" | "minutes" | "repeat">) {
  return event.repeat === "weekly"
    ? `"${event.title}" every ${weekdayName(event.date)} ${formatClock(event.start, event.minutes)}, from ${shortDate(event.date)}`
    : `"${event.title}" on ${shortDate(event.date)} ${formatClock(event.start, event.minutes)}`;
}

/** A request to cancel a fixed event: "cancel the weekly meeting". */
export const CANCEL_REQUEST = /\b(cancel|remove|delete|drop|stop|no more|don'?t have)\b/i;

/** Which listed events a message names, by the words of their titles. */
export function eventsNamedIn(message: string, events: { ref: string; title: string }[]) {
  const said = new Set(message.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map((w) => w.replace(/s$/, "")));
  const generic = new Set(["weekly", "the", "a", "my", "with", "event", "every"]);
  return events.filter((event) =>
    event.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !generic.has(word))
      .some((word) => said.has(word.replace(/s$/, ""))),
  );
}
