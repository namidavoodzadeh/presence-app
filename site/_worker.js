// Pages advanced mode for kenember.com.
//  - kenember.app and www.kenember.app redirect to kenember.com (301).
//  - /i/<code>            the invite landing page (open in the app, or the private-testing line).
//  - /m/<slug>            the Mirror contributor page, passed through from the API so the contributor only ever sees kenember.com.
//  - /functions/v1/api/m/<slug>[/contributions[/<id>]]  the three calls that page makes, nothing else of the API.
//  - /.well-known/apple-app-site-association  applinks for /i/* and /m/*.
// Law 12 / contributor privacy: nothing is logged or stored here, no cookies, and the API call carries only the headers the page itself
// sets (never the visitor's address, user agent, referrer or cookies). Everything else is the static site.

const DEFAULT_API_ORIGIN = "https://hqtbaphcfwoaxeikytck.supabase.co";
const APP_ID = "UK39PYVJ96.com.namidavoodzadeh.presence";
const INVITE = /^\/i\/([A-Za-z0-9]{4,12})\/?$/;
const MIRROR = /^\/m\/([a-z0-9]{8,32})\/?$/;
const API_CALL = /^\/functions\/v1\/api\/m\/[a-z0-9]{8,32}(\/contributions(\/[A-Za-z0-9-]{1,64})?)?$/;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>:root{color-scheme:light dark}body{margin:0;font:17px/1.45 -apple-system,system-ui,sans-serif;background:#EDE4DA;color:#1C1A1F;display:flex;min-height:100vh;align-items:center;justify-content:center}@media(prefers-color-scheme:dark){body{background:#0F2527;color:#E8E4DC}}main{max-width:420px;padding:32px 24px}h1{font-size:28px;font-weight:400;margin:0 0 12px}p{margin:12px 0}.muted{opacity:.7;font-size:15px}a.btn{display:flex;align-items:center;justify-content:center;height:56px;border-radius:28px;background:#D9662E;color:#fff;text-decoration:none;font-weight:600;margin:24px 0 12px}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function invitePage(code) {
  const c = code.toUpperCase();
  return shell(
    "Kenember",
    `<h1>Someone invited you to Kenember</h1><a class="btn" href="presence://i/${esc(c)}">Open in Kenember</a><p class="muted">Kenember is in private testing. If the app is not on your phone yet, ask the person who invited you for the TestFlight link, then open this page again.</p>`,
  );
}

function closedPage() {
  return shell("Kenember", `<h1>This link isn't open</h1><p class="muted">It may have been paused or replaced. Ask the person who sent it.</p>`, 404);
}

function notFound() {
  return shell("Kenember", `<h1>Nothing here</h1>`, 404);
}

const AASA = JSON.stringify({
  applinks: {
    details: [{ appIDs: [APP_ID], components: [{ "/": "/i/*" }, { "/": "/m/*" }] }],
  },
});

async function toApi(request, env, pathname) {
  const origin = (env && env.API_ORIGIN) || DEFAULT_API_ORIGIN;
  const headers = new Headers();
  // Only what the page and the function need. No cookies, no address, no user agent, no referrer.
  for (const h of ["accept", "content-type", "authorization", "apikey"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("apikey") && env && env.API_ANON_KEY) headers.set("apikey", env.API_ANON_KEY);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return await fetch(origin + pathname, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });
}

async function mirrorPage(request, env, slug) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const headers = new Headers(request.headers);
  headers.set("accept", "text/html");
  const r = await toApi(new Request(request.url, { method: "GET", headers }), env, `/functions/v1/api/m/${slug}`);
  if (r.status !== 200) return closedPage();
  const body = await r.text();
  // The gateway on the shared domain labels HTML as text/plain and adds a sandbox policy; we serve it as the page it is.
  return new Response(body, { status: 200, headers: PAGE_HEADERS });
}

async function apiCall(request, env, pathname) {
  if (!["POST", "DELETE"].includes(request.method)) return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });
  const r = await toApi(request, env, pathname);
  const out = new Headers({ "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  return new Response(await r.arrayBuffer(), { status: r.status, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "kenember.app" || url.hostname === "www.kenember.app") {
      return Response.redirect("https://kenember.com" + url.pathname + url.search, 301);
    }
    const p = url.pathname;
    if (p === "/.well-known/apple-app-site-association") {
      return new Response(AASA, { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
    }
    let m = INVITE.exec(p);
    if (m) return invitePage(m[1]);
    m = MIRROR.exec(p);
    if (m) return await mirrorPage(request, env, m[1]);
    if (API_CALL.test(p)) return await apiCall(request, env, p);
    if (p.startsWith("/i/") || p.startsWith("/m/") || p.startsWith("/functions/")) return notFound();
    return env.ASSETS.fetch(request);
  },
};
