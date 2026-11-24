// The route table and request context, shared by the router (index.ts) and the endpoint modules (talk.ts, map.ts, …),
// so a module can register routes without importing the router itself.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ApiEnv } from "./env.ts";
import type { Caller } from "./db.ts";

export type Params = Record<string, string>;
export interface Ctx {
  env: ApiEnv; req: Request; url: URL; params: Params; caller: Caller | null; service: SupabaseClient; tz: string;
  body: () => Promise<Record<string, unknown>>;
}
export type Handler = (ctx: Ctx) => Promise<Response>;
export interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth: boolean }

export const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, auth = true) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, pattern, keys, handler, auth });
}

/** Strip the hosted prefix (/functions/v1/api) or a bare /api so one router serves both hosts. */
export function apiPath(url: URL): string {
  return url.pathname.replace(/^\/functions\/v1\/api/, "").replace(/^\/api(?=\/|$)/, "") || "/";
}
