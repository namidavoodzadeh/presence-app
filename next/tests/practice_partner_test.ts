// E15 (CEO, support for app AR(2)): the Bridge practice partner is owner-only, costs $0 (no model call ever
// runs), and never becomes visible to any other account. Tests first, against a fake database (no hosted deploy).

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { floorSafety } from "../engine/bridge/bridge.ts";
import {
  pickExampleReply,
  pickPracticeReply,
  PRACTICE_PARTNER_ID,
  PRACTICE_PARTNER_NAME,
  PRACTICE_REPLIES,
} from "../engine/bridge/practice_partner.ts";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { IMPORT_PREVIEW_OWNER_ID } from "../api/lib/env.ts";
import "../api/practice_partner.ts";
import { requirePracticePartnerAccess } from "../api/practice_partner.ts";

const OWNER_ID = IMPORT_PREVIEW_OWNER_ID;
const ON_ENV = { practicePartner: true, practicePartnerOwnerId: OWNER_ID };

Deno.test("E15 the canned replies never trip the safety floor and are picked deterministically", () => {
  for (const line of PRACTICE_REPLIES) assertEquals(floorSafety(line).routed, "none", line);
  assertEquals(pickPracticeReply("same-id"), pickPracticeReply("same-id"));
  assert(PRACTICE_REPLIES.includes(pickPracticeReply("11111111-aaaa-4aaa-aaaa-111111111111")));
});

Deno.test("E24 the per-relationship example replies never trip the safety floor and are picked deterministically", () => {
  for (const relationship of ["partner", "family", "friend", "coworker", "neighbour", ""]) {
    const a = pickExampleReply("bridge-x", relationship);
    const b = pickExampleReply("bridge-x", relationship);
    assertEquals(a, b, relationship);
    assertEquals(floorSafety(a).routed, "none", `${relationship}: ${a}`);
  }
  // an unknown or missing relationship falls back to the friend set
  assertEquals(pickExampleReply("same-seed", "neighbour"), pickExampleReply("same-seed", "friend"));
  assertEquals(pickExampleReply("same-seed", ""), pickExampleReply("same-seed", "friend"));
});

Deno.test("E15 access is switched and restricted to the configured owner id", () => {
  requirePracticePartnerAccess({ env: ON_ENV, caller: { id: OWNER_ID } } as never);
  for (
    const [env, id, reason] of [
      [{ ...ON_ENV, practicePartner: false }, OWNER_ID, "feature_off"],
      [ON_ENV, "someone-else", "owner_only"],
    ] as const
  ) {
    const error = assertThrows(
      () => requirePracticePartnerAccess({ env, caller: { id } } as never),
      ApiError,
    );
    assertEquals(error.code, "forbidden");
    assertEquals(error.extra.reason, reason);
  }
});

