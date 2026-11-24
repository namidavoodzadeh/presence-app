// Talk readout for Nami (CEO 02:15Z 16 Nov item 2, COO 01:20Z 17 Nov): the Talk planner and the model's part of a turn (engine/comm_planner.ts,
// engine/talk/comm_turn.ts) run on six FICTIONAL sessions drawn from PSY's question bank, and written to docs/engine/TALK-COMM-READOUT.md:
// per session, the questions Talk asked, the items it suggested (kind, scope, wording, receipt) and every check that fired.
//
//   deno run --allow-read --allow-write --allow-env --allow-net next/scripts/talk_comm_readout.ts [--cap-cents 150] [--out docs/engine/TALK-COMM-READOUT.md]
//   deno run ... talk_comm_readout.ts --dry     # no model call: shows the plan and the bank questions only, $0
//
// Fictional people and words only. Credits only (the Mac's loader key), capped by CappedModelClient; nothing is written to any database and no
// staging or hosted route is called. The planner cannot tell "the person raised a heated moment" or "told a moment with a hard word" by itself:
// those two hints are scripted per answer here (`raised`, `moment`), standing for what the app/engine derives; the readout says so.
import { buildCommTurnRequest, COMM_TURN_MODEL, commTurnPrecheck, finishCommTurn } from "../engine/talk/comm_turn.ts";
import type { CommTurnInput, CommTurnOutput } from "../engine/talk/comm_turn.ts";
import { planNextQuestion } from "../engine/comm_planner.ts";
import type { Plan, WayIn } from "../engine/comm_planner.ts";
import type { CommKind } from "../engine/comm.ts";
import type { ModelClient } from "../engine/model/client.ts";

export interface ScriptedTurn {
  answer: string;
  /** What the person raised themselves in this answer (a heated moment, a hard word). Scripted: stands for the app's own detection. */
  raised?: CommKind;
  /** The answer tells a moment with a hard word or tone in it, so "lands hard" may be offered next (session 2 and later). */
  moment?: boolean;
}
export interface Session {
  id: string;
  title: string;
  why: string;
  wayIn: WayIn;
  sessionNumber: number;
  name?: string;
  haveKinds?: CommKind[];
  turns: ScriptedTurn[];
}

type Ask = Extract<Plan, { done: false }>;
export interface TurnRecord {
  asked: { kind: CommKind; question: string; from: "bank" | "model"; modelQuestion: string | null };
  answer: string | null;
  stop: boolean;
  reflection: string | null;
  modelReflection: string | null;
  item: { kind: CommKind; wording: string; scope: string; receipt: string } | null;
  modelItem: string | null;
  refused: string | null;
  verdict: string | null;
  checksFired: string[];
  cents: number;
  note: string | null;
}
export interface SessionRecord { session: Session; turns: TurnRecord[]; ended: string; plan: string[] }

const scopeFor = (s: Session): string => (s.name ? `person: ${s.name}` : "everyone");

function rawFields(raw: string): { reflection: string | null; question: string | null; item: string | null } {
  try {
    const m = /\{[\s\S]*\}/.exec(raw);
    const o = m ? JSON.parse(m[0]) : {};
    const f = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
    return { reflection: f(o.reflection), question: f(o.question), item: f(o.item) };
  } catch { return { reflection: null, question: null, item: null }; }
}

/** Which of the engine's rules held something back this turn, from what the model said against what the engine kept. */
function checksFor(out: CommTurnOutput, raw: ReturnType<typeof rawFields>): string[] {
  const fired: string[] = [];
  if (raw.reflection && !out.reflection) fired.push("reflection dropped (length, a question mark, a banned word, advice or risk wording)");
  if (raw.question && out.questionFrom === "bank" && raw.question !== out.question) fired.push("model's rephrased question dropped: the bank's own words used (4.2 question rules)");
  if (out.itemRefused) fired.push(`item kept out: ${out.itemRefused}`);
  if (out.verdict && !out.verdict.ok) fired.push(`4.3 check: ${JSON.stringify(out.verdict)}`);
  return fired;
}

