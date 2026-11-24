// One self-contained HTML file per run plus summary.md: each conversation readable as a chat, with
// expandable "sent to the AI" and "received from the AI" panels, every check, and the final map per persona.
//   deno task report <run-dir>

import type { ConversationTrace, RunManifest } from "./trace.ts";
import type { Belief, ModelExchange } from "../types.ts";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exchangeHtml(x: ModelExchange, title: string): string {
  const msgs = x.request.messages.map((m) => `<div class="msg ${m.role}"><b>${m.role}</b><pre>${esc(m.content)}</pre></div>`).join("");
  return `<details class="panel"><summary>Sent to the AI (${esc(title)}; ${esc(x.request.model)}, max ${x.request.maxTokens} tokens${x.request.thinking ? ", thinking " + esc(x.request.thinking) : ""}${x.request.effort ? ", effort " + esc(x.request.effort) : ""})</summary>
<div class="msg system"><b>system</b><pre>${esc(x.request.system)}</pre></div>${msgs}</details>
<details class="panel"><summary>Received from the AI (${esc(title)}; ${x.usage.inputTokens} in / ${x.usage.outputTokens} out, ${x.usage.cents}¢, ${Math.round(x.usage.ms)} ms${x.usage.blocks?.length ? "; blocks " + esc(x.usage.blocks.join("+")) : ""}${x.usage.stopReason ? "; stop " + esc(x.usage.stopReason) : ""}${x.error ? "; error: " + esc(x.error) : ""})</summary><pre>${esc(x.rawResponse || "(empty)")}</pre></details>`;
}

export function beliefHtml(b: Belief): string {
  const links = b.links.map((l) => `${esc(l.type)} → ${esc(l.to)}`).join(", ");
  return `<li class="belief ${b.status}"><b>${esc(b.label)}</b> <span class="pill">${esc(b.type)}</span> <span class="meta">${esc(b.level)} · ${esc(b.domains.join(", "))} · ${b.confidence.toFixed(2)} · ${esc(b.status)}${b.changed ? " · changed" : ""}</span>
<div>${esc(b.statement)}</div><ul class="receipts">${b.receipts.map((r) => `<li>“${esc(r.quote)}” <span class="meta">${esc(r.date)}</span></li>`).join("")}</ul>${links ? `<div class="meta">links: ${links}</div>` : ""}</li>`;
}

