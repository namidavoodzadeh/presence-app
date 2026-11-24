// Contract v1.52 per-item sharing routes. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import "../api/share_items.ts";
import "../api/bridge.ts";

const A = "00000000-0000-4000-8000-000000000071";
const B = "00000000-0000-4000-8000-000000000072";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select";
  eqs: Array<[string, unknown]> = [];
  ins: Array<[string, unknown[]]> = [];
  val: Row = {};
  one = false;
  conflict = "";
  constructor(private rows: Row[]) {}
  select() {
    return this;
  }
  upsert(v: Row, o?: { onConflict: string }) {
    this.kind = "upsert";
    this.val = v;
    this.conflict = o?.onConflict ?? "";
    return this;
  }
  delete() {
    this.kind = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.eqs.push([c, v]);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.ins.push([c, v]);
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    return Promise.resolve(r(this.run()));
  }
  run() {
    const m = (x: Row) =>
      this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c]));
    let out: Row[];
    if (this.kind === "upsert") {
      const keys = this.conflict.split(",");
      const ex = this.rows.find((x) => keys.every((k) => x[k] === this.val[k]));
      if (ex) {
        Object.assign(ex, this.val);
        out = [ex];
      } else {
        const row = { created_at: "2026-11-10T00:00:00Z", ...this.val };
        this.rows.push(row);
        out = [row];
      }
    } else if (this.kind === "delete") {
      out = this.rows.filter(m);
      for (const x of out) this.rows.splice(this.rows.indexOf(x), 1);
    } else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const client = (t: Record<string, Row[]>, hideShareItems = false) => ({
  // Model the hosted recipient RLS failure behind QA-B426.  The caller can still prove the active link, but only the
  // service client can read the already-filtered owner→recipient grant.
  from: (n: string) => new Q(hideShareItems && n === "share_items" ? [] : (t[n] ??= [])),
});
const tables = (): Record<string, Row[]> => ({
  links: [{ person_a: A, person_b: B, status: "active" }],
  beliefs: [
    {
      id: "b1",
      owner: A,
      label: "Needs time",
      area: "relationships",
      statement: "I need time before hard talks",
      status: "confirmed",
      rating: "very",
    },
    {
      id: "b2",
      owner: A,
      label: "Edited",
      area: "work",
      statement: "I like it right",
      status: "confirmed",
      rating: null,
    },
    {
      id: "g1",
      owner: A,
      label: "Guess",
      area: "work",
      statement: "inferred",
      status: "guess",
      rating: null,
    },
    {
      id: "n1",
      owner: A,
      label: "Not me",
      area: "work",
      statement: "rejected",
      status: "confirmed",
      rating: "not",
    },
    {
      id: "x1",
      owner: B,
      label: "Theirs",
      area: "work",
      statement: "not mine",
      status: "confirmed",
      rating: "very",
    },
  ],
  share_items: [],
});
function call(
  path: string,
  method: string,
  body: Row,
  caller: string,
  t: Record<string, Row[]>,
  recipientCannotReadShares = false,
) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!;
  const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t, recipientCannotReadShares);
  return f.handler({
    env: {},
    req: new Request("https://x.invalid" + path, { method }),
    url: new URL("https://x.invalid" + path),
    params,
    caller: { id: caller, isPreview: false, db },
    service: client(t),
    tz: "UTC",
    body: () => Promise.resolve(body),
  } as never).then((r: Response) => r.json());
}
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof ApiError);
    return e;
  }
  throw new Error("expected ApiError");
}

Deno.test("nothing is shared by default; only confirmed, not-Not-me beliefs are offered", async () => {
  const t = tables();
  const r = await call(`/links/${B}/share`, "GET", {}, A, t);
  assertEquals(r.shared_count, 0);
  assertEquals(r.items.map((i: Row) => i.belief_id), ["b1", "b2"]);
  assert(r.items.every((i: Row) => i.shared === false && i.shared_wording === null));
  assertEquals((await call(`/links/${B}/share/preview`, "GET", {}, A, t)).items, []);
});