export async function runSession(client: ModelClient | null, s: Session, today: string): Promise<SessionRecord> {
  const asked: CommKind[] = [];
  const plans: string[] = [];
  const turns: TurnRecord[] = [];
  let ended = "script ran out";
  let turnsTaken = 0;
  let raised: CommKind | undefined;
  let moment = false;
  const plan = planNextQuestion({ sessionNumber: s.sessionNumber, wayIn: s.wayIn, turnsTaken, haveKinds: s.haveKinds ?? [], askedThisSession: asked, name: s.name });
  if (plan.done) return { session: s, turns, ended: `planner done at once: ${plan.reason}`, plan: plans };
  let current: Ask = plan;
  asked.push(current.kind); turnsTaken = 1;
  plans.push(`${current.kind}: ${current.question}`);
  let rec: TurnRecord = blank(current);
  for (const t of s.turns) {
    rec.answer = t.answer;
    const pre = commTurnPrecheck(t.answer);
    if (pre.stop) { rec.stop = true; rec.note = "risk stop: no model call, nothing extracted, resources shown"; turns.push(rec); ended = "risk stop"; return { session: s, turns, ended, plan: plans }; }
    raised = t.raised; moment = t.moment === true;
    const next = planNextQuestion({ sessionNumber: s.sessionNumber, wayIn: s.wayIn, turnsTaken, haveKinds: s.haveKinds ?? [], askedThisSession: asked, raisedByPerson: raised, afterMoment: moment, name: s.name });
    // The model still reads the last answer when the planner is done (an item can come from it); the next question is then the last one asked, unused.
    const planForCall: Ask = next.done ? current : next;
    const input: CommTurnInput = { plan: planForCall, answeredKind: current.kind, answer: t.answer, sessionNumber: s.sessionNumber };
    let out: CommTurnOutput;
    let rawF = { reflection: null as string | null, question: null as string | null, item: null as string | null };
    if (client) {
      const ex = await client.complete(buildCommTurnRequest(input));
      rec.cents = ex.usage?.cents ?? 0;
      rawF = rawFields(ex.rawResponse);
      out = finishCommTurn(ex.rawResponse, input);
    } else {
      out = finishCommTurn("{}", input);
    }
    rec.reflection = out.reflection || null;
    rec.modelReflection = rawF.reflection;
    rec.modelItem = rawF.item;
    rec.refused = out.itemRefused;
    rec.verdict = out.verdict ? JSON.stringify(out.verdict) : null;
    rec.checksFired = checksFor(out, rawF);
    if (out.item) rec.item = { kind: out.item.kind, wording: out.item.wording, scope: scopeFor(s), receipt: `"${t.answer}" (${today})` };
    turns.push(rec);
    if (next.done) { ended = `planner done: ${next.reason}`; return { session: s, turns, ended, plan: plans }; }
    current = next; asked.push(current.kind); turnsTaken += 1;
    plans.push(`${current.kind}: ${current.question}`);
    rec = blank(current);
    rec.asked.question = out.question; rec.asked.from = out.questionFrom; rec.asked.modelQuestion = rawF.question;
  }
  if (rec.answer === null) turns.push(rec);
  return { session: s, turns, ended, plan: plans };
}

function blank(a: Ask): TurnRecord {
  return { asked: { kind: a.kind, question: a.question, from: "bank", modelQuestion: null }, answer: null, stop: false, reflection: null, modelReflection: null, item: null, modelItem: null, refused: null, verdict: null, checksFired: [], cents: 0, note: null };
}

