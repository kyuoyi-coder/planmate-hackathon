/**
 * Helpers for "floating" local dates ("YYYY-MM-DD") and date-times
 * ("YYYY-MM-DDTHH:mm"). They carry no timezone, so the same string means the
 * same wall-clock time on the server and in the browser. Because they are
 * zero-padded ISO strings, plain string comparison orders them correctly.
 */

const pad = (value: number) => String(value).padStart(2, "0");

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  DATE_PATTERN.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const isDateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  DATE_TIME_PATTERN.test(value) &&
  !Number.isNaN(Date.parse(`${value}:00Z`));

export const dateOf = (dateTime: string) => dateTime.slice(0, 10);

export const minutesOf = (dateTime: string) =>
  Number(dateTime.slice(11, 13)) * 60 + Number(dateTime.slice(14, 16));

export const toDateTime = (date: string, minutes: number) =>
  `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number) {
  const next = toUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export const diffDays = (from: string, to: string) =>
  Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string) => toUtc(date).getUTCDay();

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const weekdayName = (date: string) => WEEKDAYS[weekdayOf(date)];

/** Monday of the week containing `date`. */
export const startOfWeek = (date: string) =>
  addDays(date, -((weekdayOf(date) + 6) % 7));

export const formatClock = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Local wall-clock time of a JS Date as a floating date-time string. */
export const toNaive = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Parse a floating date or date-time string as local wall-clock time. */
export function fromNaive(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const hours = value.length > 10 ? Number(value.slice(11, 13)) : 0;
  const minutes = value.length > 10 ? Number(value.slice(14, 16)) : 0;
  return new Date(year, month - 1, day, hours, minutes);
}