type FakeRow = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  #kind: "select" | "update" | "insert" = "select";
  #changes: FakeRow = {};
  #inserted: FakeRow[] = [];
  #equals: Array<[string, unknown]> = [];
  #single = false;
  #nextId = 1;

  constructor(private table: string, private rows: FakeRow[]) {}

  select(_columns: string) {
    return this;
  }
  update(changes: FakeRow) {
    this.#kind = "update";
    this.#changes = changes;
    return this;
  }
  insert(value: FakeRow | FakeRow[]) {
    this.#kind = "insert";
    this.#inserted = (Array.isArray(value) ? value : [value]).map((row) => ({
      id: row.id ?? `${this.table}-${this.#nextId++}`,
      created_at: row.created_at ?? new Date().toISOString(),
      ...row,
    }));
    return this;
  }
  eq(column: string, value: unknown) {
    this.#equals.push([column, value]);
    return this;
  }
  maybeSingle() {
    this.#single = true;
    return this;
  }
  single() {
    this.#single = true;
    return this;
  }
  #matches(row: FakeRow) {
    return this.#equals.every(([column, value]) => row[column] === value);
  }
  #run() {
    let matched: FakeRow[];
    if (this.#kind === "insert") {
      this.rows.push(...this.#inserted);
      matched = this.#inserted;
    } else {
      matched = this.rows.filter((row) => this.#matches(row));
      if (this.#kind === "update") for (const row of matched) Object.assign(row, this.#changes);
    }
    const copied = matched.map((row) => ({ ...row }));
    return { data: this.#single ? copied[0] ?? null : copied, error: null as null };
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    return Promise.resolve(resolve(this.#run()));
  }
}

function fakeClient(tables: Record<string, FakeRow[]>) {
  return { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
}

function ctxFor(path: string, method: string, body: Record<string, unknown>, caller: string, tables: Record<string, FakeRow[]>) {
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(route, `no route for ${method} ${path}`);
  const service = fakeClient(tables);
  return {
    call: () =>
      route.handler({
        env: ON_ENV,
        req: new Request("https://presence.invalid" + path, { method }),
        url: new URL("https://presence.invalid" + path),
        params: {},
        caller: { id: caller, isPreview: false, db: service },
        service,
        tz: "Asia/Tehran",
        body: () => Promise.resolve(body),
      } as never),
  };
}

Deno.test("E15 starting the practice partner creates one profile and one link, idempotently", async () => {
  const tables: Record<string, FakeRow[]> = { profiles: [], links: [] };
  const first = await ctxFor("/practice-partner/start", "POST", {}, OWNER_ID, tables).call();
  assertEquals(first.status, 200);
  const body = await first.json();
  assertEquals(body.person.id, PRACTICE_PARTNER_ID);
  assertEquals(body.person.name, PRACTICE_PARTNER_NAME);
  assertEquals(tables.profiles.length, 1);
  assertEquals(tables.links.length, 1);

  const second = await ctxFor("/practice-partner/start", "POST", {}, OWNER_ID, tables).call();
  assertEquals(second.status, 200);
  assertEquals(tables.profiles.length, 1, "no duplicate profile");
  assertEquals(tables.links.length, 1, "no duplicate link");
});

Deno.test("E15 a non-owner cannot start the practice partner, and nothing is created", async () => {
  const tables: Record<string, FakeRow[]> = { profiles: [], links: [] };
  const { call } = ctxFor("/practice-partner/start", "POST", {}, "someone-else", tables);
  let threw: unknown;
  try {
    await call();
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof ApiError);
  assertEquals(threw.extra.reason, "owner_only");
  assertEquals(tables.profiles.length, 0);
  assertEquals(tables.links.length, 0);
});

Deno.test("E15 replying opens the sent bridge and sends back exactly one canned reply, no model call", async () => {
  const tables: Record<string, FakeRow[]> = {
    profiles: [],
    links: [],
    bridges: [{
      id: "bridge-1",
      sender: OWNER_ID,
      receiver: PRACTICE_PARTNER_ID,
      original: "I practiced a hard thing to say.",
      final: "I practiced a hard thing to say.",
      used: "mine",
      status: "scheduled",
      deliver_at: "2026-11-05T08:00:00.000Z",
      opened_at: null,
      created_at: "2026-11-05T08:00:00.000Z",
    }],
  };
  const route = routes.find((r) => r.method === "POST" && r.pattern.test("/practice-partner/bridges/bridge-1/reply"));
  assert(route);
  const service = fakeClient(tables);
  const run = () =>
    route.handler({
      env: ON_ENV,
      req: new Request("https://presence.invalid/practice-partner/bridges/bridge-1/reply", { method: "POST" }),
      url: new URL("https://presence.invalid/practice-partner/bridges/bridge-1/reply"),
      params: { id: "bridge-1" },
      caller: { id: OWNER_ID, isPreview: false, db: service },
      service,
      tz: "Asia/Tehran",
      body: () => Promise.resolve({}),
    } as never);

  const response = await run();
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.reply.from, PRACTICE_PARTNER_NAME);
  assertEquals(body.reply.reply_to, "bridge-1");
  assert(PRACTICE_REPLIES.includes(body.reply.final));
  assertEquals(tables.bridges.find((b) => b.id === "bridge-1")?.opened_at, body.opened_at);
  assertEquals(tables.bridges.length, 2);
  const reply = tables.bridges.find((b) => b.id !== "bridge-1");
  assertEquals(reply?.sender, PRACTICE_PARTNER_ID);
  assertEquals(reply?.receiver, OWNER_ID);

  const second = await assertRejectsApiError(run);
  assertEquals(second.code, "conflict");
  assertEquals(second.extra.reason, "already_replied");
  assertEquals(tables.bridges.length, 2, "no second reply");
});

Deno.test("E24 replying from an example linked person uses that relationship's reply set and names them", async () => {
  const tables: Record<string, FakeRow[]> = {
    profiles: [{ id: "lea-id", name: "Lea", is_example: true }],
    links: [],
    link_prefs: [{ owner: OWNER_ID, other: "lea-id", relationship: "partner" }],
    bridges: [{
      id: "bridge-lea",
      sender: OWNER_ID,
      receiver: "lea-id",
      original: "I've been meaning to say this.",
      final: "I've been meaning to say this.",
      used: "mine",
      status: "scheduled",
      deliver_at: "2026-11-06T08:00:00.000Z",
      opened_at: null,
      created_at: "2026-11-06T08:00:00.000Z",
    }],
  };
  const route = routes.find((r) => r.method === "POST" && r.pattern.test("/practice-partner/bridges/bridge-lea/reply"));
  assert(route);
  const service = fakeClient(tables);
  const response = await route.handler({
    env: ON_ENV,
    req: new Request("https://presence.invalid/practice-partner/bridges/bridge-lea/reply", { method: "POST" }),
    url: new URL("https://presence.invalid/practice-partner/bridges/bridge-lea/reply"),
    params: { id: "bridge-lea" },
    caller: { id: OWNER_ID, isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve({}),
  } as never);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.reply.from, "Lea");
  assertEquals(body.reply.final, pickExampleReply("bridge-lea", "partner"));
  const reply = tables.bridges.find((b) => b.id !== "bridge-lea");
  assertEquals(reply?.sender, "lea-id");
  assertEquals(reply?.receiver, OWNER_ID);
});

Deno.test("E15 replying to a bridge that was not sent to the practice partner is not found", async () => {
  const tables: Record<string, FakeRow[]> = {
    profiles: [],
    links: [],
    bridges: [{
      id: "bridge-2",
      sender: OWNER_ID,
      receiver: "a-real-person",
      original: "hello",
      final: "hello",
      used: "mine",
      status: "scheduled",
      deliver_at: "2026-11-05T08:00:00.000Z",
      opened_at: null,
      created_at: "2026-11-05T08:00:00.000Z",
    }],
  };
  const route = routes.find((r) => r.method === "POST" && r.pattern.test("/practice-partner/bridges/bridge-2/reply"));
  assert(route);
  const service = fakeClient(tables);
  const error = await assertRejectsApiError(() =>
    route.handler({
      env: ON_ENV,
      req: new Request("https://presence.invalid/practice-partner/bridges/bridge-2/reply", { method: "POST" }),
      url: new URL("https://presence.invalid/practice-partner/bridges/bridge-2/reply"),
      params: { id: "bridge-2" },
      caller: { id: OWNER_ID, isPreview: false, db: service },
      service,
      tz: "Asia/Tehran",
      body: () => Promise.resolve({}),
    } as never)
  );
  assertEquals(error.code, "not_found");
});

async function assertRejectsApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof ApiError);
    return e;
  }
  throw new Error("expected an ApiError");
}