export const SESSIONS: Session[] = [
  {
    id: "S1", title: "Couple, first session (invited by partner)", why: "The common first session for a couple: four turns, ends on care.",
    wayIn: "invited_by_partner", sessionNumber: 1, name: "Maya",
    turns: [
      { answer: "When I go quiet with Maya it usually means I'm thinking something through, I'm not upset with her." },
      { answer: "Maya started by asking if it was a good time, and she said it quietly at the kitchen table, not in the middle of dinner." },
      { answer: "Mostly the weekend plans. I'm going to be away on a work trip next week and she should know that." },
      { answer: "Last Sunday she made tea without me asking and sat with me while I answered emails." },
    ],
  },
  {
    id: "S2", title: "Couple, second session, a heated moment told", why: "A later session: the person tells a heated moment with a hard tone in it; lands hard and gets heated are in play.",
    wayIn: "invited_by_partner", sessionNumber: 2, name: "Daniel", haveKinds: ["how_i_mean"],
    turns: [
      { answer: "Asking about my day matters more to me than gifts. Daniel remembers the small things about my week." },
      { answer: "Mostly it goes badly. Last night he said I always do this, and I stopped listening right away.", raised: "gets_heated", moment: true },
      { answer: "I need a pause. If we keep going I say things I don't mean, so ten minutes alone helps. When he says always I stop hearing the rest.", moment: true },
      { answer: "The word always. Whenever someone says always I stop hearing the rest." },
      { answer: "Afterwards a walk and then a cup of tea, and then I can say sorry properly." },
      { answer: "It matters to me that we both get to finish a sentence." },
    ],
  },
  {
    id: "S3", title: "Light session, own download", why: "Short, low-content answers: the engine should stay light and suggest little.",
    wayIn: "own_download", sessionNumber: 1,
    turns: [
      { answer: "Not sure, it depends." },
      { answer: "Hm, I guess just saying it plainly." },
      { answer: "A message that says thinking of you. That's nice." },
    ],
  },
  {
    id: "S4", title: "Session with a This week line", why: "The third question is the This week line: the item gets an expiry, not a permanent trait.",
    wayIn: "invited_by_partner", sessionNumber: 1, name: "Priya",
    turns: [
      { answer: "If I'm short in a text it's because I'm busy, it's nothing about Priya." },
      { answer: "She told me over breakfast, on a Saturday, with a coffee in her hand, and that worked." },
      { answer: "My dad is in hospital this week so I'm slower to reply than normal." },
      { answer: "She brought soup round on Tuesday and didn't make me talk." },
    ],
  },
  {
    id: "S5", title: "Session that should produce nothing", why: "Answers are about someone else's character, a refusal and a fragment: no item may be suggested (law 11: a label about character is never evidence).",
    wayIn: "own_download", sessionNumber: 1,
    turns: [
      { answer: "My brother is just selfish and always has been." },
      { answer: "I'd rather not say." },
      { answer: "Nothing really. Skip." },
    ],
  },
  {
    id: "S6", title: "Friend invite, first session", why: "A friend's way in: three turns, the friend's one item came first, never the heated kinds.",
    wayIn: "invited_by_friend", sessionNumber: 1, name: "Tomás",
    turns: [
      { answer: "I go quiet when I'm tired, it isn't about Tomás, I just need to recharge." },
      { answer: "He texted first, saying he had something small to raise about Friday, and that made it easy." },
      { answer: "Being invited along without having to ask, like when he saved me a seat at the match." },
    ],
  },
];

