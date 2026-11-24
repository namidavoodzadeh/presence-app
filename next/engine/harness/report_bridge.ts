// The Bridge report: one HTML file per run (each draft readable with original and bridged side by side, the analysis,
// the plan, every check, the insight panel, and the "sent to / received from the AI" panels) plus summary.md.
//   deno run --allow-read --allow-write next/engine/harness/report_bridge.ts <run-dir>

import type { BridgeManifest } from "./trace.ts";
import type { BridgeTrace } from "../bridge/types.ts";
import type { CheckResult } from "../types.ts";
import { beliefHtml, CSS, esc, exchangeHtml, totalsLine, totalsOf, usageMarkdown, usageRow } from "./report.ts";
import type { UsageRow, UsageTotals } from "./report.ts";

/** One row per call of a draft (analyse, repair, rewrite, verify, retries), in order. */
export function draftUsageRows(t: BridgeTrace): UsageRow[] {
  return t.exchanges.map((x, i) => usageRow(String(i + 1), x));
}

/** Repairs in a draft: the analysis repair plus every rewrite attempt after the first. */
export function draftUsageTotals(t: BridgeTrace): UsageTotals {
  return totalsOf(draftUsageRows(t), (t.analysisRepaired ? 1 : 0) + Math.max(0, t.attempts.length - 1));
}

const EXTRA_CSS = `.side{display:grid;grid-template-columns:1fr 1fr;gap:12px}.side>div{border:1px solid #ddd;border-radius:12px;padding:10px 12px;background:#fff}
.side h4{margin:0 0 6px;font-size:12px;color:#777;text-transform:uppercase}.hl{background:#fff2b3;border-radius:3px}.insight{background:#f3f6fb;border-radius:12px;padding:10px 12px;margin:6px 0}
.insight li{margin:4px 0}.decline{background:#fff3e6;border-radius:12px;padding:10px 12px}`;

function checksHtml(title: string, checks: CheckResult[]): string {
  return `<details class="panel"><summary>${esc(title)} (${checks.filter((c) => c.ok).length}/${checks.length} ok)</summary><ul class="checks">${checks.map((c) => `<li class="${c.ok ? "ok" : "fail"}">${c.ok ? "ok" : "FAIL"} ${esc(c.name)}: ${esc(c.detail)}</li>`).join("")}</ul></details>`;
}