function conversationHtml(c: ConversationTrace): string {
  const parts: string[] = [];
  parts.push(`<section class="conversation" id="${c.id}"><h2>${esc(c.id)} · ${esc(c.personaName)} <span class="meta">(${esc(c.personaId)}, ${esc(c.style)}; ${esc(c.kind)}, session ${c.sessionNumber}; ${c.turns.length} turns; ${c.cents}¢; ${Math.round(c.ms / 1000)} s; stopped by ${esc(c.stoppedBy)})</span></h2>`);
  parts.push(`<ul class="targets">${c.targets.map((t) => `<li class="${t.ok ? "ok" : "fail"}">${t.ok ? "PASS" : "FAIL"} ${esc(t.name)}: ${esc(t.detail)}</li>`).join("")}</ul>`);
  if (c.opener) parts.push(`<div class="app opener">App, from last time: ${esc(c.opener)}</div>`);
  for (const t of c.turns) {
    parts.push(`<div class="turn" id="${c.id}-t${t.turn}"><h3>Turn ${t.turn} <span class="meta">${t.cents}¢ · ${Math.round(t.ms)} ms</span></h3>`);
    if (t.ratingsApplied && Object.keys(t.ratingsApplied).length) parts.push(`<div class="rating">Rated: ${esc(Object.entries(t.ratingsApplied).map(([k, v]) => `${k} ${v}`).join(", "))}</div>`);
    if (t.consent) parts.push(`<div class="rating">Permission for ${esc(t.consent.domain)}: ${esc(t.consent.answer)}</div>`);
    parts.push(`<div class="person"><b>${esc(c.personaName.split(" ")[0])}:</b> ${esc(t.sim.message || "(no message)")}${t.sim.failed ? ` <span class="fail">[simulated user failed: ${esc(t.sim.failed)}]</span>` : ""}</div>`);
    if (t.sim.note) parts.push(`<div class="note">private note (never sent to the engine): ${esc(t.sim.note)}</div>`);
    for (const x of t.sim.retries ?? []) parts.push(exchangeHtml(x, "simulated user, cut off"));
    if (t.sim.exchange) parts.push(exchangeHtml(t.sim.exchange, "simulated user"));
    const e = t.engine;
    if (!e) { parts.push("</div>"); continue; }
    parts.push(`<div class="floor meta">safety floor: ${esc(e.floor.risk)} (${esc(e.floor.reason)})</div>`);
    for (const x of e.exchanges) parts.push(exchangeHtml(x, x.purpose));
    parts.push(`<details class="panel"><summary>Checks (${e.checks.filter((k) => k.ok).length}/${e.checks.length} ok${e.repaired ? "; repaired once" : ""})</summary><ul class="checks">${e.checks.map((k) => `<li class="${k.ok ? "ok" : "fail"}">${k.ok ? "ok" : "FAIL"} ${esc(k.name)}: ${esc(k.detail)}</li>`).join("")}</ul></details>`);
    if (e.parsed) parts.push(`<div class="meta">move: ${esc(e.parsed.move.kind)} — ${esc(e.parsed.move.why)} (gap: ${esc(e.parsed.move.gap)})</div>`);
    const s = e.shown;
    if (s.state === "safety") parts.push(`<div class="app safety"><b>App stops mapping and shows resources:</b> ${esc(s.safety?.message)} ${s.safety?.resources.map((r) => `<a href="${esc(r.url)}">${esc(r.label)}</a>`).join(" ")}</div>`);
    else {
      if (e.failed) parts.push(`<div class="fail">Model call failed: ${esc(e.failed)}</div>`);
      for (const w of e.warnings ?? []) parts.push(`<div class="warn">warning: ${esc(w)}</div>`);
      parts.push(`<div class="app"><b>App:</b> ${esc(s.reflection)}<br><b>App:</b> ${esc(s.question)}${s.state === "permission" ? ` <span class="pill">permission: ${esc(s.permissionDomain)} · Sure / Not now / Never</span>` : ""}</div>`);
      for (const card of s.cards) parts.push(`<div class="card"><b>${esc(card.label)}</b> <span class="pill">${esc(card.type)}</span><div>${esc(card.statement)}</div><div class="meta">Is this you? Not me · Partly · Very me</div></div>`);
      if (s.earlyGuess) parts.push(`<div class="card guess"><span class="meta">early guess</span> <b>${esc(s.earlyGuess.label)}</b> <div>${esc(s.earlyGuess.statement)}</div><div class="meta">Is this you?</div></div>`);
      const quiet = e.hypotheses.filter((h) => !s.cards.some((card) => card.beliefId === h.id));
      if (quiet.length) parts.push(`<div class="meta">kept quiet (under 0.7 or already shown): ${quiet.map((h) => `${esc(h.label)} ${h.confidence.toFixed(2)}`).join("; ")}</div>`);
    }
    parts.push("</div>");
  }
  const rs = c.riskStop;
  if (rs) {
    parts.push(`<div class="turn finish" id="${c.id}-finish"><h3>Risk stop at turn ${rs.turn} <span class="meta">Finish not called</span></h3>` +
      `<div class="app">Mapping stopped and resources were shown. Nothing from turn ${rs.turn} was kept. ${rs.kept.length} card(s) the person had rated Very me or Partly stay on the map as shown${rs.kept.length ? `: ${esc(rs.kept.join(", "))}` : ""}.` +
      `${rs.leftOut.length ? `<br><span class="meta">left out: ${esc(rs.leftOut.join("; "))}</span>` : ""}</div></div>`);
  }
  const f = c.finish;
  if (f) {
    parts.push(`<div class="turn finish" id="${c.id}-finish"><h3>Finish <span class="meta">${f.cents}¢</span></h3>`);
    if (f.exchange) parts.push(exchangeHtml(f.exchange, "finish"));
    if (f.repairExchange) parts.push(exchangeHtml(f.repairExchange, "finish label rename"));
    parts.push(`<details class="panel"><summary>Checks (${f.checks.filter((k) => k.ok).length}/${f.checks.length} ok)</summary><ul class="checks">${f.checks.map((k) => `<li class="${k.ok ? "ok" : "fail"}">${k.ok ? "ok" : "FAIL"} ${esc(k.name)}: ${esc(k.detail)}</li>`).join("")}</ul></details>`);
    if (f.failed) parts.push(`<div class="fail">Finish failed: ${esc(f.failed)}</div>`);
    for (const card of f.cards) parts.push(`<div class="card"><b>${esc(card.label)}</b> <span class="pill">${esc(card.type)}</span> <span class="meta">${esc(card.level)} · ${esc(card.domains.join(", "))} · ${card.confidence.toFixed(2)} · rated ${esc(card.rating ?? "not yet")}${card.mapId ? " · same as " + esc(card.mapId) : ""}${card.tensionWith ? " · tension with " + esc(card.tensionWith) : ""}</span><div>${esc(card.statement)}</div><ul class="receipts">${card.receipts.map((r) => `<li>“${esc(r)}”</li>`).join("")}</ul></div>`);
    parts.push(`<div class="app"><b>What was noticed:</b> ${esc(f.summary || "(none)")}<br><b>Next time:</b> ${esc(f.nextTime || "(none)")}</div>`);
    const r = f.reconciled;
    parts.push(`<div class="meta">reconciled: ${r.newReceipts.length} new receipt(s) ${esc(r.newReceipts.join("; "))}; tensions ${esc(r.tensions.join("; ") || "none")}; added ${r.added.length}; changed ${r.changed.length}</div></div>`);
  }
  parts.push(`<details class="panel map"><summary>Final map for ${esc(c.personaName)} (${c.mapAfter.beliefs.length} belief(s); consent: ${esc(Object.entries(c.mapAfter.consent).map(([d, v]) => `${d} ${v}`).join(", ") || "none recorded")})</summary><ul>${c.mapAfter.beliefs.map(beliefHtml).join("")}</ul>${c.mapAfter.openThreads.length ? `<div class="meta">open threads: ${esc(c.mapAfter.openThreads.join("; "))}</div>` : ""}</details></section>`);
  return parts.join("\n");
}

