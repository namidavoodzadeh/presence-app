// E32: the weekly check-in schedule (app v2 boards CheckIn, CheckInNew, BridgeHome, BridgeSend). Pure: no
// database, no clock but the `now` it is given. A check-in is a standing time to talk with one person;
// it holds no message text, so nothing in it can reach the other side except "a check-in is due" (law 10).

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = typeof WEEKDAYS[number];

export const REPEATS = ["weekly", "fortnightly", "monthly"] as const;
export type Repeats = typeof REPEATS[number];

/**
 * weekly: every `day`. fortnightly (E36): every second `day`, counted from the first `day` on or after `anchor` (the date the
 * repeat was set, YYYY-MM-DD in `tz`). monthly (E36): the first `day` of each month (the 1st to the 7th).
 */
export interface Schedule {
  repeats: Repeats;
  /** Only fortnightly carries it; weekly and monthly leave it out. */
  anchor?: string;
  day: Weekday;
  time: string; // "HH:MM", 24 hour, in `tz`
  tz: string;
  remind_other: boolean;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Returns the clean schedule, or the name of the first bad field. `remind_other` defaults to true. */
export function parseSchedule(b: Record<string, unknown>, fallbackTz: string): Schedule | { invalid: string } {
  const repeats = b.repeats ?? "weekly";
  if (typeof repeats !== "string" || !(REPEATS as readonly string[]).includes(repeats)) return { invalid: "repeats" };
  if (!WEEKDAYS.includes(b.day as Weekday)) return { invalid: "day" };
  if (typeof b.time !== "string" || !TIME.test(b.time)) return { invalid: "time" };
  const tz = b.tz === undefined ? fallbackTz : b.tz;
  if (typeof tz !== "string" || !validZone(tz)) return { invalid: "tz" };
  if (b.remind_other !== undefined && typeof b.remind_other !== "boolean") return { invalid: "remind_other" };
  return { repeats: repeats as Repeats, day: b.day as Weekday, time: b.time, tz, remind_other: b.remind_other !== false };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** E36: the one-date form `{ on: "YYYY-MM-DD", time, tz?, remind_other? }` (no repeats, no day). Returns the clean date or the bad field. */
export interface DatedCheckIn { on: string; time: string; tz: string; remind_other: boolean }
export function parseDated(b: Record<string, unknown>, fallbackTz: string, now: number): DatedCheckIn | { invalid: string } {
  if (b.repeats !== undefined) return { invalid: "repeats" };
  if (b.day !== undefined) return { invalid: "day" };
  const m = typeof b.on === "string" ? DATE.exec(b.on) : null;
  if (!m) return { invalid: "on" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return { invalid: "on" };
  if (typeof b.time !== "string" || !TIME.test(b.time)) return { invalid: "time" };
  const tz = b.tz === undefined ? fallbackTz : b.tz;
  if (typeof tz !== "string" || !validZone(tz)) return { invalid: "tz" };
  if (b.remind_other !== undefined && typeof b.remind_other !== "boolean") return { invalid: "remind_other" };
  const out = { on: b.on as string, time: b.time, tz, remind_other: b.remind_other !== false };
  if (datedAt(out) <= now) return { invalid: "on" };   // a date that has passed is not a check-in to come
  return out;
}

/** The instant a dated check-in falls (ms since epoch). */
export function datedAt(d: { on: string; time: string; tz: string }): number {
  const [y, mo, da] = d.on.split("-").map(Number), [hh, mm] = d.time.split(":").map(Number);
  return zonedToUtc(y, mo, da, hh, mm, d.tz);
}

/** Today's date in `tz` as YYYY-MM-DD: the anchor a new fortnightly repeat counts from. */
export function todayIn(tz: string, now: number): string {
  const p = parts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /[A-Za-z]/.test(tz);
  } catch {
    return false;
  }
}

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}

/** The instant at which the wall clock in `tz` reads y-m-d hh:mm (the earlier one if a change makes it ambiguous). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wall - shown;
  }
  return guess;
}

/** The next time this check-in falls, strictly after `now` (ms since epoch). */
export function nextOccurrence(s: Schedule, now: number): number {
  const [hh, mm] = s.time.split(":").map(Number);
  const here = parts(now, s.tz);
  const dayIndex = WEEKDAYS.indexOf(s.day);
  // Fortnightly counts in two-week steps from the first `day` on or after the anchor.
  let first = 0;
  if (s.repeats === "fortnightly") {
    const m = DATE.exec(s.anchor ?? "") ?? DATE.exec(todayIn(s.tz, now))!;
    const a = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    first = Math.round(a / 86_400_000) + ((dayIndex - new Date(a).getUTCDay() + 7) % 7);
  }
  for (let add = 0; add <= 70; add++) {
    const cal = new Date(Date.UTC(here.year, here.month - 1, here.day + add));
    if (cal.getUTCDay() !== dayIndex) continue;
    if (s.repeats === "monthly" && cal.getUTCDate() > 7) continue;
    if (s.repeats === "fortnightly") {
      const n = Math.round(cal.getTime() / 86_400_000) - first;
      if (n < 0 || n % 14 !== 0) continue;
    }
    const at = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hh, mm, s.tz);
    if (at > now) return at;
  }
  throw new Error("no next occurrence");
}

/** Whole calendar days from today to the check-in, in the schedule's own zone (0 = today). */
export function daysUntil(s: Schedule, now: number): number {
  const at = parts(nextOccurrence(s, now), s.tz), here = parts(now, s.tz);
  return Math.round((Date.UTC(at.year, at.month - 1, at.day) - Date.UTC(here.year, here.month - 1, here.day)) / 86_400_000);
}

export const REMIND_LEAD_MS = 60 * 60_000; // the other person is nudged one hour before

/** The reminder falls due once the next occurrence is within the lead, and not before; returns that occurrence or null. */
export function reminderDue(s: Schedule, now: number): number | null {
  if (!s.remind_other) return null;
  const at = nextOccurrence(s, now);
  return at - now <= REMIND_LEAD_MS ? at : null;
}

/** The home row: "Thursdays, 7 pm · next in 3 days · 2 things parked" is built by the app from these numbers. */
export function homeRow(s: Schedule, parked: number, now: number) {
  const at = nextOccurrence(s, now);
  return { repeats: s.repeats, day: s.day, time: s.time, tz: s.tz, next_at: new Date(at).toISOString(), next_in_days: daysUntil(s, now), parked };
}