function highlighted(message: string, spans: { start: number; end: number; kind: string }[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "", at = 0;
  for (const s of sorted) { if (s.start < at) continue; out += esc(message.slice(at, s.start)) + `<span class="hl" title="${esc(s.kind)}">${esc(message.slice(s.start, s.end))}</span>`; at = s.end; }
  return out + esc(message.slice(at));
}

function draftHtml(t: BridgeTrace): string {
  const p: string[] = [];
  const d = t.draft, r = t.result;
  p.push(`<section class="conversation" id="${d.id}"><h2>${esc(d.id)} · ${esc(t.sender.firstName)} → ${esc(d.relationship)} <span class="meta">(${esc(t.sender.personaId)}; expected ${esc(d.expected.safety !== "none" ? d.expected.safety : d.expected.nothingToChange ? "nothing to change" : d.expected.frictions.join(", "))}; ${t.exchanges.length} call(s); ${t.cents}¢; ${Math.round(t.ms)} ms)</span></h2>`);
  p.push(`<ul class="targets">${t.targets.map((x) => `<li class="${x.ok ? "ok" : "fail"}">${x.ok ? "PASS" : "FAIL"} ${esc(x.name)}: ${esc(x.detail)}</li>`).join("")}</ul>`);
  p.push(`<div class="meta">hidden intent (never sent to the engine): ${esc(d.hiddenIntent)} · safety floor: ${esc(t.floor.risk)} (${esc(t.floor.reason)}) → ${esc(t.floor.routed)}</div>`);
  const bridgedSide = r.status === "ok" ? `<div><h4>Bridged${r.nothingToChange ? " · nothing to change" : ""}</h4>${esc(r.bridged)}${r.contextNote ? `<div class="meta" style="margin-top:6px">context line: ${esc(r.contextNote)} (cites ${esc(r.usedBeliefs.join(", "))})</div>` : ""}${r.nothingToChange ? `<div class="meta">${esc(r.line)}</div>` : ""}</div>`
    : `<div class="decline"><h4>${esc(r.status)}</h4>${esc(r.line ?? "")}${r.resources ? ` ${r.resources.resources.map((x) => `<a href="${esc(x.url)}">${esc(x.label)}</a>`).join(" ")}` : ""}</div>`;
  p.push(`<div class="side"><div><h4>Original</h4>${t.insight ? highlighted(d.message, t.insight.frictions) : esc(d.message)}</div>${bridgedSide}</div>`);
  if (r.changes.length) p.push(`<div class="meta">what moved (shown to the sender only): ${r.changes.map((c) => `${esc(c.kind)}: “${esc(c.from)}” → “${esc(c.to)}”`).join("; ")}</div>`);
  if (t.insight) {
    const i = t.insight;
    p.push(`<div class="insight"><b>Send mine, with insight</b> <span class="meta">(${esc(i.state)})</span>`);
    if (i.state !== "insight") p.push(`<div>${esc(i.line)}</div>`);
    else {
      p.push(`<ul><li><b>What's in it:</b> ${i.points.map((x) => `${esc(x.kind)} “${esc(x.quote)}”`).join("; ") || "(nothing found)"}</li>`);
      p.push(`<li><b>What might get in the way:</b> ${i.frictions.length ? `<ul>${i.frictions.map((f) => `<li>${esc(f.kind)} “${esc(f.quote)}” [${f.start}–${f.end}] — ${esc(f.howItLands)}</li>`).join("")}</ul>` : "nothing flagged"}</li>`);
      p.push(`<li><b>What it touches in you:</b> ${i.touches.length ? i.touches.map((x) => `${esc(x.label)} — ${esc(x.gentleStatement)}`).join("; ") : "none of your confirmed beliefs"}</li></ul>`);
    }
    p.push("</div>");
  }
  for (const x of t.exchanges.filter((e) => e.purpose.startsWith("analyse"))) p.push(exchangeHtml(x, x.purpose));
  p.push(checksHtml("Analysis checks", t.analysisChecks));
  if (t.analysis) p.push(`<div class="meta">analysis: ${t.analysis.points.length} point(s); feeling ${esc(t.analysis.feeling.name)} ${t.analysis.feeling.intensity}/5; frictions ${esc(t.analysis.frictions.map((f) => `${f.kind} “${f.quote}”`).join("; ") || "none")}; activated ${esc(t.analysis.activated.map((a) => `${a.beliefId} (${a.why})`).join("; ") || "none")}; safety ${esc(t.analysis.safety)} ${esc(t.analysis.safetyReason)}</div>`);
  if (t.plan) p.push(`<div class="meta">plan (code): ${esc(t.plan.outcome)}; register “${esc(t.plan.register)}”; ${t.plan.transformations.map((x) => `${esc(x.kind)} → ${esc(x.instruction)}`).join("; ") || "no transformations"}; context belief ${t.plan.contextBelief ? `${esc(t.plan.contextBelief.id)} “${esc(t.plan.contextBelief.label)}”` : "none"}; receiver-aware ${t.plan.receiverAware}</div>`);
  t.attempts.forEach((a, i) => {
    p.push(`<div class="turn"><h3>Rewrite attempt ${i + 1} <span class="meta">${a.pass ? "passed" : "failed"}</span></h3>`);
    p.push(exchangeHtml(a.exchange, a.exchange.purpose));
    if (a.rewrite) p.push(`<div class="app"><b>Rewrite:</b> ${esc(a.rewrite.bridged)}${a.rewrite.contextNote ? `<br><b>Context line:</b> ${esc(a.rewrite.contextNote)}` : ""}</div>`);
    p.push(checksHtml("Code checks", a.codeChecks));
    if (a.critic) { p.push(exchangeHtml(a.critic.exchange, a.critic.exchange.purpose)); const c = a.critic.read; p.push(`<div class="meta">critic: ${c ? `${c.pass ? "pass" : "fail"}; voice ${c.voice}/5; feeling ${c.feelingPreserved ? "preserved" : "lost"}; missing ${esc(c.pointsMissing.join("; ") || "none")}; added ${esc(c.added.join("; ") || "none")}; receiver inner life ${esc(c.receiverInnerLife.join("; ") || "none")}; ${esc(c.notes)}` : "unreadable"}</div>`); }
    p.push("</div>");
  });
  p.push(`<details class="panel map"><summary>${esc(t.sender.firstName)}'s confirmed map (${t.sender.beliefs.length} belief(s); the receiver's map is never read)</summary><ul>${t.sender.beliefs.map(beliefHtml).join("")}</ul></details></section>`);
  return p.join("\n");
}

export async function writeBridgeReport(dir: URL): Promise<void> {
  const manifest: BridgeManifest = JSON.parse(await Deno.readTextFile(new URL("manifest.json", dir)));
  const traces: BridgeTrace[] = [];
  for (const d of manifest.drafts) traces.push(JSON.parse(await Deno.readTextFile(new URL(d.file, dir))));
  const rows = manifest.drafts.map((d) => `<tr><td><a href="#${d.id}">${esc(d.id)}</a></td><td>${esc(d.sender)} → ${esc(d.relationship)}</td><td>${esc(d.expected)}</td><td>${esc(d.status)}</td><td>${d.calls}</td><td>${d.cents}¢</td><td class="${d.targetsOk === d.targetsTotal ? "ok" : "fail"}">${d.targetsOk}/${d.targetsTotal}</td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(manifest.run)}</title><style>${CSS}${EXTRA_CSS}</style>
<h1>Bridge run ${esc(manifest.run)} <span class="meta">${esc(manifest.mode)}, model ${esc(manifest.model)}, cap ${manifest.capCents}¢, spent ${manifest.cents}¢, ${esc(manifest.startedAt)} → ${esc(manifest.finishedAt)}</span></h1>
<p class="meta">${manifest.notes.map(esc).join("<br>")}</p>
<table><tr><th>id</th><th>sender → receiver</th><th>expected</th><th>status</th><th>calls</th><th>cents</th><th>targets</th></tr>${rows}</table>
${traces.map(draftHtml).join("\n")}`;
  await Deno.writeTextFile(new URL("index.html", dir), html);

  const lines = [`# Bridge run ${manifest.run}`, "", `Mode ${manifest.mode}; model ${manifest.model}; cap ${manifest.capCents}¢; spent ${manifest.cents}¢; ${manifest.drafts.length} draft(s).`, ""];
  for (const n of manifest.notes) lines.push(`- ${n}`);
  lines.push("", "## What worked", "");
  for (const t of traces) for (const x of t.targets.filter((y) => y.ok)) lines.push(`- ${t.draft.id} ${t.sender.firstName} → ${t.draft.relationship}: ${x.name} — ${x.detail} ([open](index.html#${t.draft.id}))`);
  lines.push("", "## What failed", "");
  let failures = 0;
  for (const t of traces) {
    for (const x of t.targets.filter((y) => !y.ok)) { failures++; lines.push(`- ${t.draft.id} ${t.sender.firstName} → ${t.draft.relationship}: ${x.name} — ${x.detail} ([open](index.html#${t.draft.id}))`); }
    if (t.analysisRepaired) lines.push(`- ${t.draft.id}: analysis repaired once (${t.analysisChecks.filter((c) => !c.ok && c.name.startsWith("first:")).map((c) => c.name.slice(6)).join(", ")}) ([open](index.html#${t.draft.id}))`);
    t.attempts.forEach((a, i) => { if (!a.pass) lines.push(`- ${t.draft.id}: rewrite attempt ${i + 1} failed (${[...a.codeChecks.filter((c) => !c.ok).map((c) => c.name), ...(a.critic?.read && !a.critic.read.pass ? ["critic"] : [])].join(", ")}) ([open](index.html#${t.draft.id}))`); });
  }
  if (!failures) lines.push("- nothing failed");
  lines.push("", "## Side by side", "");
  for (const t of traces) {
    lines.push(`### ${t.draft.id} ${t.sender.firstName} → ${t.draft.relationship} (${t.result.status}${t.result.nothingToChange ? ", nothing to change" : ""})`, "", `- Original: ${t.draft.message}`);
    if (t.result.status === "ok" && !t.result.nothingToChange) lines.push(`- Bridged: ${t.result.bridged}`, ...(t.result.contextNote ? [`- Context line: ${t.result.contextNote}`] : []));
    else if (t.result.status !== "ok") lines.push(`- Shown instead: ${t.result.line}`);
    if (t.insight?.state === "insight") lines.push(`- Insight: ${t.insight.frictions.length} friction(s) highlighted, ${t.insight.touches.length} belief(s) touched`);
    lines.push("");
  }
  lines.push("", "## Model usage", "", "Per call in [usage.md](usage.md).", "");
  for (const t of traces) lines.push(`- ${t.draft.id} ${t.sender.firstName} → ${t.draft.relationship}: ${totalsLine(draftUsageTotals(t))}`);
  await Deno.writeTextFile(new URL("summary.md", dir), lines.join("\n") + "\n");
  await Deno.writeTextFile(new URL("usage.md", dir), usageMarkdown(manifest.run, traces.map((t) => ({ title: `${t.draft.id} ${t.sender.firstName} → ${t.draft.relationship}`, rows: draftUsageRows(t), totals: draftUsageTotals(t) }))));
}

if (import.meta.main) {
  const dir = Deno.args[0];
  if (!dir) throw new Error("usage: report_bridge <run-dir>");
  await writeBridgeReport(new URL(dir.endsWith("/") ? dir : dir + "/", `file://${Deno.cwd()}/`));
}
