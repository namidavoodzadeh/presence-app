// V3 C24/C26 owner reads: kind-line map, person-owned display choices, live
// pair-context visibility, and card candidates. Fake database, $0.
import { assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/comm_items.ts";
import "../api/comm_map.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const ME = "00000000-0000-4000-8000-0000000000a1", JAN = "00000000-0000-4000-8000-0000000000a2";
type Row = Record<string, unknown>;
const env = { commItems: true, commOwnerIds: [ME] };

function call(method: string, path: string, tables: FakeTables, body: Row = {}) {
  const route = routes.find((x) => x.method === method && x.pattern.test(path));
  if (!route) throw new Error(`no ${method} ${path}`);
  const m = path.match(route.pattern)!;
  const params: Record<string, string> = {};
  route.keys.forEach((key, i) => params[key] = m[i + 1]);
  const db = fakeClient(tables);
  return route.handler(
    {
      env,
      req: new Request(`https://x.invalid${path}`),
      url: new URL(`https://x.invalid${path}`),
      params,
      caller: { id: ME, db },
      service: db,
      tz: "UTC",
      body: () => Promise.resolve(body),
    } as never,
  );
}

function item(
  id: string,
  kind: string,
  scope = "everyone",
  value: string | null = null,
  more: Row = {},
): Row {
  return {
    id,
    owner: ME,
    status: "confirmed",
    rating: "very",
    statement: `${id} words`,
    own_wording: `${id} words`,
    created_at: "2026-11-01T00:00:00Z",
    confirmed_at: "2026-11-01T00:00:00Z",
    comm_kind: kind,
    comm_scope_type: scope,
    comm_scope_value: value,
    comm_status: "active",
    ...more,
  };
}

Deno.test("comm map: confirmed live items form kind lines ordered by scope; List has the same stations without map metrics", async () => {
  const tables: FakeTables = {
    beliefs: [
      item("person", "how_i_mean", "person", JAN),
      item("all", "how_i_mean"),
      item("type", "how_i_mean", "type", "friends"),
      item("hidden", "bring_up", "everyone", null, { comm_hidden_from_map: true }),
      item("aside", "bring_up", "everyone", null, { comm_status: "set_aside" }),
      item("old", "this_week", "everyone", null, { comm_expires_at: "2000-01-01T00:00:00Z" }),
    ],
  };
  const out = await (await call("GET", "/comm/map", tables)).json();
  assertEquals(out.lines.map((line: Row) => [line.kind, (line.stations as Row[]).map((s) => s.id)]), [[
    "how_i_mean",
    ["all", "type", "person"],
  ], ["bring_up", ["hidden"]]]);
  assertEquals(out.list.map((s: Row) => s.id), ["all", "type", "person", "hidden"]);
  assertEquals(out.lines[0].stations[0].hidden, false);
  assertEquals(out.lines[1].stations[0].hidden, true);
  assertEquals(JSON.stringify(out).includes("total"), false);
  assertEquals(JSON.stringify(out).includes("strength"), false);
});

Deno.test("comm map actions: hide and show separately persist only the person's display choices", async () => {
  const tables: FakeTables = { beliefs: [item("a", "how_i_mean")] };
  const out =
    await (await call("PATCH", "/comm/items/a/map", tables, { hidden: true, show_separately: true })).json();
  assertEquals(out.station, {
    id: "a",
    wording: "a words",
    scope: { type: "everyone", value: null },
    when: null,
    hidden: true,
    show_separately: true,
  });
  assertEquals([tables.beliefs![0].comm_hidden_from_map, tables.beliefs![0].comm_show_separately], [
    true,
    true,
  ]);
});

Deno.test("comm visibility: it reads a linked person's live per-item grant through pair context", async () => {
  const tables: FakeTables = {
    profiles: [{ id: ME, name: "Nami Owner" }, { id: JAN, name: "Jan Friend" }],
    links: [{ person_a: ME, person_b: JAN, status: "active" }],
    link_prefs: [{ owner: JAN, other: ME, relationship: "friend" }],
    share_items: [{ owner: ME, other: JAN, belief_id: "a", wording: "a words" }],
    beliefs: [item("a", "bring_up")],
  };
  const out = await (await call("GET", "/comm/items/a/visibility", tables)).json();
  assertEquals(out, {
    item_id: "a",
    scope: { type: "everyone", value: null },
    people: [{ person_id: JAN, name: "Jan", sees: true }],
  });
  tables.beliefs![0].comm_status = "set_aside";
  assertEquals((await (await call("GET", "/comm/items/a/visibility", tables)).json()).people[0].sees, false);
});

Deno.test("card items: only confirmed active own-word items survive the V3 exclusions, and card output stays local", async () => {
  const tables: FakeTables = {
    beliefs: [
      item("safe", "how_i_mean"),
      item("hard", "lands_hard"),
      item("heated", "gets_heated"),
      item("back", "coming_back"),
      item("week", "this_week", "everyone", null, { comm_expires_at: "2099-01-01T00:00:00Z" }),
      item("politics", "matters", "everyone", null, { comm_topic: "politics" }),
      item("body", "matters", "everyone", null, { comm_topic: "body" }),
      item("faith", "matters", "everyone", null, { comm_topic: "faith" }),
    ],
  };
  const out = await (await call("GET", "/comm/card-items", tables)).json();
  assertEquals(out, {
    items: [{ id: "safe", wording: "safe words", kind: "how_i_mean", topic: null }],
    max_selected: 3,
    persisted: false,
  });
});
