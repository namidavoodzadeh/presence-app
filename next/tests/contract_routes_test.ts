import { assertEquals, assertGreater } from "jsr:@std/assert@1";

const METHODS = "GET|POST|PUT|PATCH|DELETE";
const ALLOWLIST = new URL("./fixtures/contract_route_allowlist.txt", import.meta.url);
const CONTRACT = new URL("../api/CONTRACT.md", import.meta.url);
const API = new URL("../api/", import.meta.url);

type Direction = "contract_only" | "registered_only";

function contractRoutes(text: string): Set<string> {
  const start = text.indexOf("## 0. Transport");
  const proposal = text.indexOf("## 11. Proposed");
  const builtAfterProposal = text.indexOf("## 12. APNs");
  if (start < 0 || proposal < 0 || builtAfterProposal < 0) {
    throw new Error("CONTRACT.md section boundaries changed; update the route-table reader explicitly");
  }
  const built = text.slice(start, proposal) + text.slice(builtAfterProposal);
  const routes = new Set<string>();
  const pattern = new RegExp(`\\b(${METHODS})\\s+(/[^\\s\`\"|,)]+)`, "g");
  for (const match of built.matchAll(pattern)) {
    const path = match[2].replace(/[.:;]+$/, "").replace(/\?.*$/, "");
    routes.add(`${match[1]} ${path}`);
  }
  return routes;
}

async function registeredRoutes(): Promise<Set<string>> {
  const routes = new Set<string>();
  const pattern = new RegExp(`\\broute\\(\\s*\"(${METHODS})\"\\s*,\\s*\"([^\"]+)\"`, "g");
  for await (const entry of Deno.readDir(API)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(new URL(entry.name, API));
    for (const match of source.matchAll(pattern)) routes.add(`${match[1]} ${match[2]}`);
  }
  return routes;
}

async function allowedGaps(): Promise<Map<Direction, Map<string, string>>> {
  const gaps = new Map<Direction, Map<string, string>>([
    ["contract_only", new Map()],
    ["registered_only", new Map()],
  ]);
  for (const [index, raw] of (await Deno.readTextFile(ALLOWLIST)).split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [direction, route, reason, ...extra] = raw.split("\t");
    if (
      (direction !== "contract_only" && direction !== "registered_only") || !route || !reason || extra.length
    ) {
      throw new Error(`invalid allowlist line ${index + 1}: expected direction, route, and one-line reason`);
    }
    assertGreater(reason.trim().length, 20, `allowlist line ${index + 1} needs a useful reason`);
    gaps.get(direction)!.set(route.trim(), reason.trim());
  }
  return gaps;
}

Deno.test("E5 CONTRACT built routes and next/api registrations stay in sync", async () => {
  const contract = contractRoutes(await Deno.readTextFile(CONTRACT));
  const registered = await registeredRoutes();
  const allowed = await allowedGaps();

  const contractOnly = [...contract].filter((route) => !registered.has(route)).sort();
  const registeredOnly = [...registered].filter((route) => !contract.has(route)).sort();
  assertEquals(contractOnly, [...allowed.get("contract_only")!.keys()].sort());
  assertEquals(registeredOnly, [...allowed.get("registered_only")!.keys()].sort());

  for (const route of allowed.get("contract_only")!.keys()) {
    if (!contract.has(route) || registered.has(route)) {
      throw new Error(`stale contract_only allowlist row: ${route}`);
    }
  }
  for (const route of allowed.get("registered_only")!.keys()) {
    if (!registered.has(route) || contract.has(route)) {
      throw new Error(`stale registered_only allowlist row: ${route}`);
    }
  }
});
