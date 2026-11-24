// Generates the versioned, fictional maps once from the already-versioned
// persona sheets.  The runner reads only maps/*.json; it never starts Talk or
// touches an account, HTTP route, or database.

import { derivedLabel } from "../../next/engine/bridge/fixture.ts";
import { DOMAINS, TYPE_FOR_LEVEL } from "../../next/engine/types.ts";
import type { Belief, Domain, Level } from "../../next/engine/types.ts";

const PERSONAS = new URL("../sim/personas/", import.meta.url);
const MAPS = new URL("maps/", import.meta.url);

interface SheetBelief { id: string; statement: string; kind: string; domain: string }
interface Story { id: string; text: string; belief_id: string | null }
interface Pattern { id: string; label: string; statement: string }
interface Persona { id: string; bio: string; beliefs: SheetBelief[]; stories: Story[]; communication_patterns: Pattern[] }

const LEVEL_FOR_KIND: Record<string, Level> = { foundation: "L0", rule: "L1", coping: "L2", view: "L3", reaction: "L4" };

function firstName(persona: Persona): string {
  const match = (persona.bio ?? "").match(/^([^,\s]+)/);
  return match?.[1] || persona.id;
}

function belief(persona: Persona, source: SheetBelief): Belief {
  const receipts = persona.stories.filter((story) => story.belief_id === source.id).slice(0, 2)
    .map((story, index) => ({ quote: story.text, sessionId: `${persona.id}-frozen`, turn: index + 1, date: "2026-11-20" }));
  const level = LEVEL_FOR_KIND[source.kind] ?? "L3";
  return {
    id: source.id,
    label: derivedLabel(source.statement),
    statement: source.statement,
    type: TYPE_FOR_LEVEL[level],
    level,
    domains: (DOMAINS as readonly string[]).includes(source.domain) ? [source.domain as Domain] : [],
    confidence: 0.85,
    receipts,
    links: [],
    status: "endorsed",
  };
}

for (let number = 1; number <= 12; number++) {
  const id = `p${String(number).padStart(2, "0")}`;
  const persona = JSON.parse(await Deno.readTextFile(new URL(`${id}.json`, PERSONAS))) as Persona;
  const value = {
    schema_version: 1,
    source: "evals/sim/personas (fictional adults only)",
    persona_id: persona.id,
    first_name: firstName(persona),
    beliefs: persona.beliefs.map((item) => belief(persona, item)),
    shared_items: persona.communication_patterns.map((item) => ({ id: item.id, label: item.label, statement: item.statement })),
  };
  await Deno.mkdir(MAPS, { recursive: true });
  await Deno.writeTextFile(new URL(`${id}.json`, MAPS), JSON.stringify(value, null, 2) + "\n");
}
