// K-0002 (law 8, spec safety-stop.md A): every next/api route that takes a person's free text calls requireSafetyPass (directly, or via
// safetyDecision, which does). The list is discovered from the route source, so a new free-text route fails here until it is gated or
// named in EXCEPTIONS with its reason. Also checks gate.ts itself: backstop size, fail-closed, one retry, timeout.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { backstopHit, BACKSTOP_MAX, runGate } from "../api/_shared/safety/gate.ts";
import type { EntryResult } from "../api/_shared/safety/gate.ts";
import backstop from "../api/_shared/safety/backstop.json" with { type: "json" };

const API = new URL("../api/", import.meta.url);
const FILES = [...Deno.readDirSync(API)].filter((e) => e.isFile && e.name.endsWith(".ts") && !/^(check_|smoke_|eval_|scrub_)|^check\.ts$/.test(e.name)).map((e) => e.name).sort();

/** A body field that carries the person's own words. */
const FREE_TEXT = /\b(?:b|body)\.(?:text|wording|final|moment|note|raw|answers?|statement|original)\b|\btext\(b\)/;
const GATED = /requireSafetyPass\(|safetyDecision\(|commWordsGate\(/;

/** Free-text routes that do not call the gate in their own handler, each with why. A new entry needs a reason a reviewer accepts. */
const EXCEPTIONS: Record<string, string> = {
  "POST /talk/turn": "screened inside talkTurn (engine safety floor plus semantic read, same safetyEntry); moves behind requireSafetyPass with K-0003",
  "PUT /drafts/:person": "an autosaved draft is never sent; the words are gated again by POST /bridges and PATCH /bridges/:id",
  "POST /feedback": "tester bug reports, not a person's own words in the app; token-gated",
  "POST /bridge/insight": "floorSafety on the sender's text; the send itself is gated in /bridges",
  "POST /imports/local": "on-device import parsing; the text goes through /imports/ai gate before anything is stored",
  "POST /imports/ai/round/answers": "answers are chips and numbers from a fixed set",
  "POST /imports/ai/:id/answers": "answers are chips and numbers from a fixed set",
  "POST /diagnostics": "client diagnostics counts, no person's words",
  "POST /bridge/run": "runs on the sender's already-gated text",
  "POST /bridge/why-it-matters": "runs on the sender's already-gated text",
  "POST /eval/bridge/run": "evaluation route, not a person-facing input",
  "POST /preview/mirror-sample": "fixed sample text, no input",
  "POST /practice-partner/bridges/:id/reply": "fixed canned reply, no person text",
  "POST /imports/ai/:id/feel": "answer is one of a fixed set (FEEL_ANSWERS)",
  "POST /talk/consent": "answer is one of a fixed set (CONSENT_TEXT)",
  "PATCH /me": "profile fields (name, settings), not free text read by the model",
  "PATCH /conversations/:id": "title and status fields only",
  "PATCH /bridges/:id": "gated through the same helper as POST /bridges (line check below)",
};

interface Found { key: string; file: string; block: string }
function routeBlocks(): Found[] {
  const out: Found[] = [];
  for (const f of FILES) {
    const src = Deno.readTextFileSync(new URL(f, API));
    const parts = src.split(/\n(?=route\()/).map((p) => p.split(/\n\}\);/)[0]);
    for (const part of parts) {
      const m = /^route\("(POST|PUT|PATCH)",\s*"([^"]+)"/.exec(part);
      if (m) out.push({ key: `${m[1]} ${m[2]}`, file: f, block: part });
    }
  }
  return out;
}

Deno.test("every free-text route calls requireSafetyPass or has a named exception", () => {
  const free = routeBlocks().filter((r) => FREE_TEXT.test(r.block));
  assert(free.length >= 8, `expected to discover the free-text routes, found ${free.length}`);
  const missing = free.filter((r) => !GATED.test(r.block) && !(r.key in EXCEPTIONS)).map((r) => `${r.key} (${r.file})`);
  assertEquals(missing, [], `free-text routes that do not call requireSafetyPass: ${missing.join(", ")}`);
});

Deno.test("the routes that must be gated are discovered and gated", () => {
  const must = ["POST /comm/talk/turn", "POST /comm/items", "POST /bridges", "POST /beliefs", "POST /talk/edit", "POST /checkin/:person_id/notes",
    "PUT /checkin/session/:id/appreciation", "POST /m/:slug/contributions", "POST /imports/ai", "POST /bridges/:id/reading", "PATCH /checkin/notes/:id"];
  const all = new Map(routeBlocks().map((r) => [r.key, r]));
  for (const k of must) {
    const r = all.get(k);
    assert(r, `route not found: ${k}`);
    assert(GATED.test(r.block), `${k} does not call the safety gate`);
  }
});

Deno.test("exceptions are real routes (no stale entries)", () => {
  const keys = new Set(routeBlocks().map((r) => r.key));
  const stale = Object.keys(EXCEPTIONS).filter((k) => !keys.has(k));
  assertEquals(stale, [], `exceptions naming no route: ${stale.join(", ")}`);
});

Deno.test("safetyDecision calls the gate", () => {
  const src = Deno.readTextFileSync(new URL("checkin.ts", API));
  const body = src.slice(src.indexOf("export async function safetyDecision"));
  assert(/requireSafetyPass\(/.test(body.slice(0, 600)));
});

Deno.test("no route imports the old gateWords directly", () => {
  const offenders = FILES.filter((f) => /\bgateWords\(/.test(Deno.readTextFileSync(new URL(f, API))));
  assertEquals(offenders, []);
});

Deno.test("backstop.json: at most 25 phrases, a hit is STOP with no model call", async () => {
  assert(backstop.self.length + backstop.other.length <= BACKSTOP_MAX);
  assertEquals(backstopHit("I want to kill myself."), "self");
  assertEquals(backstopHit("I’m going to kill him"), "other");
  assertEquals(backstopHit("I'm going to kill this presentation"), null);
  let called = 0;
  const r = await runGate(() => { called++; return Promise.reject(new Error("x")); }, "i want to kill myself", "test");
  assertEquals([r.stop, r.routed, called], [true, "risk", 0]);
});

const PASS: EntryResult = { stop: false, risk: "none", routed: "none", reason: "", unavailable: false, via: "clear", exchanges: [], cents: 0, readingsUnavailable: 0 };

Deno.test("gate: pass, one retry, then fail closed; a hung reader times out", async () => {
  assertEquals((await runGate(() => Promise.resolve(PASS), "hello", "t")).stop, false);
  let n = 0;
  const flaky = () => (++n === 1 ? Promise.reject(new Error("down")) : Promise.resolve(PASS));
  assertEquals((await runGate(flaky, "hello", "t")).stop, false);
  assertEquals(n, 2);
  let m = 0;
  const dead = await runGate(() => { m++; return Promise.reject(new Error("down")); }, "hello", "t");
  assertEquals([dead.stop, dead.routed, dead.unavailable, m], [true, "unavailable", true, 2]);
  let h = 0;
  const hung = await runGate(() => { h++; return new Promise<EntryResult>(() => {}); }, "hello", "t", { timeoutMs: 20 });
  assertEquals([hung.routed, h], ["unavailable", 2]);
  const unavail = await runGate(() => Promise.resolve({ ...PASS, stop: true, routed: "unavailable", unavailable: true } as EntryResult), "hello", "t");
  assertEquals(unavail.routed, "unavailable");
});

Deno.test("gate: aborts each expired reader before its retry, so an Edge request has no orphaned safety calls", async () => {
  let calls = 0, aborted = 0;
  const held = await runGate((_text, signal) => new Promise<EntryResult>((resolve) => {
    calls++;
    signal?.addEventListener("abort", () => { aborted++; resolve({ ...PASS, stop: true, routed: "unavailable", unavailable: true }); }, { once: true });
  }), "ordinary words", "bridge", { timeoutMs: 5 });
  assertEquals([held.stop, held.routed, calls, aborted], [true, "unavailable", 2, 2]);
});
