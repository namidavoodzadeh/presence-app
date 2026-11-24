// One-off scrub (Q65, COO 2026-10-27 17:30 Tehran): the mirror_observe trace rows written before 0f73b8a still carry the moment
// as written inside the package sent (request.messages[*].content). Replace it, row by row, with the same placeholder
// redactMoment() writes today (length and sha256 prefix), so the raw text lives nowhere after processing (thesis, Mirror protections).
// Example-cast contributions only. Dry run by default; --apply writes.
//   deno run --allow-net --allow-read --allow-env next/api/scrub_mirror_trace.ts [--apply]
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";
import { momentInPackage, redactMoment } from "../engine/mirror/observe.ts";

const apply = Deno.args.includes("--apply");
const env = await loadEnv();
const service = serviceClient(env);
type Msg = { role: string; content: string };
type Row = { id: string; purpose: string; created_at: string; request: { messages?: Msg[] } & Record<string, unknown> };

const { data, error } = await service.from("engine_calls").select("id,purpose,created_at,request").in("purpose", ["mirror_observe", "mirror_observe_repair"]).order("created_at");
if (error) { console.error("select failed:", error.message); Deno.exit(2); }
const rows = (data ?? []) as Row[];
let raw = 0, written = 0, failed = 0;
for (const r of rows) {
  const messages = Array.isArray(r.request?.messages) ? r.request.messages : [];
  const hits = messages.filter((m) => typeof m.content === "string" && momentInPackage(m.content) !== null);
  if (!hits.length) continue;
  raw++;
  const next: Msg[] = [];
  let note = "";
  for (const m of messages) {
    const moment = typeof m.content === "string" ? momentInPackage(m.content) : null;
    if (moment === null) { next.push(m); continue; }
    const redacted = await redactMoment(m.content, moment);
    note = redacted.match(/\[deleted once processed: [^\]]+\]/)?.[0] ?? "";
    next.push({ ...m, content: redacted });
  }
  console.log(`${apply ? "scrub" : "would scrub"} ${r.id} ${r.purpose.padEnd(22)} ${r.created_at} ${note}`);
  if (!apply) continue;
  const { error: e } = await service.from("engine_calls").update({ request: { ...r.request, messages: next } }).eq("id", r.id);
  if (e) { failed++; console.error("   ! update failed", r.id, e.message); } else written++;
}
// read back: nothing raw may remain after --apply
const { data: after } = await service.from("engine_calls").select("id,request").in("purpose", ["mirror_observe", "mirror_observe_repair"]);
const left = ((after ?? []) as Row[]).filter((r) => (r.request?.messages ?? []).some((m) => typeof m.content === "string" && momentInPackage(m.content) !== null)).length;
console.log(`rows=${rows.length} raw=${raw} ${apply ? `written=${written} failed=${failed}` : "(dry run, nothing written)"} raw_after=${left}`);
Deno.exit(apply ? (failed === 0 && left === 0 ? 0 : 1) : 0);
