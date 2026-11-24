import { assert, assertEquals } from "jsr:@std/assert@1";
import { daysUntil, homeRow, nextOccurrence, parseSchedule, reminderDue, type Schedule } from "../engine/checkin/schedule.ts";

const thu7: Schedule = { repeats: "weekly", day: "thursday", time: "19:00", tz: "Asia/Tehran", remind_other: true };
// Sunday 8 Nov 2026, 10:00 Tehran (+03:30) = 06:30 UTC
const sun = Date.UTC(2026, 10, 8, 6, 30);

Deno.test("E32 parse: defaults, and the first bad field is named", () => {
  assertEquals(parseSchedule({ day: "thursday", time: "19:00" }, "Asia/Tehran"), thu7);
  for (const [b, f] of [[{ day: "thu", time: "19:00" }, "day"], [{ day: "monday", time: "7pm" }, "time"],
    [{ day: "monday", time: "24:00" }, "time"], [{ day: "monday", time: "19:00", tz: "+03:30" }, "tz"],
    [{ day: "monday", time: "19:00", repeats: "daily" }, "repeats"],
    [{ day: "monday", time: "19:00", remind_other: "yes" }, "remind_other"]] as const) {
    assertEquals(parseSchedule(b as never, "Asia/Tehran"), { invalid: f });
  }
  assertEquals((parseSchedule({ day: "monday", time: "09:00", remind_other: false }, "UTC") as Schedule).remind_other, false);
});

Deno.test("E32 next occurrence is Thursday 12 Nov 19:00 Tehran, 4 days on", () => {
  assertEquals(new Date(nextOccurrence(thu7, sun)).toISOString(), "2026-11-12T15:30:00.000Z");
  assertEquals(daysUntil(thu7, sun), 4);
});

Deno.test("E32 same day: later today counts, an hour that has passed rolls a week", () => {
  const sun7: Schedule = { ...thu7, day: "sunday" };
  assertEquals(daysUntil(sun7, sun), 0);
  const after = Date.UTC(2026, 10, 8, 16, 0);
  assertEquals(new Date(nextOccurrence(sun7, after)).toISOString(), "2026-11-15T15:30:00.000Z");
  assertEquals(nextOccurrence(sun7, Date.UTC(2026, 10, 8, 15, 30)) > Date.UTC(2026, 10, 8, 15, 30), true);
});

Deno.test("E32 daylight saving: 19:00 New York stays 19:00 across the change", () => {
  const ny: Schedule = { ...thu7, tz: "America/New_York", day: "monday" };
  // Fri 30 Oct 2026 12:00 UTC; Mon 2 Nov is EDT (-4) => 23:00Z; the clocks go back on Sun 1 Nov 2026 so EST applies: -5 => 00:00Z Tue
  assertEquals(new Date(nextOccurrence(ny, Date.UTC(2026, 9, 30, 12))).toISOString(), "2026-11-03T00:00:00.000Z");
  assertEquals(new Date(nextOccurrence(ny, Date.UTC(2026, 10, 3, 1))).toISOString(), "2026-11-10T00:00:00.000Z");
});

Deno.test("E32 reminder is due only within the hour before, and only when remind_other is on", () => {
  const at = nextOccurrence(thu7, sun);
  assertEquals(reminderDue(thu7, at - 2 * 3600_000), null);
  assertEquals(reminderDue(thu7, at - 30 * 60_000), at);
  assertEquals(reminderDue({ ...thu7, remind_other: false }, at - 30 * 60_000), null);
});

Deno.test("E32 home row carries numbers only, no text", () => {
  const r = homeRow(thu7, 2, sun);
  assertEquals(r, { repeats: "weekly", day: "thursday", time: "19:00", tz: "Asia/Tehran", next_at: "2026-11-12T15:30:00.000Z", next_in_days: 4, parked: 2 });
  assert(!JSON.stringify(r).includes("note"));
});

import { datedAt, parseDated, todayIn } from "../engine/checkin/schedule.ts";

Deno.test("E36 parse: fortnightly and monthly are accepted, daily is not", () => {
  assertEquals((parseSchedule({ day: "monday", time: "09:00", repeats: "fortnightly" }, "UTC") as Schedule).repeats, "fortnightly");
  assertEquals((parseSchedule({ day: "monday", time: "09:00", repeats: "monthly" }, "UTC") as Schedule).repeats, "monthly");
  assertEquals(parseSchedule({ day: "monday", time: "09:00", repeats: "daily" }, "UTC"), { invalid: "repeats" });
});

Deno.test("E36 fortnightly: every second Thursday from the first one on or after the anchor", () => {
  // anchor Sun 8 Nov 2026; first Thursday on or after is 12 Nov; then 26 Nov, 10 Dec
  const f: Schedule = { ...thu7, repeats: "fortnightly", anchor: "2026-11-08" };
  assertEquals(new Date(nextOccurrence(f, sun)).toISOString(), "2026-11-12T15:30:00.000Z");
  assertEquals(new Date(nextOccurrence(f, Date.UTC(2026, 10, 12, 16))).toISOString(), "2026-11-26T15:30:00.000Z");
  assertEquals(new Date(nextOccurrence(f, Date.UTC(2026, 10, 26, 16))).toISOString(), "2026-12-10T15:30:00.000Z");
  // anchored a week earlier, the same Thursdays shift by a week
  assertEquals(new Date(nextOccurrence({ ...f, anchor: "2026-11-01" }, sun)).toISOString(), "2026-11-19T15:30:00.000Z");
});

Deno.test("E36 monthly: the first Thursday of each month", () => {
  const m: Schedule = { ...thu7, repeats: "monthly" };
  assertEquals(new Date(nextOccurrence(m, sun)).toISOString(), "2026-12-03T15:30:00.000Z");
  assertEquals(new Date(nextOccurrence(m, Date.UTC(2026, 11, 3, 16))).toISOString(), "2027-01-07T15:30:00.000Z");
  assertEquals(homeRow(m, 0, sun).repeats, "monthly");
});

Deno.test("E36 one date: {on, time} parses; a past, malformed or mixed form names the field", () => {
  const ok = parseDated({ on: "2026-11-20", time: "19:00" }, "Asia/Tehran", sun);
  assertEquals(ok, { on: "2026-11-20", time: "19:00", tz: "Asia/Tehran", remind_other: true });
  assertEquals(new Date(datedAt(ok as never)).toISOString(), "2026-11-20T15:30:00.000Z");
  for (const [b, f] of [[{ on: "2026-02-30", time: "19:00" }, "on"], [{ on: "20 Nov", time: "19:00" }, "on"], [{ on: "2026-11-01", time: "19:00" }, "on"],
    [{ on: "2026-11-20", time: "7pm" }, "time"], [{ on: "2026-11-20", time: "19:00", repeats: "weekly" }, "repeats"],
    [{ on: "2026-11-20", time: "19:00", day: "friday" }, "day"], [{ on: "2026-11-20", time: "19:00", remind_other: 1 }, "remind_other"]] as const) {
    assertEquals(parseDated(b as never, "Asia/Tehran", sun), { invalid: f });
  }
  assertEquals(todayIn("Asia/Tehran", sun), "2026-11-08");
});
