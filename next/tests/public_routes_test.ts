// Pins the set of routes that skip the router's built-in bearer check (registered with auth = false).
// Adding or removing a public route must change this list in the same PR, so the change is reviewed.
// /preview/spend and /preview/mirror-sample are here not because they're open to the public, but because
// each must answer release-build 404 before the router's bearer check runs, then authenticates by hand.
// /eval/bridge/run (E27 golden gate) is 404 on hosted, without PRESENCE_BRIDGE_EVAL=true, or without the matching
// eval token; it reads no user and stores nothing (api/bridge_eval.ts, tests/bridge_golden_test.ts).
// Dependency-free on purpose (no jsr:@std imports) so it also runs where jsr.io is unreachable.
import { routes } from "../api/lib/router.ts";
import "../api/index.ts";

const PUBLIC_ROUTES: Array<[string, string]> = [
  ["POST", "/preview/login"],
  ["GET", "/preview/spend"],
  ["POST", "/preview/mirror-sample"],
  ["POST", "/auth/apple"],
  ["POST", "/auth/google"], // v1.74: the Google twin of /auth/apple; Supabase Auth checks the token
  ["POST", "/feedback"],
  ["GET", "/m/:slug"],
  ["POST", "/m/:slug/contributions"],
  ["DELETE", "/m/:slug/contributions/:id"],
  ["POST", "/internal/push/drain"],
  ["POST", "/internal/checkin/remind"], // E32: secret-gated like the drain; 404 without it
  ["GET", "/health"],
  ["POST", "/eval/bridge/run"],
];

// The same path-to-pattern rule as route() in api/lib/router.ts.
function patternSource(path: string): string {
  return new RegExp("^" + path.replace(/:([a-z_]+)/g, "([^/]+)") + "/?$").source;
}

Deno.test("exactly these 13 routes are registered with auth = false", () => {
  const actual = routes.filter((r) => !r.auth).map((r) => `${r.method} ${r.pattern.source}`).sort();
  const expected = PUBLIC_ROUTES.map(([method, path]) => `${method} ${patternSource(path)}`).sort();
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`auth=false routes changed.\nexpected:\n${expected.join("\n")}\nactual:\n${actual.join("\n")}`);
  }
});
