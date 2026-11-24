// Speed (CEO 12 Nov): a request that lands far from the database is forwarded once to the database's region. $0, no network.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { FORWARDED, forwardUrl, serveInRegion, shouldForward } from "../api/lib/region.ts";

const env = (m: Record<string, string>) => ({ get: (k: string) => m[k] });
const ON = { SB_REGION: "us-west-1", PRESENCE_DB_REGION: "eu-west-1", SUPABASE_URL: "https://proj.supabase.co" };
const local = (req: Request) => Promise.resolve(new Response(JSON.stringify({ served: "local", path: new URL(req.url).pathname }), { headers: { "server-timing": "total;dur=1" } }));

Deno.test("forward only when on, far, unpinned and not yet forwarded", () => {
  const r = (h: Record<string, string> = {}, method = "GET") => new Request("http://x/api/home", { method, headers: h });
  assert(shouldForward(r(), "us-west-1", "eu-west-1"));
  assert(!shouldForward(r(), "eu-west-1", "eu-west-1"), "already in the database's region");
  assert(!shouldForward(r(), "us-west-1", ""), "off without PRESENCE_DB_REGION");
  assert(!shouldForward(r(), "", "eu-west-1"), "region unknown: serve here");
  assert(!shouldForward(r({ "x-region": "us-west-1" }), "us-west-1", "eu-west-1"), "the client pinned a region");
  assert(!shouldForward(r({ [FORWARDED]: "us-west-1" }), "us-west-1", "eu-west-1"), "never twice");
  assert(!shouldForward(r({}, "OPTIONS"), "us-west-1", "eu-west-1"));
});

Deno.test("the forward URL keeps the path and the query on this function", () => {
  assertEquals(forwardUrl(new Request("http://edge/api/threads/abc?x=1"), "https://p.supabase.co/"), "https://p.supabase.co/functions/v1/api/threads/abc?x=1");
  assertEquals(forwardUrl(new Request("http://edge/functions/v1/api/home"), "https://p.supabase.co"), "https://p.supabase.co/functions/v1/api/home");
});

Deno.test("off: served here, untouched, region marked", async () => {
  let fetched = 0;
  const r = await serveInRegion(new Request("http://edge/api/home"), local, env({ SB_REGION: "us-west-1", SUPABASE_URL: "https://p" }), () => { fetched++; return Promise.reject(); });
  assertEquals(fetched, 0);
  assertEquals((await r.json()).served, "local");
  assertEquals(r.headers.get("x-presence-region"), "us-west-1");
});

Deno.test("on: forwarded with the caller's headers, x-region and the loop guard; body and method kept", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response('{"served":"far"}', { status: 201, headers: { "server-timing": "total;dur=2", "x-presence-region": "eu-west-1" } }));
  }) as unknown as typeof fetch;
  const req = new Request("http://edge/api/talk/turn?a=b", { method: "POST", headers: { authorization: "Bearer t", apikey: "k", "x-presence-tz": "UTC", host: "edge" }, body: '{"text":"hi"}' });
  const r = await serveInRegion(req, local, env(ON), fake);
  assertEquals(r.status, 201);
  assertEquals((await r.json()).served, "far");
  assertEquals(r.headers.get("x-presence-region"), "eu-west-1");
  assertEquals(r.headers.get(FORWARDED), "us-west-1");
  const s = seen as unknown as { url: string; init: RequestInit };
  assertEquals(s.url, "https://proj.supabase.co/functions/v1/api/talk/turn?a=b");
  assertEquals(s.init.method, "POST");
  const h = new Headers(s.init.headers);
  assertEquals([h.get("authorization"), h.get("apikey"), h.get("x-presence-tz"), h.get("x-region"), h.get(FORWARDED), h.get("host")], ["Bearer t", "k", "UTC", "eu-west-1", "us-west-1", null]);
  assertEquals(new TextDecoder().decode(s.init.body as ArrayBuffer), '{"text":"hi"}');
});

Deno.test("an API error reply from the far region is passed through as is", async () => {
  const fake = (() => Promise.resolve(new Response('{"error":"internal"}', { status: 500, headers: { "server-timing": "total;dur=2" } }))) as unknown as typeof fetch;
  const r = await serveInRegion(new Request("http://edge/api/home"), local, env(ON), fake);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).error, "internal");
});

Deno.test("the forward failing (network or gateway): a read is served here", async () => {
  for (const fake of [
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
    (() => Promise.resolve(new Response("bad gateway", { status: 502 }))) as unknown as typeof fetch,
  ]) {
    let ran = 0;
    const count = (_req: Request) => { ran++; return Promise.resolve(new Response("{}", { status: 200 })); };
    const r = await serveInRegion(new Request("http://edge/api/home", { headers: { authorization: "Bearer t" } }), count, env(ON), fake);
    assertEquals([r.status, ran], [200, 1]);
    assertEquals(r.headers.get("x-presence-region"), "us-west-1");
    assertEquals(r.headers.get(FORWARDED), null);
  }
});

Deno.test("the forward failing on a write never runs it a second time here: unreachable instead", async () => {
  for (const fake of [
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
    (() => Promise.resolve(new Response("bad gateway", { status: 502 }))) as unknown as typeof fetch,
  ]) {
    let ran = 0;
    const count = (_req: Request) => { ran++; return Promise.resolve(new Response("{}", { status: 200 })); };
    const r = await serveInRegion(new Request("http://edge/api/bridges", { method: "POST", body: "payload" }), count, env(ON), fake);
    assertEquals(ran, 0);
    assertEquals(r.status, 503);
    const j = await r.json();
    assertEquals(j.error, "unreachable");
    assert(String(j.ref).startsWith("fwd-"));
  }
});