export const CSS = `body{font:15px/1.45 -apple-system,system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:22px}h2{font-size:18px;margin-top:40px;border-top:1px solid #ddd;padding-top:16px}h3{font-size:15px;margin:18px 0 6px}
.meta{color:#777;font-weight:normal;font-size:13px}.pill{border:1px solid #bbb;border-radius:12px;padding:0 8px;font-size:12px;color:#555}
.person{background:#f3f6fb;border-radius:12px;padding:10px 12px;margin:6px 0}.app{background:#f7f7f2;border-radius:12px;padding:10px 12px;margin:6px 0}
.app.safety{background:#fff3e6}.card{border:1px solid #ddd;border-radius:12px;padding:8px 12px;margin:6px 0 6px 24px;background:#fff}
.card.guess{border-style:dashed}.note{color:#8a6d3b;font-size:13px;margin:2px 0 6px 12px}.rating{color:#2a6;font-size:13px}
.panel{margin:4px 0 4px 12px;font-size:13px}.panel summary{cursor:pointer;color:#456}.panel pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:8px;font-size:12px;max-height:480px;overflow:auto}
.msg b{display:block;color:#888;font-size:11px;text-transform:uppercase}.checks li.fail,.targets li.fail,.fail{color:#b00020}.warn{color:#b26a00;font-size:12px}.checks li.ok,.targets li.ok{color:#2a6}
ul.targets{list-style:none;padding:0}ul.targets li{font-size:13px}.receipts{font-size:13px;color:#555}.belief.disputed{opacity:.6}.belief.inferred{opacity:.8}
table{border-collapse:collapse}td,th{border-bottom:1px solid #eee;padding:4px 10px;text-align:left;font-size:13px}`;

