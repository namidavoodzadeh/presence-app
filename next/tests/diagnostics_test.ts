// E34: POST /diagnostics, the phone's MetricKit crash and hang reports (app Q-SD10). Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { MAX_REPORT_CHARS } from "../api/diagnostics.ts";

const A = "00000000-0000-4000-8000-000000000071";
const B = "00000000-0000-4000-8000-000000000072";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: unknown }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; val: Row = {}; one = false;
  constructor(private rows: Row[], private takenRefs: Set<string>) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    if (this.kind === "insert") {
      const ref = (this.val.ref as string | undefined) ?? "ZZZZ";
      if (this.rows.some((x) => x.ref === ref)) return { data: null, error: { message: "duplicate key" } };
      const row = { id: crypto.randomUUID(), ref, ...this.val };
      this.rows.push(row);
      return { data: this.one ? { ...row } : [{ ...row }], error: null };
    }
    const out = this.rows.filter((x) => this.eqs.every(([c, v]) => x[c] === v)).map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null };
  }
}
const tables = (): Record<string, Row[]> => ({ errors: [] });
function call(body: Row, caller: string | null, t: Record<string, Row[]>) {
  const f = routes.find((r) => r.method === "POST" && r.pattern.test("/diagnostics"));
  assert(f, "no route POST /diagnostics");
  const db = { from: (n: string) => new Q(t[n] ??= [], new Set()) };
  return f.handler({
    env: {}, req: new Request("https://x.invalid/diagnostics", { method: "POST" }), url: new URL("https://x.invalid/diagnostics"),
    params: {}, caller: caller ? { id: caller, isPreview: false, db } : null, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}
async function rejects(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { assert(e instanceof ApiError); return e; }
  throw new Error("expected ApiError");
}
const ok = { ref: "7F3K", kind: "crash", release: "0.9 (55)", report: { crashDiagnostics: [{ callStackTree: "x" }], timeStampBegin: "2026-11-08" } };

Deno.test("E34 stores one client row with the phone's Ref, the release and the report", async () => {
  const t = tables();
  const r = await (await call(ok, A, t)).json();
  assertEquals(r, { ok: true, ref: "7F3K" });
  assertEquals(t.errors.length, 1);
  const e = t.errors[0];
  assertEquals([e.source, e.code, e.where_, e.person, e.client_ref], ["client", "client_crash", "metrickit", A, "7F3K"]);
  assertEquals(e.release, "0.9 (55)");
  assertEquals((e.report as Row).timeStampBegin, "2026-11-08");
});

Deno.test("E34 a hang is client_hang", async () => {
  const t = tables();
  await call({ ...ok, ref: "9AAA", kind: "hang" }, A, t);
  assertEquals(t.errors[0].code, "client_hang");
});

Deno.test("E34 a resend after a lost reply does not duplicate, and returns the same ref", async () => {
  const t = tables();
  await call(ok, A, t);
  const again = await (await call(ok, A, t)).json();
  assertEquals(again, { ok: true, ref: "7F3K" });
  assertEquals(t.errors.length, 1);
});

Deno.test("E34 the same Ref from another person is its own row; the phone's Ref moves to client_ref when taken", async () => {
  const t = tables();
  await call(ok, A, t);
  const r = await (await call(ok, B, t)).json();
  assertEquals(t.errors.length, 2);
  assert(r.ref !== "7F3K" || t.errors[1].ref !== t.errors[0].ref);
  assertEquals(t.errors[1].client_ref, "7F3K");
  assertEquals(t.errors[1].person, B);
});

Deno.test("E34 an oversize report is kept trimmed, not refused", async () => {
  const t = tables();
  const frame = { binaryName: "x".repeat(256), address: 1 };   // string leaves are cut at 256, so a big report is many frames
  const big = { crashDiagnostics: [{ callStackTree: { callStacks: [{ callStackRootFrames: Array.from({ length: 2000 }, () => frame) }] } }] };
  const r = await (await call({ ...ok, report: big }, A, t)).json();
  assertEquals(r.ok, true);
  const stored = t.errors[0].report as Row;
  assertEquals(stored.truncated, true);
  assert(JSON.stringify(stored).length <= MAX_REPORT_CHARS + 500);
  assert((stored.original_chars as number) > MAX_REPORT_CHARS);
});

Deno.test("E34 bad fields are named", async () => {
  const t = tables();
  for (const [patch, field] of [[{ ref: "abc" }, "ref"], [{ ref: "0OIL" }, "ref"], [{ kind: "oops" }, "kind"], [{ release: 5 }, "release"], [{ report: "text" }, "report"], [{ report: [1] }, "report"]] as const) {
    assertEquals((await rejects(() => call({ ...ok, ...patch }, A, t))).extra.field, field);
  }
  assertEquals(t.errors.length, 0);
});

Deno.test("E34 the route requires a signed-in person (the router rejects a missing bearer)", () => {
  assertEquals(routes.find((r) => r.method === "POST" && r.pattern.test("/diagnostics"))?.auth, true);
});

Deno.test("E34 a lowercase ref is accepted as its uppercase form", async () => {
  const t = tables();
  assertEquals((await (await call({ ...ok, ref: "7f3k" }, A, t)).json()).ref, "7F3K");
});

Deno.test("law 10: keys outside the MetricKit set are dropped before storing", async () => {
  const t = tables();
  await call({ ...ok, report: { ...ok.report, screenTrail: ["Talk", "You"], note: "words from a person" } }, A, t);
  assertEquals(Object.keys(t.errors[0].report as Row).sort(), ["crashDiagnostics", "timeStampBegin"]);
});

Deno.test("law 10 (CPO ruling a): nested allow list keeps stacks and facts, drops the composed exception message, arguments and unknown nested fields", async () => {
  const t = tables();
  const report = {
    crashDiagnostics: [{
      version: "1.0.0",
      diagnosticMetaData: {
        appVersion: "0.9", osVersion: "iPhone OS 26.1", signal: "6", exceptionType: 6, terminationReason: "Namespace SIGNAL, Code 6",
        objectiveCexceptionReason: { exceptionName: "NSInvalidArgumentException", className: "NSDictionary", composedMessage: "-[X y]: could not read Maya's words", arguments: ["hello Maya"], formatString: "%@" },
        note: "text a person typed", virtualMemoryRegionInfo: "0 is not in any region",
      },
      callStackTree: {
        callStackPerThread: false,
        callStacks: [{ threadAttributed: true, extra: "x", callStackRootFrames: [{ binaryName: "Presence", address: 4300, sampleCount: 1, label: "text", subFrames: [{ binaryName: "UIKit", address: 1, screenTrail: ["Talk"], subFrames: [] }] }] }],
      },
      userText: "words",
    }],
    hangDiagnostics: [{ diagnosticMetaData: { hangDuration: "3.2 sec" }, comment: "x" }],
    timeStampBegin: "2026-11-08", screenTrail: ["Talk"],
  };
  await call({ ...ok, report }, A, t);
  const stored = t.errors[0].report as Row;
  const text = JSON.stringify(stored);
  for (const bad of ["Maya", "hello", "composedMessage", "arguments", "formatString", "note", "virtualMemoryRegionInfo", "userText", "screenTrail", "label", "extra", "comment"]) {
    assert(!text.includes(bad), `${bad} should have been dropped: ${text}`);
  }
  for (const good of ["NSInvalidArgumentException", "NSDictionary", "Presence", "UIKit", "Namespace SIGNAL", "3.2 sec", "2026-11-08", "callStackPerThread"]) {
    assert(text.includes(good), `${good} should be kept: ${text}`);
  }
});

Deno.test("law 10: a long string leaf is cut and an object where a value belongs is dropped", async () => {
  const t = tables();
  await call({ ...ok, report: { crashDiagnostics: [{ diagnosticMetaData: { terminationReason: "x".repeat(5000), signal: { deep: "text" } } }] } }, A, t);
  const meta = ((t.errors[0].report as Row).crashDiagnostics as Row[])[0].diagnosticMetaData as Row;
  assertEquals((meta.terminationReason as string).length, 256);
  assertEquals("signal" in meta, false);
});
