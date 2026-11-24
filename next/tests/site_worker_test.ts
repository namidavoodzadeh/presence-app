// $0 tests for site/_worker.js (kenember.com): the invite page, the Mirror contributor pass-through, the three API calls, the app-links file,
// the kenember.app redirect, and what the worker will not send upstream (no address, cookie, user agent or referrer).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
// @ts-ignore plain JS module
import worker from "../../site/_worker.js";

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
const SLUG = "cber97ta67";
const env = {
  API_ORIGIN: "https://api.invalid",
  API_ANON_KEY: "anon-123",
  ASSETS: { fetch: () => Promise.resolve(new Response("static", { status: 200 })) },
};

async function withFetch(reply: (s: Seen) => Response, run: (seen: Seen[]) => Promise<void>) {
  const real = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => headers[k] = v);
    const body = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : "";
    const s = { url: String(input), method: init?.method ?? "GET", headers, body };
    seen.push(s);
    return Promise.resolve(reply(s));
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request("https://kenember.com" + path, { headers }), env);

Deno.test("kenember.app redirects to kenember.com, path and query kept", async () => {
  const r = await worker.fetch(new Request("https://www.kenember.app/i/K7PM3Q?x=1"), env);
  assertEquals(r.status, 301);
  assertEquals(r.headers.get("location"), "https://kenember.com/i/K7PM3Q?x=1");
});

Deno.test("an invite link shows the open-in-app page and the private-testing line, no API call", async () => {
  await withFetch(() => new Response("no"), async (seen) => {
    const r = await get("/i/k7pm3q");
    assertEquals(r.status, 200);
    assert(r.headers.get("content-type")!.startsWith("text/html"));
    assertEquals(r.headers.get("x-robots-tag"), "noindex, nofollow");
    const html = await r.text();
    assert(html.includes('href="presence://i/K7PM3Q"'));
    assert(html.includes("TestFlight"));
    assertEquals(seen.length, 0);
  });
});

Deno.test("a malformed invite code is a calm 404, never echoed", async () => {
  const r = await get("/i/%3Cscript%3E");
  assertEquals(r.status, 404);
  assertFalse((await r.text()).includes("script>"));
});

Deno.test("the app-links file names the app and /i/* and /m/*", async () => {
  const r = await get("/.well-known/apple-app-site-association");
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("content-type"), "application/json");
  const j = await r.json();
  assertEquals(j.applinks.details[0].appIDs, ["UK39PYVJ96.com.namidavoodzadeh.presence"]);
  assertEquals(j.applinks.details[0].components, [{ "/": "/i/*" }, { "/": "/m/*" }]);
});

Deno.test("the Mirror page comes from the API, served as html on kenember.com, with only the page's own headers upstream", async () => {
  await withFetch(
    () =>
      new Response("<!doctype html><title>Mirror</title>", {
        status: 200,
        headers: { "content-type": "text/plain", "content-security-policy": "sandbox" },
      }),
    async (seen) => {
      const r = await get(`/m/${SLUG}`, {
        accept: "text/html",
        cookie: "a=b",
        "user-agent": "UA",
        referer: "https://x.test/",
        "x-forwarded-for": "1.2.3.4",
        "cf-connecting-ip": "1.2.3.4",
      });
      assertEquals(r.status, 200);
      assertEquals(r.headers.get("content-type"), "text/html; charset=utf-8");
      assertEquals(r.headers.get("content-security-policy"), null);
      assertEquals(r.headers.get("x-robots-tag"), "noindex, nofollow");
      assert((await r.text()).includes("<title>Mirror</title>"));
      assertEquals(seen.length, 1);
      assertEquals(seen[0].url, `https://api.invalid/functions/v1/api/m/${SLUG}`);
      assertEquals(seen[0].headers.accept, "text/html");
      assertEquals(seen[0].headers.apikey, "anon-123");
      for (
        const h of ["cookie", "user-agent", "referer", "x-forwarded-for", "cf-connecting-ip"]
      ) assertEquals(seen[0].headers[h], undefined, h);
    },
  );
});

Deno.test("a closed or unknown Mirror link is one calm page, the API's words are not passed along", async () => {
  await withFetch(
    () => new Response(JSON.stringify({ error: "not_found", detail: "supabase" }), { status: 404 }),
    async () => {
      const r = await get(`/m/${SLUG}`, { accept: "text/html" });
      assertEquals(r.status, 404);
      const html = await r.text();
      assert(html.includes("This link isn't open"));
      assertFalse(html.includes("supabase"));
    },
  );
});

Deno.test("the page's own calls go through: contributions POST and DELETE only, bodies and statuses intact", async () => {
  await withFetch(
    (s) =>
      new Response(JSON.stringify({ ok: s.method }), {
        status: 201,
        headers: { "content-type": "application/json", "set-cookie": "s=1", "x-sb": "1" },
      }),
    async (seen) => {
      const post = await worker.fetch(
        new Request(`https://kenember.com/functions/v1/api/m/${SLUG}/contributions`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: "page-key", cookie: "a=b" },
          body: '{"happening":"x"}',
        }),
        env,
      );
      assertEquals(post.status, 201);
      assertEquals(post.headers.get("set-cookie"), null);
      assertEquals(post.headers.get("x-sb"), null);
      assertEquals(await post.json(), { ok: "POST" });
      assertEquals(seen[0].url, `https://api.invalid/functions/v1/api/m/${SLUG}/contributions`);
      assertEquals(seen[0].body, '{"happening":"x"}');
      assertEquals(seen[0].headers.apikey, "page-key");
      assertEquals(seen[0].headers.cookie, undefined);
      const del = await worker.fetch(
        new Request(`https://kenember.com/functions/v1/api/m/${SLUG}/contributions/0b1c-22`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        env,
      );
      assertEquals(del.status, 201);
      assertEquals(seen[1].method, "DELETE");
    },
  );
});

Deno.test("no other part of the API is reachable through the site", async () => {
  await withFetch(() => new Response("leak"), async (seen) => {
    for (
      const p of [
        "/functions/v1/api/me",
        "/functions/v1/api/beliefs",
        `/functions/v1/api/m/${SLUG}/../me`,
        "/functions/v1/api/mirror",
        "/functions/v1/other",
      ]
    ) {
      const r = await worker.fetch(
        new Request("https://kenember.com" + p, { method: "POST", body: "{}" }),
        env,
      );
      assertEquals(r.status, 404, p);
    }
    const g = await worker.fetch(
      new Request(`https://kenember.com/functions/v1/api/m/${SLUG}/contributions`, { method: "GET" }),
      env,
    );
    assertEquals(g.status, 405);
    assertEquals(seen.length, 0);
  });
});

Deno.test("every other path is the static site", async () => {
  const r = await get("/privacy");
  assertEquals(await r.text(), "static");
});