export interface UsageRow { turn: string; purpose: string; blocks: string; inputTokens: number; outputTokens: number; maxTokens: number; stop: string; ms: number; cents: number; error: string }

export function usageRow(turn: string, x: ModelExchange): UsageRow {
  return { turn, purpose: x.purpose, blocks: x.usage.blocks?.join("+") ?? "", inputTokens: x.usage.inputTokens, outputTokens: x.usage.outputTokens,
    maxTokens: x.request.maxTokens, stop: x.usage.stopReason ?? "", ms: Math.round(x.usage.ms), cents: x.usage.cents, error: x.error ?? "" };
}

/** One row per model call (simulated user, turn, repair, Finish), in order: where the output tokens went and what stopped each reply. */
export function usageRows(t: ConversationTrace): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const turn of t.turns) {
    for (const x of turn.sim.retries ?? []) rows.push(usageRow(String(turn.turn), x));
    if (turn.sim.exchange) rows.push(usageRow(String(turn.turn), turn.sim.exchange));
    for (const x of turn.engine?.exchanges ?? []) rows.push(usageRow(String(turn.turn), x));
  }
  if (t.finish?.exchange) rows.push(usageRow("finish", t.finish.exchange));
  if (t.finish?.repairExchange) rows.push(usageRow("finish_repair", t.finish.repairExchange));
  return rows;
}

export interface UsageTotals { calls: number; inputTokens: number; outputTokens: number; cutOff: number; thinking: number; repairs: number; cents: number; outputPerEngineCall: number }

/** The numbers a run's model setting is judged on (A47(2), A48 Q48(a)): cut-off replies, thinking blocks, repairs, output tokens per
 *  engine call (every call that is not the simulated user). */
export function totalsOf(rows: UsageRow[], repairs: number): UsageTotals {
  const engine = rows.filter((r) => !r.purpose.startsWith("sim_user"));
  const out = { calls: rows.length, inputTokens: 0, outputTokens: 0, cutOff: 0, thinking: 0, repairs, cents: 0,
    outputPerEngineCall: engine.length ? Math.round(engine.reduce((n, r) => n + r.outputTokens, 0) / engine.length) : 0 };
  for (const r of rows) {
    out.inputTokens += r.inputTokens; out.outputTokens += r.outputTokens; out.cents += r.cents;
    if (r.stop === "max_tokens" || (r.outputTokens > 0 && r.outputTokens >= r.maxTokens)) out.cutOff++;
    if (r.blocks.split("+").includes("thinking")) out.thinking++;
  }
  return out;
}

export function usageTotals(t: ConversationTrace): UsageTotals {
  return totalsOf(usageRows(t), t.turns.filter((x) => x.engine?.repaired).length + (t.finish?.repairExchange ? 1 : 0));
}

export interface ConfidenceSummary { proposals: number; under50: number; from50to69: number; from70: number; beliefs: number; beliefsAt70: number; max: number }

/** A48 Q48(c) → ii: the model's own calibration — where every proposed confidence landed (per turn, after checks) and how many
 *  distinct beliefs ever reached the 0.7 card line, so the owner can read the distribution before anyone moves the threshold. */
export function confidenceSummary(t: ConversationTrace): ConfidenceSummary {
  const out: ConfidenceSummary = { proposals: 0, under50: 0, from50to69: 0, from70: 0, beliefs: 0, beliefsAt70: 0, max: 0 };
  const best = new Map<string, number>();
  for (const turn of t.turns) {
    for (const h of turn.engine?.hypotheses ?? []) {
      out.proposals++;
      if (h.confidence >= 0.7) out.from70++; else if (h.confidence >= 0.5) out.from50to69++; else out.under50++;
      out.max = Math.max(out.max, h.confidence);
      const key = h.id ?? `${h.label}|${h.statement}`;
      best.set(key, Math.max(best.get(key) ?? 0, h.confidence));
    }
  }
  out.beliefs = best.size;
  out.beliefsAt70 = [...best.values()].filter((c) => c >= 0.7).length;
  return out;
}

