import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Ctx, Route } from "../api/lib/router.ts";
import { routes } from "../api/lib/router.ts";
import "../api/map.ts";
import "../api/bridge.ts";

type Row = Record<string, unknown>;

class FixtureDb {
  belief: Row = {
    id: "belief-fixture",
    owner: "person-a",
    label: "Making room",
    statement: "You tend to make room when plans change.",
    type: "something I tend to do",
    kind: "pattern",
    level: 2,
    area: "relationships",
    domains: ["close_relationships"],
    status: "confirmed",
    rating: "very",
    confidence: 0.8,
    created_at: "2026-11-01T00:00:00.000Z",
  };
  link: Row = { id: "link-fixture", person_a: "person-a", person_b: "person-b", status: "active" };
  events: Row[] = [];

  client(): SupabaseClient {
    return { from: (table: string) => new FixtureQuery(this, table) } as unknown as SupabaseClient;
  }
}

class FixtureQuery implements PromiseLike<{ data: unknown; error: null }> {
  private action: "select" | "update" | "insert" = "select";
  private value: Row = {};

  constructor(private readonly db: FixtureDb, private readonly table: string) {}
  select(_columns = "*") {
    return this;
  }
  eq(_column: string, _value: unknown) {
    return this;
  }
  neq(_column: string, _value: unknown) {
    return this;
  }
  is(_column: string, _value: null) {
    return this;
  }
  in(_column: string, _values: unknown[]) {
    return this;
  }
  order(_column: string, _options?: unknown) {
    return this;
  }
  update(value: Row) {
    this.action = "update";
    this.value = value;
    return this;
  }
  insert(value: Row) {
    this.action = "insert";
    this.value = value;
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    if (this.table === "beliefs") return Promise.resolve({ data: { ...this.db.belief }, error: null });
    if (this.table === "links") return Promise.resolve({ data: { ...this.db.link }, error: null });
    return Promise.resolve({ data: null, error: null });
  }

  single(): Promise<{ data: Row; error: null }> {
    if (this.table === "beliefs" && this.action === "update") {
      Object.assign(this.db.belief, this.value);
      return Promise.resolve({ data: { ...this.db.belief }, error: null });
    }
    throw new Error(`unexpected single() on ${this.table}`);
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.table === "links" && this.action === "update") Object.assign(this.db.link, this.value);
    if (this.table === "thread_events" && this.action === "insert") this.db.events.push({ ...this.value });
    const data = this.action === "select" ? [] : null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function handler(method: string, path: string): Route["handler"] {
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
  assert(route, `${method} ${path} is registered`);
  return route.handler;
}

function context(db: FixtureDb, params: Record<string, string>): Ctx {
  return {
    env: {} as Ctx["env"],
    req: new Request("https://fixture.invalid"),
    url: new URL("https://fixture.invalid"),
    params,
    caller: { id: "person-a", db: db.client(), profile: {} } as Ctx["caller"],
    service: db.client(),
    tz: "UTC",
    body: () => Promise.resolve({}),
  };
}

Deno.test("E6 mocked route: POST /links/:person/remove removes the active link and records the event", async () => {
  const db = new FixtureDb();
  const response = await handler("POST", "/links/person-b/remove")(context(db, { person: "person-b" }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "removed", dropped: 0 });   // QA-B402: nothing scheduled in this fixture, so nothing withdrawn
  assertEquals(db.link.status, "removed");
  assertEquals(db.events, [{ person_a: "person-a", person_b: "person-b", type: "removed", visible_to_b: false }]);   // QA-B403: written invisible to the removed person
});

Deno.test("E6 mocked route: POST /beliefs/:id/notme sets aside the owned belief with undo", async () => {
  const db = new FixtureDb();
  const before = Date.now();
  const response = await handler("POST", "/beliefs/belief-fixture/notme")(
    context(db, { id: "belief-fixture" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.belief.status, "set_aside");
  assertEquals(body.belief.rating, "not");
  assertEquals(db.belief.previous_status, "confirmed");
  assertEquals(db.belief.previous_rating, "very");
  const undo = Date.parse(body.undo_until);
  assert(undo >= before + 4_900 && undo <= Date.now() + 5_100, `unexpected undo window: ${body.undo_until}`);
});