Deno.test("sharing, re-wording, preview, and revoke", async () => {
  const t = tables();
  let r = await call(`/links/${B}/share/items/b1`, "PUT", { shared: true }, A, t);
  assertEquals(r.item, { belief_id: "b1", shared: true, shared_wording: "I need time before hard talks" });
  r = await call(
    `/links/${B}/share/items/b1`,
    "PUT",
    { shared: true, wording: "I need a little time" },
    A,
    t,
  );
  assertEquals(r.item.shared_wording, "I need a little time");
  // sharing again without wording keeps the approved wording
  r = await call(`/links/${B}/share/items/b1`, "PUT", { shared: true }, A, t);
  assertEquals(r.item.shared_wording, "I need a little time");
  assertEquals(t.share_items.length, 1);
  const prev = await call(`/links/${B}/share/preview`, "GET", {}, A, t);
  assertEquals(prev.items.map((i: Row) => [i.item_id, i.wording]), [["b1", "I need a little time"]]);
  assertEquals(prev.receipts, false);
  // the list shows it as shared
  const list = await call(`/links/${B}/share`, "GET", {}, A, t);
  assertEquals(list.items.find((i: Row) => i.belief_id === "b1").shared, true);
  assertEquals(list.shared_count, 1);
  // the person it was shared with reads it through GET /people/:person/map, in the approved wording and without receipts
  const map = await call(`/people/${A}/map`, "GET", {}, B, t);
  assertEquals(map.beliefs.map((b: Row) => b.statement), ["I need a little time"]);
  assertEquals(map.quotes, false);
  // revoke removes it for the next read
  r = await call(`/links/${B}/share/items/b1`, "PUT", { shared: false }, A, t);
  assertEquals(r.item.shared, false);
  assertEquals(t.share_items.length, 0);
  assertEquals((await call(`/links/${B}/share/preview`, "GET", {}, A, t)).items, []);
});

Deno.test("QA-B426: a linked recipient sees the exact approved grant when their RLS client hides it", async () => {
  const t = tables();
  t.beliefs[0].label = "PRIVATE OWNER LABEL";
  t.beliefs[0].statement = "private owner statement";
  await call(`/links/${B}/share/items/b1`, "PUT", { shared: true, wording: "I need a little time" }, A, t);

  // The active link remains visible to B; only the grant read simulates hosted recipient RLS. Before the route uses
  // ctx.service for this exact grant, it falls through to not_shared (403).
  const map = await call(`/people/${A}/map`, "GET", {}, B, t, true);
  assertEquals(map.beliefs.map((b: Row) => [b.label, b.statement, b.receipts]), [[
    "I need a little time",
    "I need a little time",
    [],
  ]]);
  assertEquals(map.quotes, false);
});

Deno.test("a guess, a Not me belief or someone else's belief cannot be shared; bad wording is refused", async () => {
  const t = tables();
  for (const id of ["g1", "n1"]) {
    const e = await rejects(() => call(`/links/${B}/share/items/${id}`, "PUT", { shared: true }, A, t));
    assertEquals(e.code, "forbidden");
    assertEquals(e.extra?.reason ?? (e as unknown as Row).reason, "not_confirmed");
  }
  assertEquals(
    (await rejects(() => call(`/links/${B}/share/items/x1`, "PUT", { shared: true }, A, t))).code,
    "not_found",
  );
  assertEquals(
    (await rejects(() => call(`/links/${B}/share/items/b1`, "PUT", { shared: true, wording: "  " }, A, t)))
      .code,
    "invalid",
  );
  assertEquals(
    (await rejects(() =>
      call(`/links/${B}/share/items/b1`, "PUT", { shared: true, wording: "x".repeat(401) }, A, t)
    )).code,
    "invalid",
  );
  assertEquals((await rejects(() => call(`/links/${B}/share/items/b1`, "PUT", {}, A, t))).code, "invalid");
  assertEquals(t.share_items.length, 0);
});

Deno.test("a belief set aside after sharing stops being shared at once", async () => {
  const t = tables();
  await call(`/links/${B}/share/items/b1`, "PUT", { shared: true }, A, t);
  t.beliefs[0].status = "set_aside";
  assertEquals((await call(`/links/${B}/share/preview`, "GET", {}, A, t)).items, []);
  const e = await rejects(() => call(`/people/${A}/map`, "GET", {}, B, t));
  assertEquals(e.code, "forbidden");
});

Deno.test("no link, no sharing; and the per-area share does not reach friends", async () => {
  const t = tables();
  t.links.length = 0;
  assertEquals((await rejects(() => call(`/links/${B}/share`, "GET", {}, A, t))).code, "not_found");
  const u = tables();
  u.profiles = [{ id: A, account_kind: null }, { id: B, account_kind: null }];
  u.link_prefs = [{ owner: A, other: B, share_on: true, share_areas: ["work"], share_quotes: false }];
  assertEquals((await rejects(() => call(`/people/${A}/map`, "GET", {}, B, u))).code, "forbidden");
  u.profiles = [{ id: A, account_kind: "test" }, { id: B, account_kind: null }];
  const legacy = await call(`/people/${A}/map`, "GET", {}, B, u);
  assertEquals(legacy.areas, ["work"]);
  assertEquals(legacy.beliefs.map((b: Row) => b.belief_id), ["b2"]);
  assertEquals(legacy.quotes, false);
});

// ---- v1.51 quote rendered from the live grant
import { attachSharedQuote } from "../api/bridge_engine.ts";
import { loadPairContext } from "../api/pair_context.ts";
import type { Sender } from "../engine/bridge/types.ts";

