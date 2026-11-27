// Issue #11 (setup task A7). Acceptance test written in C4 from packages/01/routes.md only.
//
// API the tests expect:
// - `contract/openapi.yaml` lists, under `paths`, exactly the routes in `packages/01/routes.md` "By view":
//   every route there that is not marked "Not ready" is present; a "Not ready" route may be present (it enters with its
//   engine issue); no route outside "By view" is present.
// - Paths use OpenAPI templates: `:person` in routes.md is `{person}` in the file. Methods are lower case, as OpenAPI has them.
// - "Supabase Auth refresh" is not an API route and is not in the file.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { parse } from "jsr:@std/yaml@1";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

async function repoRoot(): Promise<URL> {
  let dir = new URL("./", import.meta.url);
  for (let i = 0; i < 8; i++) {
    try {
      await Deno.stat(new URL("AGENTS.md", dir));
      return dir;
    } catch { dir = new URL("../", dir); }
  }
  throw new Error("repository root (AGENTS.md) not found above " + import.meta.url);
}

/** `GET /drafts/:person` → `GET /drafts/{person}` */
const toOpenApi = (route: string) => route.replace(/:([a-z_]+)/g, "{$1}");

/** The "By view" table of routes.md: each route with whether any row marks it "Not ready". */
export function byView(markdown: string): Map<string, { notReady: boolean }> {
  const start = markdown.indexOf("## By view");
  const end = markdown.indexOf("\n## ", start + 1);
  assert(start >= 0 && end > start, "routes.md has no \"## By view\" section");
  const out = new Map<string, { notReady: boolean }>();
  for (const line of markdown.slice(start, end).split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    const [, view, routeCell, , notes] = cells;
    if (!view || view === "View") continue;
    const notReady = /not ready/i.test(notes ?? "");
    for (const m of routeCell.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`\s]+)`/g)) {
      const key = `${m[1]} ${toOpenApi(m[2])}`;
      const prior = out.get(key);
      out.set(key, { notReady: notReady || (prior?.notReady ?? false) });
    }
  }
  return out;
}

async function fileRoutes(root: URL): Promise<Set<string>> {
  const doc = parse(await Deno.readTextFile(new URL("contract/openapi.yaml", root))) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  const out = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) if (item && method in item) out.add(`${method.toUpperCase()} ${path}`);
  }
  return out;
}

Deno.test("#11 routes.md reader: sees the By view table as the package wrote it", async () => {
  const root = await repoRoot();
  const routes = byView(await Deno.readTextFile(new URL("packages/01/routes.md", root)));
  // Spot checks against the frozen package; if these fail the reader is wrong, not the contract.
  assertEquals(routes.get("POST /auth/apple"), { notReady: false });
  assertEquals(routes.get("POST /auth/google"), { notReady: true });
  assertEquals(routes.get("PUT /drafts/{person}"), { notReady: false });
  assertEquals(routes.get("GET /comm/items"), { notReady: true });
  assertEquals(routes.get("PATCH /cards/{bridge_id}"), { notReady: true });
  assertEquals(routes.get("PUT /links/{person}/share/items/{belief_id}"), { notReady: false });
  assert(![...routes.keys()].some((r) => /refresh/i.test(r)), "Supabase Auth refresh is not an API route");
});

Deno.test("#11 every ready route in routes.md By view is in contract/openapi.yaml", async () => {
  const root = await repoRoot();
  const routes = byView(await Deno.readTextFile(new URL("packages/01/routes.md", root)));
  const file = await fileRoutes(root);
  const missing = [...routes].filter(([r, { notReady }]) => !notReady && !file.has(r)).map(([r]) => r).sort();
  assertEquals(missing, [], "routes in routes.md By view missing from contract/openapi.yaml");
});

Deno.test("#11 contract/openapi.yaml has no route outside routes.md By view", async () => {
  const root = await repoRoot();
  const routes = byView(await Deno.readTextFile(new URL("packages/01/routes.md", root)));
  const file = await fileRoutes(root);
  const extra = [...file].filter((r) => !routes.has(r)).sort();
  assertEquals(extra, [], "routes in contract/openapi.yaml that routes.md By view does not name");
});
