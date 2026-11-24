// E34 (app Q-SD10): POST /diagnostics. The phone's MetricKit crash and hang reports arrive here with the session bearer.
// One `errors` row per report (source "client", where "metrickit"), idempotent on the phone's Ref + person: a resend after a
// lost reply returns the same Ref and writes nothing. Reports are call stacks and timings, never user content; the signed-in
// bearer is required so a stranger cannot fill the table. An oversize report is kept trimmed, never refused, so the phone's
// retry loop cannot be stuck on it.
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { route } from "./lib/router.ts";

export const MAX_REPORT_CHARS = 200_000;
const REF = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const CODES: Record<string, string> = { crash: "client_crash", hang: "client_hang" };

/** Law 10 (CPO d-cpo-reports-redbutton-12nov, ruling a): a fixed allow list, nested. Anything not named is dropped at every level, so a
 * composed exception message, its arguments, a screen trail or a note never reach the row. For an Objective-C exception only the exception
 * name and class name stay. A schema node is a list of allowed keys, each mapped to its child node (null = a plain value). */
type Node = { [key: string]: Node | null } | null;
const FRAME: { [key: string]: Node | null } = { binaryUUID: null, offsetIntoBinaryTextSegment: null, sampleCount: null, binaryName: null, address: null };
FRAME.subFrames = FRAME;
const META: Node = {
  appBuildVersion: null, appVersion: null, bundleIdentifier: null, deviceType: null, exceptionCode: null, exceptionType: null, hangDuration: null,
  isTestFlightApp: null, lowPowerModeEnabled: null, osVersion: null, pid: null, platformArchitecture: null, regionFormat: null, signal: null,
  terminationReason: null, objectiveCexceptionReason: { exceptionName: null, className: null },
};
const ENTRY: Node = {
  version: null, diagnosticMetaData: META,
  callStackTree: { callStackPerThread: null, callStacks: { threadAttributed: null, callStackRootFrames: FRAME } },
};
export const REPORT_SCHEMA: Node = { crashDiagnostics: ENTRY, hangDiagnostics: ENTRY, timeStampBegin: null, timeStampEnd: null };
export const MAX_LEAF_CHARS = 256;
const MAX_DEPTH = 80;

function keep(value: unknown, node: Node, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => keep(v, node, depth)).filter((v) => v !== undefined);
  if (value !== null && typeof value === "object") {
    if (node === null || depth > MAX_DEPTH) return undefined;          // an object where a plain value belongs: dropped
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = Object.keys(node).find((n) => n.toLowerCase() === k.toLowerCase());
      if (key === undefined) continue;
      const kept = keep(v, node[key], depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, MAX_LEAF_CHARS);
  return typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined;
}
export function allowedReport(report: Record<string, unknown>): Record<string, unknown> {
  return keep(report, REPORT_SCHEMA, 0) as Record<string, unknown>;
}

/** The report as stored: whole when it fits, else a marker and the head of its JSON text. */
export function capReport(report: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(report);
  if (text.length <= MAX_REPORT_CHARS) return report;
  // The head is JSON text stored inside JSON, so every quote in it costs two characters; shrink until the stored row fits.
  let n = MAX_REPORT_CHARS - 1000;
  let out = { truncated: true, original_chars: text.length, head: text.slice(0, n) };
  while (JSON.stringify(out).length > MAX_REPORT_CHARS && n > 0) { n = Math.floor(n * 0.9); out = { ...out, head: text.slice(0, n) }; }
  return out;
}

route("POST", "/diagnostics", async (ctx) => {
  const { service, caller } = ctx;
  const person = caller!.id;
  const b = await ctx.body();
  const ref = typeof b.ref === "string" ? b.ref.trim().toUpperCase() : "";
  if (!REF.test(ref)) throw new ApiError("invalid", "", { field: "ref" });
  const code = typeof b.kind === "string" ? CODES[b.kind] : undefined;
  if (!code) throw new ApiError("invalid", "", { field: "kind" });
  if (typeof b.release !== "string" || b.release.length === 0 || b.release.length > 64) throw new ApiError("invalid", "", { field: "release" });
  if (!b.report || typeof b.report !== "object" || Array.isArray(b.report)) throw new ApiError("invalid", "", { field: "report" });
  const report = capReport(allowedReport(b.report as Record<string, unknown>));

  const found = async () => {
    const { data, error } = await service.from("errors").select("ref").eq("person", person).eq("source", "client").eq("client_ref", ref)
      .eq("code", code).maybeSingle();
    if (error) dbError(error, "errors.diagnostics.select");
    return (data as { ref: string } | null)?.ref ?? null;
  };
  const have = await found();
  if (have) return json({ ok: true, ref: have });

  const row = { person, where_: "metrickit", code, source: "client", client_ref: ref, release: b.release, report, detail: `MetricKit ${b.kind} report, release ${b.release}` };
  let { data, error } = await service.from("errors").insert({ ...row, ref }).select("ref").single();   // the phone's Ref when free
  if (error) {
    const again = await found();                                                                         // a concurrent resend won
    if (again) return json({ ok: true, ref: again });
    ({ data, error } = await service.from("errors").insert(row).select("ref").single());                // Ref taken: a fresh one, the phone's kept in client_ref
  }
  if (error) dbError(error, "errors.diagnostics.insert");
  return json({ ok: true, ref: (data as { ref: string }).ref });
});
