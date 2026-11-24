// The comm checks gold set (evals/comm_gold.json): every row gives its expected verdict. $0, deterministic.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkBeforeSuggesting } from "../engine/comm_checks.ts";
import { COMM_KINDS, type CommKind, type CommSource } from "../engine/comm.ts";

interface Row { text: string; kind: CommKind; source: CommSource; expect: string; note: string; confidence?: number }
const gold = JSON.parse(await Deno.readTextFile(new URL("../evals/comm_gold.json", import.meta.url))) as { cases: Row[] };

Deno.test("comm gold set: every row gets the verdict the spec names", () => {
  assert(gold.cases.length >= 40);
  const wrong: string[] = [];
  for (const r of gold.cases) {
    assert(COMM_KINDS.includes(r.kind), r.text);
    const v = checkBeforeSuggesting({ text: r.text, kind: r.kind, source: r.source, confidence: r.confidence });
    const got = v.ok ? "ok" : v.action;
    if (got !== r.expect) wrong.push(`${r.kind}/${r.source} "${r.text}": expected ${r.expect}, got ${got}`);
  }
  assertEquals(wrong, []);
});
Deno.test("comm gold set: it holds failing cards as well as passing ones (a set of only passes proves nothing)", () => {
  const by = (e: string) => gold.cases.filter((r) => r.expect === e).length;
  for (const e of ["ok", "safety_route", "drop", "offer_request", "offer_i_statement", "keep_listening"]) assert(by(e) >= 1, e);
  assert(by("ok") <= gold.cases.length * 0.6);
  for (const k of COMM_KINDS) if (k !== "other") assert(gold.cases.some((r) => r.kind === k && r.expect === "ok"), `a passing ${k}`);
});
