// Contract v1.54/v1.55: GET /invites/:code (read-only peek) and invite_code on GET /people. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import "../api/bridge.ts";

type Row = Record<string, unknown>;
const INVITER = "00000000-0000-4000-8000-000000000091";
const JOINER = "00000000-0000-4000-8000-000000000092";
const STRANGER = "00000000-0000-4000-8000-000000000093";

class Q implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = [];
  constructor(private rows: Row[]) {}
  select() { return this; } order() { return this; } or() { return this; } limit() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    const out = this.rows.filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c])));
    return Promise.resolve(r({ data: out, error: null }));
  }
}

const now = Date.now();
function world() {
  const invites: Row[] = [
    { id: "i1", code: "K7PM3Q", owner: INVITER, revoked: false, expires_at: new Date(now + 86_400_000).toISOString() },
    { id: "i2", code: "OLD111", owner: INVITER, revoked: false, expires_at: new Date(now - 1000).toISOString() },
    { id: "i3", code: "GONE22", owner: INVITER, revoked: true, expires_at: new Date(now + 86_400_000).toISOString() },
  ];
  const t: Record<string, Row[]> = {
    links: [{ id: "l1", person_a: INVITER, person_b: JOINER, status: "active", invite_id: "i1", created_at: "2026-11-10T00:00:00Z" },
            { id: "l2", person_a: INVITER, person_b: STRANGER, status: "active", invite_id: null, created_at: "2026-11-09T00:00:00Z" }],
    profiles: [{ id: INVITER, name: "Lea", initial: "L" }, { id: JOINER, name: "Jo", initial: "J" }, { id: STRANGER, name: "Sam", initial: "S" }],
    link_prefs: [], share_items: [], invites,
  };
  const calls: string[] = [];
  const mk = (caller: string) => ({
    from: (n: string) => new Q(n === "links" ? t.links.filter((l) => l.person_a === caller || l.person_b === caller) : t[n] ??= []),
    rpc: (fn: string, args: { p_code: string }) => {
      calls.push(fn);
      const i = invites.find((x) => x.code === args.p_code && !x.revoked && String(x.expires_at) > new Date().toISOString());
      if (!i) return Promise.resolve({ data: null, error: { message: "not_found", code: "P0002" } });
      if (i.owner === caller) return Promise.resolve({ data: null, error: { message: "invalid", code: "P0001" } });
      const p = t.profiles.find((x) => x.id === i.owner)!;
      return Promise.resolve({ data: { name: p.name, initial: p.initial, expires_at: i.expires_at }, error: null });
    },
  });
  return { t, calls, mk };
}

async function call(path: string, caller: string, w = world()) {
  const f = routes.find((r) => r.method === "GET" && r.pattern.test(path));
  assert(f, `no route GET ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = w.mk(caller);
  const res = await f.handler({
    env: {}, req: new Request("https://x.invalid" + path), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve({}),
  } as never);
  return { res, w };
}

Deno.test("GET /invites/:code returns inviter name, initial and expiry; writes nothing", async () => {
  const w = world();
  const before = JSON.stringify(w.t);
  const { res } = await call("/invites/k7pm3q", JOINER, w);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.inviter, { name: "Lea", initial: "L" });
  assert(typeof j.expires_at === "string");
  assertEquals(Object.keys(j).sort(), ["expires_at", "inviter"]);
  assertEquals(w.calls, ["peek_invite"], "only the read-only function, never accept_invite");
  assertEquals(JSON.stringify(w.t), before, "no row changed");
});

Deno.test("GET /invites/:code is 404 for expired, revoked, unknown and malformed codes", async () => {
  for (const code of ["OLD111", "GONE22", "ZZZZZZ", "a", "bad-code!"]) {
    try { await call(`/invites/${code}`, JOINER); throw new Error("should have thrown for " + code); }
    catch (e) { assert(e instanceof ApiError, String(e)); assertEquals((e as ApiError).code, "not_found", code); }
  }
});

Deno.test("GET /invites/:code on your own code is invalid, as accept is", async () => {
  try { await call("/invites/K7PM3Q", INVITER); throw new Error("should have thrown"); }
  catch (e) { assert(e instanceof ApiError); assertEquals((e as ApiError).code, "invalid"); }
});

Deno.test("GET /people: the inviter gets invite_code on the link from their invite, null elsewhere", async () => {
  const { res } = await call("/people", INVITER);
  const j = await res.json();
  const by = (n: string) => j.people.find((p: Row) => (p.person as Row).name === n);
  assertEquals(by("Jo").invite_code, "K7PM3Q");
  assertEquals(by("Sam").invite_code, null);
});

Deno.test("GET /people: the joiner never gets the code of the invite they accepted", async () => {
  const { res } = await call("/people", JOINER);
  const j = await res.json();
  assertEquals(j.people.length, 1);
  assertEquals(j.people[0].invite_code, null);
});
