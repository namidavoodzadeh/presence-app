// The Bridge run: 12 fixture drafts through analyse → plan → rewrite → verify, plus insight from the same analysis.
//   deno task bridge --model claude-haiku-5-5   → the run of record (BRIDGE-ENGINE §3; A48 Q47 → c), cap 385¢ shared with the Sonnet arm
//   deno task bridge                            → the Sonnet comparison arm (same 12 drafts), only if Haiku settled ≤ 80¢ and both stay ≤ 385¢
//   deno task bridge --fake                     → $0, the fake model, to exercise the pipeline and the report
// Options: --cap <cents> --model <id> --run <name> --drafts b01,b02 --thinking … --effort …
// --thinking unset → the model's run-of-record setting (sonnet-5-5 between_tools, haiku-5-5 disabled; client.ts defaultThinking).
// A model named with --model is never swapped: a refusal fails the run and the manifest says so (no silent fallback).

import {
  AnthropicClient,
  CappedModelClient,
  DEFAULT_MODEL,
  defaultThinking,
  EFFORT_SETTINGS,
  loadProtectedConfig,
  modelSetting,
  rateNote,
  repeatingRefusal,
  THINKING_SETTINGS,
} from "../model/client.ts";
import type { ModelClient } from "../model/client.ts";
import { harnessLedger } from "../../api/lib/ledger.ts";
import { bridgeDraft, draftTargets, floorSafety } from "../bridge/bridge.ts";
import { loadBridgeFixture } from "../bridge/fixture.ts";
import { FakeBridgeClient } from "./fake_bridge.ts";
import type { BridgeManifest } from "./trace.ts";
import { writeBridgeReport } from "./report_bridge.ts";

const ROOT = new URL("../../../", import.meta.url);
export const ESTIMATED_DRAFT_CENTS = 12; // analyse + rewrite + verify on Sonnet; a retry adds two calls

/** A draft the safety floor declines makes no call and always runs; otherwise the guard uses the run's own measured cost per draft
 *  (the worst-case guess only before the first), so a stated small cap is not spent on the first six drafts with the safety, abuse
 *  and nothing-to-change cases skipped (073734Z: b07–b12 never ran at 30¢ of 40). */
export function roomForDraft(
  budget: { cap: number; spent: number },
  measuredCents: number[],
  message: string,
): boolean {
  if (floorSafety(message).routed !== "none") return true;
  const expected = measuredCents.length
    ? Math.max(1, Math.ceil(measuredCents.reduce((a, b) => a + b, 0) / measuredCents.length))
    : ESTIMATED_DRAFT_CENTS;
  return budget.spent + expected <= budget.cap;
}

function args(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const a = Deno.args;
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const key = a[i].slice(2);
    if (i + 1 < a.length && !a[i + 1].startsWith("--")) {
      out[key] = a[i + 1];
      i++;
    } else out[key] = true;
  }
  return out;
}

