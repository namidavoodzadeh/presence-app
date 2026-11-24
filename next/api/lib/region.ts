// Speed (CEO 12 Nov, "Nami waited ~10 s"): Supabase runs an Edge Function in the region nearest the CALLER, not the database.
// Hosted's database is in eu-west-1; from California the function runs in us-west-1 and every query crosses the Atlantic
// (~150-180 ms each, 10-15 in a row on Home). A client can pin the region with an `x-region` header; builds that don't are
// forwarded here, once, to the database's region, where each query is ~20 ms.
//
// Off unless the function secret PRESENCE_DB_REGION is set (rollback: unset it). Never forwards a request the client already
// pinned, never forwards twice (loop guard header). If the forward fails, a read is served here; a write is not repeated.
// The forward goes to this same function on this same project over HTTPS with the caller's own headers; nothing is logged.

import { errorReply } from "./errors.ts";

export const FORWARDED = "x-presence-forwarded-from";

export interface RegionEnv { get(key: string): string | undefined }

/** Whether this request should be served in `want` instead of `here`. */
export function shouldForward(req: Request, here: string, want: string): boolean {
  if (!want || !here || here === want) return false;
  if (req.headers.has("x-region")) return false; // the client chose a region
  if (req.headers.has(FORWARDED)) return false; // already forwarded once
  if (req.method === "OPTIONS") return false;
  return true;
}

/** The public URL of this function for the same path and query (the forward target). */
export function forwardUrl(req: Request, supabaseUrl: string): string {
  const u = new URL(req.url);
  const path = u.pathname.replace(/^\/functions\/v1\/api/, "").replace(/^\/api(?=\/|$)/, "");
  return supabaseUrl.replace(/\/$/, "") + "/functions/v1/api" + path + u.search;
}

const HOP = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);

export async function serveInRegion(
  req: Request,
  handler: (req: Request) => Promise<Response>,
  env: RegionEnv = Deno.env,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const here = env.get("SB_REGION") ?? "", want = env.get("PRESENCE_DB_REGION") ?? "";
  const mark = (r: Response, served: string, from = "") => {
    const h = new Headers(r.headers);
    if (served) h.set("x-presence-region", served);
    if (from) h.set(FORWARDED, from);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  };
  const supabaseUrl = env.get("SUPABASE_URL") ?? "";
  if (!supabaseUrl || !shouldForward(req, here, want)) return mark(await handler(req), here);
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase())) headers.set(k, v); });
  headers.set("x-region", want);
  headers.set(FORWARDED, here);
  try {
    const r = await doFetch(forwardUrl(req, supabaseUrl), { method: req.method, headers, body, redirect: "manual" });
    // A gateway failure in the other region (not an API reply, which always carries server-timing) counts as a failed forward.
    if (r.status >= 500 && !r.headers.has("server-timing")) throw new Error(`forward ${r.status}`);
    return mark(r, r.headers.get("x-presence-region") ?? want, here);
  } catch {
    // A read is served here instead. A write is never run a second time: the far region may already have done it
    // (a Talk turn, a Bridge send) before the connection failed, so it gets the ordinary "can't reach" reply.
    if (body !== null) return mark(errorReply("unreachable", `fwd-${crypto.randomUUID().slice(0, 8)}`, "Can't reach Presence right now."), here);
    return mark(await handler(new Request(req.url, { method: req.method, headers: req.headers })), here);
  }
}
