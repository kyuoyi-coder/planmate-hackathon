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