async function main() {
  const opts = args();
  const fake = opts.fake === true;
  const cap = typeof opts.cap === "string" ? Number(opts.cap) : 385;
  const explicitModel = typeof opts.model === "string";
  const model = explicitModel ? String(opts.model) : DEFAULT_MODEL;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const run = typeof opts.run === "string"
    ? opts.run
    : `${stamp}-bridge-${fake ? "fake" : model.replace(/^claude-/, "")}`;
  const dir = new URL(`next/reports/${run}/`, ROOT);
  await Deno.mkdir(new URL("traces/", dir), { recursive: true });

  const fixture = await loadBridgeFixture(ROOT);
  const only = typeof opts.drafts === "string" ? new Set(opts.drafts.split(",")) : null;
  const drafts = fixture.drafts.filter((d) => !only || only.has(d.id));
  const ledger = fake ? null : await harnessLedger(); // Postgres usage_ledger, person null (agent spend; A59)
  const thinking = modelSetting(opts.thinking, THINKING_SETTINGS, defaultThinking(model)); // the model's run-of-record setting unless named
  const effort = modelSetting(opts.effort, EFFORT_SETTINGS, null);
  const uncappedClient: ModelClient = fake ? new FakeBridgeClient() : new AnthropicClient({
    config: await loadProtectedConfig(),
    ledger: ledger!,
    defaultModel: model,
    thinking,
    effort: effort ?? undefined,
    fallbackModel: explicitModel ? null : undefined,
  });
  const client: ModelClient = fake ? uncappedClient : new CappedModelClient(uncappedClient, cap, model);

  const manifest: BridgeManifest = {
    kind: "bridge",
    run,
    mode: fake ? "fake" : "live",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    model,
    capCents: cap,
    cents: 0,
    ledgerBefore: ledger ? await ledger.snapshot() : null,
    ledgerAfter: null,
    drafts: [],
    notes: [],
  };
  manifest.notes.push(
    "target: every analysis quote exact; every rewrite keeps every point (critic + code) and adds nothing; the correct state for each case (ok, nothing to change, declined_safety with resources, declined_abuse); insight spans exact; receiver-aware off.",
  );
  manifest.notes.push(
    `model settings: thinking ${thinking}${effort ? `, effort ${effort}` : ""}${
      explicitModel ? "; model named on the command line, no fallback" : ""
    }.`,
  );
  manifest.notes.push(rateNote(model));
  if (!fake) {
    manifest.notes.push(
      model.startsWith("claude-haiku-5-5")
        ? "arm: Haiku 5.5 — the run of record (BRIDGE-ENGINE §3 names Haiku 5.5 for all three calls; A48 Q47 → c)."
        : `arm: ${model} — the comparison arm (A48 Q47 → c), read beside the Haiku 5.5 run of record; it does not decide the production pick.`,
    );
  }
  console.log(`run ${run}: ${drafts.length} draft(s), cap ${cap}¢, model ${model}${fake ? " (fake)" : ""}`);

  let spent = 0;
  const measured: number[] = [];
  for (const d of drafts) {
    // A single named regression may be cheaper than the generic first-draft estimate. Its per-call capped client is the
    // authoritative guard; it refuses before any request whose worst case could cross the stated run cap.
    if (!(drafts.length === 1 && spent === 0) && !roomForDraft({ cap, spent }, measured, d.message)) {
      manifest.notes.push(`${d.id} skipped: cap ${cap}¢ reached at ${spent}¢`);
      continue;
    }
    const sender = fixture.senders.get(d.senderId)!;
    console.log(
      `  ${d.id} ${sender.firstName} → ${d.relationship} (${
        d.expected.safety !== "none"
          ? d.expected.safety
          : d.expected.nothingToChange
          ? "nothing to change"
          : d.expected.frictions.join("+")
      }) …`,
    );
    const trace = await bridgeDraft(client, d, sender);
    trace.targets = draftTargets(trace);
    spent += trace.cents;
    if (trace.exchanges.length) measured.push(trace.cents);
    const file = `traces/${d.id}-${d.senderId}-${d.relationship}.json`;
    await Deno.writeTextFile(new URL(file, dir), JSON.stringify(trace, null, 1));
    const ok = trace.targets.filter((t) => t.ok).length;
    manifest.drafts.push({
      id: d.id,
      file,
      sender: sender.firstName,
      relationship: d.relationship,
      expected: d.expected.safety !== "none"
        ? d.expected.safety
        : d.expected.nothingToChange
        ? "nothing_to_change"
        : d.expected.frictions.join("+"),
      status: trace.result.status + (trace.result.nothingToChange ? " (nothing to change)" : ""),
      calls: trace.exchanges.length,
      cents: trace.cents,
      targetsOk: ok,
      targetsTotal: trace.targets.length,
    });
    manifest.cents = spent;
    console.log(
      `     ${trace.result.status}${
        trace.result.nothingToChange ? " (nothing to change)" : ""
      }, ${trace.exchanges.length} call(s), ${trace.cents}¢, targets ${ok}/${trace.targets.length}`,
    );
    // NEXT-ENGINE §1: a refusal stops the run; a rejected request shape would repeat on every later draft.
    const fatal = trace.exchanges.map((x) => x.error).find(repeatingRefusal);
    if (fatal) {
      manifest.notes.push(
        `run stopped after ${d.id}: the API or the ledger refused the request and would again on every later call: ${fatal}`,
      );
      break;
    }
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.ledgerAfter = ledger ? await ledger.snapshot() : null;
  const anthropic = fake ? null : uncappedClient as AnthropicClient;
  if (anthropic?.resolvedModel) {
    manifest.notes.push(`model ${model} was refused; the run used ${anthropic.resolvedModel}`);
  }
  await Deno.writeTextFile(new URL("manifest.json", dir), JSON.stringify(manifest, null, 1));
  await writeBridgeReport(dir);
  console.log(`report: ${new URL("index.html", dir).pathname}\nspent ${spent}¢`);
}

if (import.meta.main) await main();
