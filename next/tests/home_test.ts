// V3 Home order: GET /home gives the card stack in one read, least urgent first, most urgent last; numbers and kinds only. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/home.ts";

const ME = "00000000-0000-4000-8000-000000000071";
const U = "00000000-0000-4000-8000-000000000072"; // unread
const I = "00000000-0000-4000-8000-000000000073"; // check-in invite
const S = "00000000-0000-4000-8000-000000000074"; // check-in soon
const O = "00000000-0000-4000-8000-000000000075"; // open items
const D = "00000000-0000-4000-8000-000000000076"; // draft
const Q = "00000000-0000-4000-8000-000000000077"; // nothing
const M = "00000000-0000-4000-8000-000000000078"; // muted, with unread
type Row = Record<string, unknown>;
const past = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

class T implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = []; nulls: string[] = []; nes: Array<[string, unknown]> = []; one = false;
  constructor(private rows: Row[]) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  neq(c: string, v: unknown) { this.nes.push([c, v]); return this; }
  is(c: string) { this.nulls.push(c); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  or() { return this; }
  order() { return this; }
  maybeSingle() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    const out = this.rows.filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.nes.every(([c, v]) => x[c] !== v) &&
      this.nulls.every((c) => x[c] == null) && this.ins.every(([c, v]) => v.includes(x[c]))).map((x) => ({ ...x }));
    return Promise.resolve(r({ data: this.one ? out[0] ?? null : out, error: null }));
  }
}
const mkClient = (t: Record<string, Row[]>, views: Row[]) => ({
  from: (n: string) => new T(t[n] ??= []),
  rpc: (_n: string, a: { p_sender: string }) => Promise.resolve({ data: views.filter((v) => v.sender === a.p_sender), error: null }),
});
const link = (o: string): Row => ({ person_a: ME < o ? ME : o, person_b: ME < o ? o : ME, status: "active", created_at: past(500) });
const prof = (id: string, name: string): Row => ({ id, name });
const nextDayName = (hoursAhead: number) => {
  const d = new Date(Date.now() + hoursAhead * 3600_000);
  return { day: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getUTCDay()], time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` };
};
function world(over: { checkIn?: boolean } = {}) {
  const soon = nextDayName(5);
  const tables: Record<string, Row[]> = {
    profiles: [prof(ME, "Me"), prof(U, "Una"), prof(I, "Ilan"), prof(S, "Sol"), prof(O, "Ola"), prof(D, "Dan"), prof(Q, "Quin"), prof(M, "Mo")],
    links: [U, I, S, O, D, Q, M].map(link),
    link_prefs: [{ owner: ME, other: M, muted_until: new Date(Date.now() + 86400_000).toISOString() }],
    drafts: [{ owner: ME, other: D, text: "private words", updated_at: past(2) }],
    check_ins: [
      { id: "ci-s", owner: ME, person: S, status: "active", repeats: "weekly", day: soon.day, time: soon.time, tz: "UTC" },
      { id: "ci-i", owner: I, person: ME, status: "invited", repeats: "weekly", day: "monday", time: "19:00", tz: "UTC" },
    ],
    parked_notes: [{ writer: ME, partner: O, state: "parked" }, { writer: ME, partner: O, state: "parked" }],
  };
  const views = [
    { sender: U, id: "r1", deliver_at: past(3), ready: true, opened_at: null, final: "SECRET", created_at: past(3) },
    { sender: M, id: "r2", deliver_at: past(3), ready: true, opened_at: null, final: "SECRET", created_at: past(3) },
  ];
  const db = mkClient(tables, views);
  return () => {
    const f = routes.find((r) => r.method === "GET" && r.pattern.test("/home"))!;
    assert(f, "no GET /home");
    return f.handler({ env: { checkIn: over.checkIn ?? true }, req: new Request("https://x.invalid/home"), url: new URL("https://x.invalid/home"), params: {},
      caller: { id: ME, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve({}) } as never);
  };
}
const names = (r: { people: Array<{ person: { name: string } }> }) => r.people.map((p) => p.person.name);

Deno.test("home: most urgent LAST: unread, then invite, then check-in soon, then open items, then draft, then quiet", async () => {
  const r = await (await world()()).json();
  assertEquals(r.order, "least_urgent_first");
  const n = names(r);
  assertEquals(n.slice(-5), ["Dan", "Ola", "Sol", "Ilan", "Una"]);
  assertEquals(n.slice(0, 2).sort(), ["Mo", "Quin"], "quiet and muted people sit at the top");
});

Deno.test("home: reasons, counts and times only; no words from any bridge, note or draft", async () => {
  const r = await (await world()()).json();
  const by = Object.fromEntries(r.people.map((p: { person: { name: string } }) => [p.person.name, p]));
  assertEquals(by.Una.reasons, ["unread"]);
  assertEquals(by.Una.unread, 1);
  assertEquals(by.Ilan.reasons, ["invite"]);
  assertEquals(by.Ilan.invite_check_in_id, "ci-i");
  assertEquals(by.Sol.reasons, ["checkin_soon"]);
  assert(typeof by.Sol.checkin_at === "string");
  assertEquals(by.Ola.reasons, ["open_items"]);
  assertEquals(by.Ola.open_items, 2);
  assertEquals(by.Dan.reasons, ["draft"]);
  assertEquals(by.Dan.draft, true);
  assertEquals(by.Quin.reasons, []);
  assertEquals(by.Mo.muted, true);
  const text = JSON.stringify(r);
  assert(!text.includes("SECRET") && !text.includes("private words"), "no content leaves this route");
});

Deno.test("home: with check-ins off the stack still works and has no check-in reasons", async () => {
  const r = await (await world({ checkIn: false })()).json();
  const all = r.people.flatMap((p: { reasons: string[] }) => p.reasons);
  assert(!all.includes("invite") && !all.includes("checkin_soon") && !all.includes("open_items"));
  assertEquals(names(r).at(-1), "Una");
});