export function confidenceTotals(all: ConfidenceSummary[]): ConfidenceSummary {
  return all.reduce((a, c) => ({ proposals: a.proposals + c.proposals, under50: a.under50 + c.under50, from50to69: a.from50to69 + c.from50to69,
    from70: a.from70 + c.from70, beliefs: a.beliefs + c.beliefs, beliefsAt70: a.beliefsAt70 + c.beliefsAt70, max: Math.max(a.max, c.max) }),
    { proposals: 0, under50: 0, from50to69: 0, from70: 0, beliefs: 0, beliefsAt70: 0, max: 0 });
}

export function confidenceLine(c: ConfidenceSummary): string {
  return `${c.proposals} proposal(s): ${c.under50} under 0.50, ${c.from50to69} at 0.50–0.69, ${c.from70} at 0.70 or more; ` +
    `${c.beliefsAt70} of ${c.beliefs} belief(s) reached the 0.7 card line; highest ${c.max.toFixed(2)}`;
}

export function totalsLine(u: UsageTotals): string {
  return `${u.calls} call(s), ${u.inputTokens} in / ${u.outputTokens} out tokens, ${u.outputPerEngineCall} out per engine call, ` +
    `${u.cutOff} cut off, ${u.thinking} with a thinking block, ${u.repairs} repair(s), ${u.cents}¢`;
}