const hl = (ids: string[]) => ({
  highlights: [{
    start: 0,
    end: 3,
    original: "abc",
    suggested: "abc",
    why_line: "x",
    friction_kind: null,
    from_you: [],
    from_them: ids.map((id) => ({
      belief_id: id,
      wording: "label-only " + id,
      item_id: null,
      quote: null,
      quote_label: null,
    })),
  }],
});

Deno.test("v1.51: a grant-backed entry carries item id, words and label; at most one is quoted", () => {
  const sender = {
    receiverFirstName: "Jan",
    receiverBeliefs: [
      { id: "b1", label: "l", statement: "I need a little time", sharedItem: true },
      { id: "b2", label: "l", statement: "I like it right", sharedItem: true },
      { id: "b3", label: "l", statement: "area-share wording" },
    ],
  } as unknown as Sender;
  const out = hl(["b3", "b1", "b2"]);
  attachSharedQuote(out, sender);
  const e = out.highlights[0].from_them;
  assertEquals(
    e.map((x) => x.quote),
    [null, "I need a little time", null],
    "the area-share entry is never quoted; only one entry is",
  );
  assertEquals([e[1].item_id, e[1].quote_label], ["b1", "From what Jan shared:"]);
  // no grants (revoked) or no name: all three keys stay null
  const none = hl(["b1"]);
  attachSharedQuote(
    none,
    {
      receiverFirstName: "Jan",
      receiverBeliefs: [{ id: "b1", label: "l", statement: "s" }],
    } as unknown as Sender,
  );
  assertEquals([none.highlights[0].from_them[0].item_id, none.highlights[0].from_them[0].quote], [
    null,
    null,
  ]);
});

Deno.test("v1.61 source rule: a receiver note shows only with the one shared item; wording notes always show; the quote goes to the receiver note first", () => {
  const h = (about: "receiver" | "wording", start: number, ids: string[]) => ({
    start,
    end: start + 3,
    original: "abc",
    suggested: "abc",
    why_line: about === "receiver" ? "This may touch something they've shared with you." : "w",
    friction_kind: null,
    about,
    from_you: [],
    from_them: ids.map((id) => ({
      belief_id: id,
      wording: "label-only " + id,
      item_id: null as string | null,
      quote: null as string | null,
      quote_label: null as string | null,
    })),
  });
  const granted = {
    receiverFirstName: "Jan",
    receiverBeliefs: [{ id: "b1", label: "l", statement: "I need a little time", sharedItem: true }],
  } as unknown as Sender;
  // the wording note comes first in text order and rests on the same belief: the quote still goes to the receiver note
  const out = { highlights: [h("wording", 0, ["b1"]), h("receiver", 10, ["b1"]), h("receiver", 20, ["b9"])] };
  attachSharedQuote(out, granted);
  assertEquals(out.highlights.map((x) => [x.start, x.about, x.from_them.map((e) => e.quote)]), [[
    0,
    "wording",
    [null],
  ], [10, "receiver", ["I need a little time"]]], "the unsourced receiver note (b9) is dropped");
  // nothing shared (or no name): every receiver note is dropped, wording notes stay
  for (
    const sender of [{ receiverFirstName: "Jan", receiverBeliefs: [] }, {
      receiverFirstName: "",
      receiverBeliefs: granted.receiverBeliefs,
    }]
  ) {
    const o = { highlights: [h("receiver", 0, ["b1"]), h("wording", 10, [])] };
    attachSharedQuote(o, sender as unknown as Sender);
    assertEquals(o.highlights.map((x) => x.about), ["wording"]);
  }
});

Deno.test("pair context reads only the receiver's live grants, for real people too; no grant means no receiver context", async () => {
  const t = tables();
  t.profiles = [{ id: A, name: "Nami", account_kind: null }, { id: B, name: "Jan", account_kind: null }];
  t.link_prefs = [];
  t.beliefs = [{
    id: "b1",
    owner: A,
    label: "PRIVATE LABEL",
    area: "work",
    status: "confirmed",
    rating: "very_me",
    statement: "private statement",
  }];
  await call(`/links/${B}/share/items/b1`, "PUT", { shared: true, wording: "I need a little time" }, A, t); // A shares with B
  // B is the sender, A a REAL receiver (no flag): the granted item is read, in the approved wording, never the private label
  const got = await loadPairContext(client(t) as never, B, A);
  assertEquals(got.receiver?.items.map((x) => [x.id, x.words]), [["b1", "I need a little time"]]);
  // a real receiver who granted this sender nothing: empty, even with a link_prefs area share on
  t.link_prefs = [{ owner: A, other: B, share_on: true, share_areas: ["work"] }];
  assertEquals((await loadPairContext(client(t) as never, A, B)).receiver?.items, [], "B granted A nothing");
  // revoke: empty at once, and the area share does not stand in for it between real accounts
  await call(`/links/${B}/share/items/b1`, "PUT", { shared: false }, A, t);
  assertEquals((await loadPairContext(client(t) as never, B, A)).receiver?.items, []);
});
