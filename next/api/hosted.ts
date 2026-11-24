// The hosted entrypoint of the `api` Edge Function (next/scripts/deploy_api.py uploads this tree and names this file).
// The Mac fallback runs the same handler from index.ts on port 8820.
// Speed (CEO 12 Nov): serveInRegion forwards a request that landed far from the database to the database's region, once,
// when the PRESENCE_DB_REGION secret is set (lib/region.ts); unset, every request is served here as before.
import { handler } from "./index.ts";
import { serveInRegion } from "./lib/region.ts";
// Lab candidates use an isolated, free port while retaining the exact hosted
// entrypoint and the staging-only environment.  Supabase leaves PORT unset.
Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000"), hostname: Deno.env.get("HOST") ?? "0.0.0.0" }, (req) => serveInRegion(req, handler));
