// Issue #11 (setup task A7). Acceptance test written in C4 from packages/01/routes.md and the issue only.
// Every route in contract/openapi.yaml is validated against a real handler response, and renaming one field in the
// file makes this test fail.
//
// API the tests expect:
// - `contract/openapi.yaml`, OpenAPI 3.1. Each operation documents its responses by status code (`"200"`, `"4XX"` or
//   `default` are accepted), each JSON body under `content."application/json".schema`. `$ref` to `#/components/schemas/…`
//   is allowed. A success body is an object schema with a non-empty `required` list.
// - `next/tests/contract_scenarios.ts`, written by the builder (a fixture, not an assertion), exporting
//     export const SCENARIOS: ContractScenario[]
//     interface ContractScenario {
//       operation: string;                    // as in the file: "GET /drafts/{person}"
//       path: string;                         // a concrete path: "/drafts/00000000-0000-4000-8000-0000000000b2"
//       tables?: Record<string, Record<string, unknown>[]>; // the fake database (tests/fake_supabase.ts)
//       env?: Record<string, unknown>;        // ApiEnv fields this route needs (switches, owner lists)
//       callerId?: string;                    // default ME below; ignored for routes registered with auth = false
//       body?: Record<string, unknown>;
//       setup?: () => void | Promise<void>;   // e.g. install a model or Apple double through the module's `hooks`
//       teardown?: () => void | Promise<void>;
//     }
//   At least one scenario per operation must answer 2xx, so every success shape is checked against a real reply.
// - The test runs the handler registered in `next/api` (all modules, through `next/api/index.ts`), never a copy.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { parse } from "jsr:@std/yaml@1";

type Json = unknown;
type Schema = Record<string, Json>;
type Spec = { paths?: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, Schema> } };
type Operation = { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> };
interface ContractScenario {
  operation: string;
  path: string;
  tables?: Record<string, Record<string, unknown>[]>;
  env?: Record<string, unknown>;
  callerId?: string;
  body?: Record<string, unknown>;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}
interface RouteLike {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: (ctx: unknown) => Promise<Response>;
}

const ME = "00000000-0000-4000-8000-0000000000a1";
const METHODS = ["get", "post", "put", "patch", "delete"];

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

async function loadSpec(root: URL): Promise<Spec> {
  return parse(await Deno.readTextFile(new URL("contract/openapi.yaml", root))) as Spec;
}

function operations(spec: Spec): Map<string, Operation> {
  const out = new Map<string, Operation>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const m of METHODS) if (item?.[m]) out.set(`${m.toUpperCase()} ${path}`, item[m]);
  }
  return out;
}

