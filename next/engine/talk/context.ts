// The context package: built by code, sent every turn, shown in full in the trace (NEXT-ENGINE §2.1).

import { DIMENSIONS, DOMAINS, SENSITIVE_DOMAINS } from "../types.ts";
import type { Belief, Domain, Person, PersonMap, Session } from "../types.ts";

export interface Coverage {
  domain: Domain;
  known: number;            // confirmed or inferred beliefs touching it
  depth: "none" | "surface" | "underneath";
  emptyDimensions: string[];
  consent: string;
}

export function coverage(map: PersonMap): Coverage[] {
  return DOMAINS.map((domain) => {
    const beliefs = map.beliefs.filter((b) => b.status !== "disputed" && b.domains.includes(domain));
    const deep = beliefs.some((b) => b.level === "L0" || b.level === "L1");
    const covered = new Set<string>();
    for (const b of beliefs) for (const d of DIMENSIONS[domain]) {
      const key = d.split(" ")[0].toLowerCase();
      if ((b.label + " " + b.statement).toLowerCase().includes(key)) covered.add(d);
    }
    return {
      domain, known: beliefs.length,
      depth: beliefs.length === 0 ? "none" : deep ? "underneath" : "surface",
      emptyDimensions: DIMENSIONS[domain].filter((d) => !covered.has(d)),
      consent: map.consent[domain] ?? (SENSITIVE_DOMAINS.includes(domain) ? "ask first" : "unknown"),
    };
  });
}

function beliefLine(b: Belief): string {
  const links = b.links.map((l) => `${l.type} ${l.to}`).join(", ");
  return `- ${b.id} [${b.status}] "${b.label}": ${b.statement} (${b.type}; ${b.level}; ${b.domains.join(", ")}; ` +
    `confidence ${b.confidence.toFixed(2)}; receipts ${b.receipts.length}${links ? "; links: " + links : ""})`;
}

/** The package as the model reads it, as plain structured text so the trace shows exactly what was sent. */
export interface ContextPackageOptions {
  /** Talk sends the session as append-only messages so its earlier prefix remains cacheable. Finish still needs it inline. */
  includeSession?: boolean;
  /** Owner-only private hint from the previous turn. It is absent on the ordinary path. */
  guideBrief?: { thread: string; gap: { kind: string; angle: string } | null; avoid: string[] } | null;
}

export function contextPackage(
  person: Person,
  map: PersonMap,
  session: Session,
  previous: Session[] = [],
  options: ContextPackageOptions = {},
): string {
  const parts: string[] = [];
  parts.push("# CONTEXT PACKAGE");
  parts.push(`## Current session\nDate: ${session.date}.`);
  parts.push(`## Who\nFirst name: ${person.firstName}. Language: ${person.language}.` +
    (person.about.length ? `\nThey told us: ${person.about.join("; ")}` : "\nThey have told us nothing about themselves yet."));

  const confirmed = map.beliefs.filter((b) => b.status === "endorsed");
  const inferred = map.beliefs.filter((b) => b.status === "inferred");
  const disputed = map.beliefs.filter((b) => b.status === "disputed");
  parts.push("## Confirmed map" + (confirmed.length ? "\n" + confirmed.map(beliefLine).join("\n") : "\n(empty: first session)"));
  if (inferred.length) parts.push("## Proposed, not yet rated\n" + inferred.map(beliefLine).join("\n"));
  parts.push("## Disputed (never re-propose these as new)" + (disputed.length ? "\n" + disputed.map(beliefLine).join("\n") : "\n(none)"));

  const never = DOMAINS.filter((d) => map.consent[d] === "declined");
  const notNow = DOMAINS.filter((d) => map.consent[d] === "ask_later");
  parts.push(`## Consent\nNever: ${never.length ? never.join(", ") : "(none)"}. Not now: ${notNow.length ? notNow.join(", ") : "(none)"}. ` +
    `Permission needed before entering: ${SENSITIVE_DOMAINS.filter((d) => map.consent[d] !== "ok" && !never.includes(d)).join(", ") || "(none)"}.`);

  parts.push("## Coverage (domain: known, depth, empty dimensions)\n" + coverage(map).map((c) =>
    `- ${c.domain}: ${c.known} known, ${c.depth}; empty: ${c.emptyDimensions.join("; ") || "none"}; consent ${c.consent}`).join("\n"));

  parts.push("## Open threads from earlier sessions" + (map.openThreads.length ? "\n" + map.openThreads.map((t) => "- " + t).join("\n") : "\n(none)"));
  if (options.guideBrief) {
    const brief = options.guideBrief;
    parts.push("## GUIDE BRIEF (private)\nThread: " + brief.thread +
      (brief.gap ? `\nGap: ${brief.gap.kind}; angle: ${brief.gap.angle}` : "\nGap: (none)") +
      `\nAvoid: ${brief.avoid.length ? brief.avoid.join("; ") : "(none)"}`);
  }
  if (previous.length) {
    parts.push("## Earlier sessions\n" + previous.map((s) => `- ${s.date}: ${s.turns.length} turns`).join("\n"));
  }

  if (options.includeSession !== false) {
    const sofar = session.turns.map((t) => {
      const cards = [...t.shown.cards.map((c) => `card ${c.beliefId} "${c.label}" rated ${c.rating ?? "not yet"}`),
        ...(t.shown.earlyGuess ? [`early guess ${t.shown.earlyGuess.beliefId} "${t.shown.earlyGuess.label}" rated ${t.shown.earlyGuess.rating ?? "not yet"}`] : [])].join("; ");
      return `- turn ${t.index}: person said ${JSON.stringify(t.person)}; app showed ${t.shown.state}` +
        (t.shown.question ? ` reflection ${JSON.stringify(t.shown.reflection ?? "")} question ${JSON.stringify(t.shown.question)}` : "") +
        (cards ? `; ${cards}` : "");
    });
    parts.push(`## This session so far (${session.date})` + (sofar.length ? "\n" + sofar.join("\n") : "\n(this is the first turn)"));
    parts.push(`## Turn number\n${session.turns.length + 1}` + (session.turns.length + 1 >= 3 && !session.turns.some((t) => t.shown.cards.length || t.shown.earlyGuess)
      ? " (nothing has been shown yet: if any hypothesis is your strongest guess, give it its honest confidence; the app may offer it as an early guess)" : ""));
  }
  return parts.join("\n\n");
}
