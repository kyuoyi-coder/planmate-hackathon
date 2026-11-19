import { addDays, weekdayName, weekdayOf, WEEKDAYS } from "@/lib/time";

const DAY_NAMES = WEEKDAYS.map((day) => day.toLowerCase());
const SHORT_DAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const dayIndex = (word: string) =>
  DAY_NAMES.indexOf(word) !== -1 ? DAY_NAMES.indexOf(word) : SHORT_DAYS[word];
const DAY_PATTERN = [...DAY_NAMES, ...Object.keys(SHORT_DAYS)].join("|");

/** The next date (today included) that falls on `weekday` (0 = Sunday). */
const nextWeekday = (today: string, weekday: number) =>
  addDays(today, (weekday - weekdayOf(today) + 7) % 7);

const label = (date: string) => `${date} (${weekdayName(date)})`;

/**
 * Turns the time phrases in the user's message ("this week", "by Friday",
 * "next Tuesday", "in 3 days") into exact dates, using the same conventions
 * as the scheduler: a week runs Monday to Sunday and "next week" never
 * touches the current one.
 *
 * Small models are unreliable at this arithmetic and tend to ask the user
 * for a deadline they already gave; handing them the answer removes that.
 * Returns one line per phrase found, or an empty list.
 */
export function resolveUserDates(text: string, today: string): string[] {
  const lower = text.toLowerCase();
  const sunday = nextWeekday(today, 0);
  const lines: string[] = [];
  const add = (line: string) => {
    if (!lines.includes(line)) lines.push(line);
  };

  if (/\btoday\b|\btonight\b/.test(lower)) add(`"today" = ${label(today)}`);
  if (/\btomorrow\b/.test(lower)) add(`"tomorrow" = ${label(addDays(today, 1))}`);
  if (/\bthis week\b(?!end)/.test(lower)) {
    add(
      `"this week" = ${label(today)} to ${label(sunday)}. Plan everything in this period and use dueDate ${sunday} for work with no other deadline.`,
    );
  }
  if (/\b(this )?weekend\b/.test(lower) && !/\bnext weekend\b/.test(lower)) {
    const saturday = weekdayOf(today) === 0 ? today : nextWeekday(today, 6);
    add(`"this weekend" = ${label(saturday)} to ${label(sunday)}`);
  }
  if (/\bnext week\b/.test(lower)) {
    const monday = addDays(sunday, 1);
    const end = addDays(sunday, 7);
    add(
      `"next week" = ${label(monday)} to ${label(end)}. Use constraints startDate ${monday} and endDate ${end}, and dueDate ${end} for work with no other deadline.`,
    );
  }
  if (/\bnext weekend\b/.test(lower)) {
    add(`"next weekend" = ${label(addDays(sunday, 6))} to ${label(addDays(sunday, 7))}`);
  }
  if (/\b(end of (the )?month|this month)\b/.test(lower)) {
    const [year, month] = today.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    add(`"end of the month" = ${label(last)}`);
  }
  for (const match of lower.matchAll(/\b(?:in|within|next) (\d{1,2}) days\b/g)) {
    add(`"${match[0]}" = by ${label(addDays(today, Math.max(0, Number(match[1]) - 1)))}`);
  }
  for (const match of lower.matchAll(new RegExp(`\\b(next |this |on |by |before |until )?(${DAY_PATTERN})\\b`, "g"))) {
    const weekday = dayIndex(match[2]);
    if (weekday === undefined) continue;
    // "sat", "sun", "wed" are also ordinary words: only trust the short
    // forms after "on", "by", "next" and so on.
    if (!DAY_NAMES.includes(match[2]) && !match[1]) continue;
    // "next Tuesday" is the one in next week; "Tuesday" / "by Tuesday" is the coming one.
    const date =
      match[1]?.trim() === "next"
        ? nextWeekday(addDays(sunday, 1), weekday)
        : nextWeekday(today, weekday);
    add(`"${match[0].trim()}" = ${label(date)}`);
  }
  for (const match of lower.matchAll(/\b(?:the )?(\d{1,2})(st|nd|rd|th)\b/g)) {
    const day = Number(match[1]);
    for (let offset = 0; offset < 62; offset++) {
      const date = addDays(today, offset);
      if (Number(date.slice(8)) === day) {
        add(`"${match[0]}" = ${label(date)}`);
        break;
      }
    }
  }
  return lines;
}

export type Period = { dueDate?: string; startDate?: string; endDate?: string };

/**
 * The period a whole message covers: "this week" ends on Sunday, "next week"
 * is next Monday to Sunday, "in 5 days" / "next 3 days" ends that many days
 * from today (today included), and a named day ("by Friday") is a deadline.
 */
export function periodOf(text: string, today: string): Period {
  const lower = text.toLowerCase();
  const sunday = nextWeekday(today, 0);
  if (/\bnext week\b/.test(lower)) {
    return { startDate: addDays(sunday, 1), endDate: addDays(sunday, 7), dueDate: addDays(sunday, 7) };
  }
  const days = lower.match(/\b(?:in|within|next|for|over) (?:the next )?(\d{1,2}|two|three|four|five|six|seven) (?:working |work |week)?days\b/);
  if (days) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const count = Number(days[1]) || words[days[1]] || 1;
    // "5 working days" skips the weekend.
    if (/working days|work days|weekdays/.test(days[0])) {
      let date = today;
      let left = weekdayOf(today) % 6 === 0 ? count : count - 1;
      while (left > 0) {
        date = addDays(date, 1);
        if (weekdayOf(date) % 6 !== 0) left--;
      }
      return { dueDate: date, endDate: date };
    }
    const end = addDays(today, Math.max(0, count - 1));
    return { dueDate: end, endDate: end };
  }
  if (/\bthis week\b(?!end)|\bwithin (?:the|this) week\b/.test(lower)) return { dueDate: sunday, endDate: sunday };
  const due = dueDateIn(lower, today);
  return due ? { dueDate: due } : {};
}

/** A deadline named in one part of a message: "by Friday", "next Tuesday", "tomorrow", "the 25th". */
export function dueDateIn(text: string, today: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\btoday\b|\btonight\b/.test(lower)) return today;
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  const named = lower.match(new RegExp(`\\b(next |this |on |by |before |until )?(${DAY_PATTERN})\\b`));
  if (named && (DAY_NAMES.includes(named[2]) || named[1])) {
    const weekday = dayIndex(named[2]);
    if (weekday !== undefined) {
      const sunday = nextWeekday(today, 0);
      return named[1]?.trim() === "next" ? nextWeekday(addDays(sunday, 1), weekday) : nextWeekday(today, weekday);
    }
  }
  const nth = lower.match(/\b(?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (nth) {
    for (let offset = 0; offset < 62; offset++) {
      const date = addDays(today, offset);
      if (Number(date.slice(8)) === Number(nth[1])) return date;
    }
  }
  return undefined;
}

/** Every date in [from, to] that falls on one of the weekdays named in `text` ("keep Sunday free"). */
export function weekdaysNamedIn(text: string, from: string, to: string): string[] {
  const lower = text.toLowerCase();
  const wanted = DAY_NAMES.map((name, index) => (new RegExp(`\\b${name}s?\\b`).test(lower) ? index : -1)).filter((i) => i >= 0);
  if (/\bweekends?\b/.test(lower)) wanted.push(0, 6);
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (wanted.includes(weekdayOf(date))) dates.push(date);
  }
  return dates;
}