/** usage.md: one section per conversation or draft, one table row per call. */
export function usageMarkdown(run: string, sections: { title: string; rows: UsageRow[]; totals: UsageTotals }[]): string {
  const lines = [`# Model usage, run ${run}`, "", "One row per call. \"cut off\" means the reply hit its output limit (stop max_tokens).", ""];
  for (const s of sections) {
    lines.push(`## ${s.title}`, "", totalsLine(s.totals), "", "| step | call | blocks | in | out | max | stop | ms | ¢ | error |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const r of s.rows) lines.push(`| ${r.turn} | ${r.purpose} | ${r.blocks} | ${r.inputTokens} | ${r.outputTokens} | ${r.maxTokens} | ${r.stop} | ${r.ms} | ${r.cents} | ${r.error.replace(/\|/g, "/").slice(0, 120)} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function writeReport(dir: URL): Promise<void> {
  const manifest: RunManifest = JSON.parse(await Deno.readTextFile(new URL("manifest.json", dir)));
  const traces: ConversationTrace[] = [];
  for (const c of manifest.conversations) traces.push(JSON.parse(await Deno.readTextFile(new URL(c.file, dir))));
  const rows = manifest.conversations.map((c) => `<tr><td><a href="#${c.id}">${esc(c.id)}</a></td><td>${esc(c.persona)}</td><td>${esc(c.kind)}</td><td>${c.turns}</td><td>${c.cents}¢</td><td class="${c.targetsOk === c.targetsTotal ? "ok" : "fail"}">${c.targetsOk}/${c.targetsTotal}</td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(manifest.run)}</title><style>${CSS}</style>
<h1>Talk run ${esc(manifest.run)} <span class="meta">${esc(manifest.mode)}, model ${esc(manifest.model)}, cap ${manifest.capCents}¢, spent ${manifest.cents}¢, ${esc(manifest.startedAt)} → ${esc(manifest.finishedAt)}</span></h1>
<p class="meta">${manifest.notes.map(esc).join("<br>")}</p>
<table><tr><th>id</th><th>persona</th><th>kind</th><th>turns</th><th>cents</th><th>targets</th></tr>${rows}</table>
${traces.map(conversationHtml).join("\n")}`;
  await Deno.writeTextFile(new URL("index.html", dir), html);

  const lines: string[] = [`# Talk run ${manifest.run}`, "", `Mode ${manifest.mode}; model ${manifest.model}; cap ${manifest.capCents}¢; spent ${manifest.cents}¢; ${manifest.conversations.length} conversation(s).`, ""];
  for (const n of manifest.notes) lines.push(`- ${n}`);
  lines.push("", "## What worked", "");
  for (const t of traces) for (const target of t.targets.filter((x) => x.ok)) lines.push(`- ${t.id} ${t.personaId}: ${target.name} — ${target.detail} ([open](index.html#${t.id}))`);
  lines.push("", "## What failed", "");
  let failures = 0;
  for (const t of traces) {
    for (const target of t.targets.filter((x) => !x.ok)) { failures++; lines.push(`- ${t.id} ${t.personaId}: ${target.name} — ${target.detail} ([open](index.html#${t.id}))`); }
    for (const turn of t.turns) {
      if (turn.engine?.failed) { failures++; lines.push(`- ${t.id} turn ${turn.turn}: ${turn.engine.failed} ([open](index.html#${t.id}-t${turn.turn}))`); }
      for (const w of turn.engine?.warnings ?? []) lines.push(`- ${t.id} turn ${turn.turn}: warning: ${w} ([open](index.html#${t.id}-t${turn.turn}))`);
      if (turn.engine?.repaired && !turn.engine.failed) lines.push(`- ${t.id} turn ${turn.turn}: repaired once (${turn.engine.checks.filter((k) => !k.ok && k.name.startsWith("first:")).map((k) => k.name.slice(6)).join(", ")}) ([open](index.html#${t.id}-t${turn.turn}))`);
      if (turn.sim.failed) { failures++; lines.push(`- ${t.id} turn ${turn.turn}: simulated user failed: ${turn.sim.failed}`); }
    }
    if (t.finish?.failed) { failures++; lines.push(`- ${t.id} Finish: ${t.finish.failed} ([open](index.html#${t.id}-finish))`); }
  }
  if (!failures) lines.push("- nothing failed");
  lines.push("", "## Cards and ratings", "");
  for (const t of traces) {
    const shown = t.turns.flatMap((x) => x.engine?.shown.cards ?? []);
    const guesses = t.turns.filter((x) => x.engine?.shown.earlyGuess).length;
    const latest = new Map<string, string>();
    for (const x of t.turns) for (const [id, r] of Object.entries(x.ratingsApplied)) latest.set(id, r);
    const rated = [...latest.values()];
    const yes = rated.filter((r) => r !== "not_me").length;
    lines.push(`- ${t.id} ${t.personaId}: ${shown.length} card(s) shown${guesses ? ` + ${guesses} early guess` : ""}, ${rated.length} rated, ${yes} Very me/Partly, ${rated.length - yes} Not me; ${t.riskStop ? `risk stop at turn ${t.riskStop.turn}, Finish not called, ${t.riskStop.kept.length} rated card(s) kept` : `Finish ${t.finish?.cards.length ?? 0} card(s)`}; map now ${t.mapAfter.beliefs.length} belief(s)`);
  }
  lines.push("", "## Confidence", "", "A card is shown at 0.70 or more; the turn prompt says 0.7 is reached when a second receipt points the same way, or when one receipt states it plainly (A48 Q48(c) → ii). Counts are over every proposal kept after checks, turn by turn.", "");
  lines.push(`- all: ${confidenceLine(confidenceTotals(traces.map(confidenceSummary)))}`);
  for (const t of traces) lines.push(`- ${t.id} ${t.personaId}: ${confidenceLine(confidenceSummary(t))}`);
  lines.push("", "## Model usage", "", "Per call in [usage.md](usage.md).", "");
  for (const t of traces) lines.push(`- ${t.id} ${t.personaId}: ${totalsLine(usageTotals(t))}`);
  await Deno.writeTextFile(new URL("summary.md", dir), lines.join("\n") + "\n");
  await Deno.writeTextFile(new URL("usage.md", dir), usageMarkdown(manifest.run, traces.map((t) => ({ title: `${t.id} ${t.personaId}`, rows: usageRows(t), totals: usageTotals(t) }))));
}

if (import.meta.main) {
  const dir = Deno.args[0];
  if (!dir) throw new Error("usage: report <run-dir>");
  await writeReport(new URL(dir.endsWith("/") ? dir : dir + "/", `file://${Deno.cwd()}/`));
}