// ---- A small JSON Schema reader: the subset an OpenAPI 3.1 contract uses. Returns a list of problems.
function resolve(spec: Spec, s: Schema): Schema {
  let cur = s;
  for (let i = 0; i < 20 && typeof cur.$ref === "string"; i++) {
    const ref = cur.$ref as string;
    const m = ref.match(/^#\/components\/schemas\/(.+)$/);
    assert(m, `unsupported $ref ${ref}`);
    const next = spec.components?.schemas?.[m[1]];
    assert(next, `$ref ${ref} names no schema`);
    cur = next;
  }
  return cur;
}

function typeOf(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

export function validate(spec: Spec, schema: Schema, value: Json, at = "$"): string[] {
  const s = resolve(spec, schema);
  const errs: string[] = [];
  if (s.allOf) for (const sub of s.allOf as Schema[]) errs.push(...validate(spec, sub, value, at));
  for (const key of ["oneOf", "anyOf"] as const) {
    if (!s[key]) continue;
    const passing = (s[key] as Schema[]).filter((sub) => validate(spec, sub, value, at).length === 0).length;
    if (key === "oneOf" ? passing !== 1 : passing < 1) errs.push(`${at}: matches ${passing} of ${key}`);
  }
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(value)) errs.push(`${at}: not const ${JSON.stringify(s.const)}`);
  if (s.enum && !(s.enum as Json[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  }
  if (s.type !== undefined) {
    const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
    const allowed = new Set(types);
    if (s.nullable === true) allowed.add("null");
    const t = typeOf(value);
    if (!(allowed.has(t) || (t === "integer" && allowed.has("number")))) {
      errs.push(`${at}: is ${t}, expected ${[...allowed].join("|")}`);
      return errs;
    }
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, Json>;
    for (const r of (s.required ?? []) as string[]) if (!(r in obj)) errs.push(`${at}: missing required "${r}"`);
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errs.push(...validate(spec, props[k], v, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}: unexpected "${k}"`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") {
        errs.push(...validate(spec, s.additionalProperties as Schema, v, `${at}.${k}`));
      }
    }
  }
  if (typeOf(value) === "array" && s.items) {
    (value as Json[]).forEach((v, i) => errs.push(...validate(spec, s.items as Schema, v, `${at}[${i}]`)));
  }
  return errs;
}

function responseSchema(op: Operation, status: number): { documented: boolean; schema?: Schema } {
  const r = op.responses ?? {};
  const entry = r[String(status)] ?? r[`${String(status)[0]}XX`] ?? r.default;
  if (!entry) return { documented: false };
  return { documented: true, schema: entry.content?.["application/json"]?.schema };
}

/** Every required property path reached by `value` under `schema`: ["$", "ai_consent"], ["$.ai_consent", "given"], … */
function requiredPaths(spec: Spec, schema: Schema, value: Json, at: string[] = []): string[][] {
  const s = resolve(spec, schema);
  const out: string[][] = [];
  if (typeOf(value) === "object") {
    const obj = value as Record<string, Json>;
    for (const r of (s.required ?? []) as string[]) out.push([...at, r]);
    for (const [k, sub] of Object.entries((s.properties ?? {}) as Record<string, Schema>)) {
      if (k in obj) out.push(...requiredPaths(spec, sub, obj[k], [...at, k]));
    }
  }
  if (typeOf(value) === "array" && s.items && (value as Json[]).length) {
    out.push(...requiredPaths(spec, s.items as Schema, (value as Json[])[0], [...at, "[]"]));
  }
  return out;
}

/** A copy of the spec in which the property at `path` under the operation's response schema is renamed. */
function renamed(spec: Spec, opKey: string, status: string, path: string[]): Spec {
  const copy = structuredClone(spec) as Spec;
  // Inline every $ref along the path so the rename touches only this operation's view of the shape.
  const [method, p] = opKey.split(" ");
  const op = copy.paths![p][method.toLowerCase()];
  const holder = op.responses![status].content!["application/json"];
  holder.schema = structuredClone(resolve(copy, holder.schema!));
  let cur = holder.schema!;
  for (const step of path.slice(0, -1)) {
    if (step === "[]") {
      cur.items = structuredClone(resolve(copy, cur.items as Schema));
      cur = cur.items as Schema;
    } else {
      const props = cur.properties as Record<string, Schema>;
      props[step] = structuredClone(resolve(copy, props[step]));
      cur = props[step];
    }
  }
  const last = path[path.length - 1];
  const props = (cur.properties ?? {}) as Record<string, Schema>;
  const fresh = `${last}_renamed`;
  if (props[last]) {
    props[fresh] = props[last];
    delete props[last];
  }
  cur.required = ((cur.required ?? []) as string[]).map((r) => (r === last ? fresh : r));
  return copy;
}

// ---- Running a real handler
async function load(root: URL) {
  const router = await import(new URL("next/api/lib/router.ts", root).href) as { routes: RouteLike[] };
  await import(new URL("next/api/index.ts", root).href);
  const errors = await import(new URL("next/api/lib/errors.ts", root).href) as {
    ApiError: new (...a: never[]) => Error & { code: string; extra: Record<string, unknown> };
    errorReply: (code: string, ref: string, message: string, extra?: Record<string, unknown>) => Response;
  };
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as {
    fakeClient: (t: Record<string, Record<string, unknown>[]>) => unknown;
  };
  const scenarios = await import(new URL("next/tests/contract_scenarios.ts", root).href) as {
    SCENARIOS: ContractScenario[];
  };
  return { routes: router.routes, errors, fake, scenarios: scenarios.SCENARIOS };
}

function templateMatches(template: string, path: string): boolean {
  const re = new RegExp("^" + template.replace(/\{[^}]+\}/g, "[^/]+") + "$");
  return re.test(path);
}

async function run(
  ctx: Awaited<ReturnType<typeof load>>,
  sc: ContractScenario,
): Promise<{ status: number; body: Json }> {
  const [method] = sc.operation.split(" ");
  const route = ctx.routes.find((r) => r.method === method && r.pattern.test(sc.path));
  assert(route, `no handler registered in next/api for ${method} ${sc.path}`);
  const m = route.pattern.exec(sc.path)!;
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const db = ctx.fake.fakeClient(sc.tables ?? {});
  const url = new URL(`https://contract.invalid${sc.path}`);
  const caller = route.auth
    ? { id: sc.callerId ?? ME, db, persona: null, isExample: false, isPreview: false, profile: {} }
    : null;
  const env = { isHosted: false, releaseBuild: false, ...(sc.env ?? {}) };
  await sc.setup?.();
  let res: Response;
  try {
    res = await route.handler({
      env, req: new Request(url, { method }), url, params, caller, service: db, tz: "UTC",
      body: () => Promise.resolve(sc.body ?? {}),
    }).catch((e: unknown) => {
      if (e instanceof ctx.errors.ApiError) return ctx.errors.errorReply(e.code, "contract-test", e.message, e.extra);
      throw e;
    });
  } finally {
    await sc.teardown?.();
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

Deno.test("#11 every operation in the file has a scenario answering 2xx, and every scenario names an operation", async () => {
  const root = await repoRoot();
  const spec = await loadSpec(root);
  const ops = operations(spec);
  assert(ops.size > 0, "contract/openapi.yaml has no routes yet");
  const { scenarios } = await load(root);
  const named = new Set(scenarios.map((s) => s.operation));
  assertEquals([...named].filter((o) => !ops.has(o)).sort(), [], "scenarios for operations not in the file");
  for (const s of scenarios) {
    assert(templateMatches(s.operation.split(" ")[1], s.path), `${s.path} does not fit ${s.operation}`);
  }
  assertEquals([...ops.keys()].filter((o) => !named.has(o)).sort(), [], "operations with no scenario");
});

Deno.test("#11 each real handler response is documented and matches the file", async () => {
  const root = await repoRoot();
  const spec = await loadSpec(root);
  const ops = operations(spec);
  const ctx = await load(root);
  const succeeded = new Set<string>();
  const problems: string[] = [];
  for (const sc of ctx.scenarios) {
    const op = ops.get(sc.operation);
    if (!op) continue;
    const { status, body } = await run(ctx, sc);
    const { documented, schema } = responseSchema(op, status);
    if (!documented) {
      problems.push(`${sc.operation} answered ${status}, which the file does not document`);
      continue;
    }
    if (status >= 200 && status < 300) succeeded.add(sc.operation);
    if (status === 204) continue;
    if (!schema) {
      problems.push(`${sc.operation} ${status}: the file has no application/json schema`);
      continue;
    }
    for (const e of validate(spec, schema, body)) problems.push(`${sc.operation} ${status} ${e}`);
  }
  assertEquals(problems, []);
  assertEquals([...ops.keys()].filter((o) => !succeeded.has(o)).sort(), [], "operations never seen answering 2xx");
});

Deno.test("#11 renaming any required field in the file fails validation against the real response", async () => {
  const root = await repoRoot();
  const spec = await loadSpec(root);
  const ops = operations(spec);
  const ctx = await load(root);
  const notCaught: string[] = [];
  let checked = 0;
  for (const sc of ctx.scenarios) {
    const op = ops.get(sc.operation);
    if (!op) continue;
    const { status, body } = await run(ctx, sc);
    if (status < 200 || status >= 300 || status === 204) continue;
    const key = op.responses![String(status)] ? String(status) : op.responses!["2XX"] ? "2XX" : "default";
    const schema = op.responses![key].content!["application/json"].schema!;
    const paths = requiredPaths(spec, schema, body);
    assert(paths.length > 0, `${sc.operation} ${status}: the success shape requires no field, so a rename goes unseen`);
    for (const p of paths) {
      checked++;
      const mutated = renamed(spec, sc.operation, key, p);
      const m = mutated.paths![sc.operation.split(" ")[1]][sc.operation.split(" ")[0].toLowerCase()];
      if (validate(mutated, m.responses![key].content!["application/json"].schema!, body).length === 0) {
        notCaught.push(`${sc.operation}: renaming ${p.join(".")} was not caught`);
      }
    }
  }
  assert(checked > 0, "no field was checked");
  assertEquals(notCaught, []);
});