export function renderReadout(recs: SessionRecord[], meta: { model: string; cents: number; cap: number; today: string; dry: boolean }): string {
  const L: string[] = [];
  L.push("# Talk on the communication model: readout (six fictional sessions)");
  L.push("");
  L.push(`Run ${meta.today}. ${meta.dry ? "DRY: no model call" : `Model ${meta.model}, ${meta.cents.toFixed(1)} cents of a ${meta.cap}-cent cap, credits only`}. Fictional people and words. Nothing was saved anywhere.`);
  L.push("");
  L.push("What ran: the Talk planner on PSY's question bank (engine/comm_planner.ts), then, for each answer, the model's part of the turn (engine/talk/comm_turn.ts: one line reflecting what was said, the next question, at most one item in the person's own words), then the engine's checks (4.3 and the 4.2 question rules, grounding in the person's own words). Scope is shown as the session's own context (a named person = that person, otherwise everyone); the model does not choose it. \"Raised\" and \"moment\" hints in sessions 2 are scripted: they stand for what the app derives, because the planner cannot see them itself. The person still decides every item (That's me, Not now, edit); nothing here reached a map.");
  L.push("");
  for (const r of recs) {
    L.push(`## ${r.session.id}. ${r.session.title}`);
    L.push(`${r.session.why} Way in: ${r.session.wayIn}; session ${r.session.sessionNumber}${r.session.name ? `; other person: ${r.session.name}` : ""}.`);
    L.push("");
    let n = 0;
    for (const t of r.turns) {
      n += 1;
      if (n > 1) L.push("");
      L.push(`**Turn ${n}. Talk asks (${t.asked.kind}${t.asked.from === "model" ? ", model's wording" : ", bank's wording"}):** ${t.asked.question}`);
      if (t.asked.from === "bank" && t.asked.modelQuestion) L.push(`- model's rephrase was kept out: "${t.asked.modelQuestion}"`);
      if (t.answer !== null) L.push(`- Person: "${t.answer}"`);
      if (t.stop) L.push(`- ${t.note}`);
      if (t.reflection) L.push(`- Talk reflects: "${t.reflection}"`);
      else if (t.modelReflection) L.push(`- reflection kept out: "${t.modelReflection}"`);
      if (t.item) L.push(`- **Suggested item:** kind ${t.item.kind}; scope ${t.item.scope}; wording "${t.item.wording}"; receipt ${t.item.receipt}`);
      else if (t.answer !== null && !t.stop) L.push(`- Suggested item: none${t.modelItem ? ` (the model drafted "${t.modelItem}"; kept out)` : t.refused ? ` (${t.refused})` : " (the model drafted nothing)"}`);
      if (t.checksFired.length) for (const c of t.checksFired) L.push(`- check fired: ${c}`);
      else if (t.answer !== null && !t.stop) L.push("- checks fired: none");
    }
    L.push(`- Session ended: ${r.ended}.`);
    L.push("");
  }
  const items = recs.flatMap((r) => r.turns.filter((t) => t.item).map((t) => ({ s: r.session.id, ...t.item! })));
  L.push("## Totals");
  L.push(`- Items suggested: ${items.length} across ${recs.length} sessions (${items.map((i) => `${i.s}:${i.kind}`).join(", ") || "none"}).`);
  L.push(`- Checks fired: ${recs.reduce((a, r) => a + r.turns.reduce((b, t) => b + t.checksFired.length, 0), 0)} (listed under each turn).`);
  L.push("");
  return L.join("\n");
}

if (import.meta.main) {
  const args: Record<string, string | boolean> = { "cap-cents": "150", out: "docs/engine/TALK-COMM-READOUT.md" };
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "dry") args[key] = true; else args[key] = Deno.args[++i] ?? "";
  }
  const dry = args.dry === true;
  const cap = Number(args["cap-cents"]);
  let client: ModelClient | null = null;
  if (!dry) {
    const { AnthropicClient, CappedModelClient, loadProtectedConfig } = await import("../engine/model/client.ts");
    const config = await loadProtectedConfig();
    client = new CappedModelClient(new AnthropicClient({ config, defaultModel: COMM_TURN_MODEL, thinking: "disabled", timeoutMs: 30_000 }), cap, COMM_TURN_MODEL);
  }
  const today = new Date().toISOString().slice(0, 10);
  const recs: SessionRecord[] = [];
  for (const s of SESSIONS) recs.push(await runSession(client, s, today));
  const spent = recs.reduce((a, r) => a + r.turns.reduce((b, t) => b + t.cents, 0), 0);
  const md = renderReadout(recs, { model: COMM_TURN_MODEL, cents: spent, cap, today, dry });
  await Deno.writeTextFile(String(args.out), md);
  console.log(`wrote ${args.out}; ${recs.length} sessions; spent ${spent.toFixed(1)} cents${dry ? " (dry)" : ""}`);
}
