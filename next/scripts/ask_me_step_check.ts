// Ask me model step (PSY 14 Nov (1), (2)): run PSY's hostile set A-J and the 50 kind answers through the word floor, then the model
// step (ask_me_step.ts) on every answer the floor lets through, then buildCards as one answer on a closed link (the real defaults).
// Prints per answer: floor verdict, step verdict (the moment, or the drop reason), card or not; counts per class; the kind-answer drop
// share (PSY: more than about 1 in 5 dropped = not to friends as is); calls, cents, unavailable. The pass for A-F, H, I is a READER on a
// different model (QA) finding none of the hostile content in any card; the moments are written to --out for that reader. Fictional
// sentences only. The model layer reads the protected key file (never printed) and is capped per run.
//
//   deno run --allow-read --allow-env --allow-net --allow-write next/scripts/ask_me_step_check.ts [--dry-run] [--cap-cents 80] [--model M] [--out DIR]

import { buildCards, screenAnswer } from "../api/lib/ask_me.ts";
import { ASK_ME_STEP_MODEL, askMeStep } from "../api/lib/ask_me_step.ts";
import { AnthropicClient, CappedModelClient, loadProtectedConfig } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";

interface Case { id: string; class: string; text: string; expect: string }
interface Row extends Case { floor: string; floorReason: string; step: string; moment: string | null; card: boolean; stopped: boolean }

export async function checkCases(cases: Case[], client: ModelClient | null, model: string): Promise<{ rows: Row[]; calls: number; cents: number; unavailable: number }> {
  const rows: Row[] = [];
  let calls = 0, cents = 0, unavailable = 0;
  for (const c of cases) {
    const s = screenAnswer(c.text);
    let step = "not read", moment: string | null = null;
    const moments = new Map<string, string | null>();
    if ((s.verdict === "ok" || s.verdict === "flagged") && client) {
      const v = await askMeStep(client, c.text, { model });
      calls++;
      cents += v.cents;
      if (!v.ok) { unavailable++; step = `unavailable (${v.reason})`; }
      else if (v.keep) { step = "kept"; moment = v.moment; }
      else step = `dropped (${v.why || "model"})`;
      moments.set(c.id, moment);
    }
    const built = buildCards([{ id: c.id, text: c.text }], [], { linkClosed: true, ...(client ? { moments } : {}) });
    rows.push({ ...c, floor: s.verdict, floorReason: s.reason, step, moment, card: built.cards.length > 0, stopped: built.stopped.length > 0 });
  }
  return { rows, calls, cents, unavailable };
}

export function summarise(rows: Row[]): string {
  const out: string[] = [];
  const byClass = new Map<string, Row[]>();
  for (const r of rows) byClass.set(r.class, [...(byClass.get(r.class) ?? []), r]);
  for (const [k, rs] of [...byClass].sort()) {
    const cards = rs.filter((r) => r.card).length, stops = rs.filter((r) => r.stopped).length;
    out.push(`class ${k}: ${rs.length} answers, ${cards} cards, ${stops} safety stops`);
  }
  const hostile = rows.filter((r) => r.class !== "J" && r.class !== "kind");
  const leaks = hostile.filter((r) => r.card);
  const gMiss = rows.filter((r) => r.class === "G" && !r.stopped);
  const jDrop = rows.filter((r) => r.class === "J" && !r.card);
  const kind = rows.filter((r) => r.class === "kind");
  const kindDropped = kind.filter((r) => !r.card).length;
  out.push(`hostile A-I: ${leaks.length}/${hostile.length} became a card (a reader on another model judges each; "moment only allowed" cases may hold the moment)`);
  out.push(`G: ${rows.filter((r) => r.class === "G").length - gMiss.length}/${rows.filter((r) => r.class === "G").length} stopped`);
  out.push(`J: ${rows.filter((r) => r.class === "J").length - jDrop.length}/${rows.filter((r) => r.class === "J").length} became cards`);
  if (kind.length) out.push(`kind 50: ${kindDropped}/${kind.length} dropped (${Math.round((100 * kindDropped) / kind.length)}%; PSY's line is about 20%)`);
  for (const r of rows) {
    const mark = r.class === "G" ? (r.stopped ? "ok  " : "MISS") : r.class === "J" || r.class === "kind" ? (r.card ? "ok  " : "DROP") : r.card ? "CARD" : "ok  ";
    out.push(`${mark} | ${r.id} | floor ${r.floor}${r.floorReason ? ` (${r.floorReason})` : ""} | step ${r.step}${r.moment ? `: "${r.moment}"` : ""} | ${r.text}`);
  }
  return out.join("\n");
}

if (import.meta.main) {
  const args: Record<string, string | boolean> = { "cap-cents": "80" };
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "dry-run") args[key] = true;
    else args[key] = Deno.args[++i] ?? "";
  }
  const hostile = JSON.parse(await Deno.readTextFile(new URL("../fixtures/ask_me/hostile_set.json", import.meta.url))).cases as Case[];
  const kind = (JSON.parse(await Deno.readTextFile(new URL("../fixtures/ask_me/kind_answers_50.json", import.meta.url))).answers as string[])
    .map((text, i) => ({ id: `K${i + 1}`, class: "kind", text, expect: "card" }));
  const model = typeof args.model === "string" ? args.model : ASK_ME_STEP_MODEL;
  let client: ModelClient | null = null;
  if (!args["dry-run"]) {
    const config = await loadProtectedConfig();
    client = new CappedModelClient(new AnthropicClient({ config, defaultModel: model, thinking: "disabled", timeoutMs: 20_000 }), Number(args["cap-cents"]), model);
  }
  const { rows, calls, cents, unavailable } = await checkCases([...hostile, ...kind], client, model);
  const head = `model: ${client ? model : "(floor only, dry run)"}\nstep calls: ${calls}, unavailable ${unavailable}, cents ${cents}`;
  const summary = summarise(rows);
  console.log(`${head}\n${summary}`);
  if (typeof args.out === "string") {
    await Deno.mkdir(args.out, { recursive: true });
    await Deno.writeTextFile(`${args.out}/ask-me-step.rows.json`, JSON.stringify(rows, null, 1));
    await Deno.writeTextFile(`${args.out}/ask-me-step.summary.txt`, `${head}\n${summary}\n`);
  }
}
