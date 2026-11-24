// Insight engine v3 Step 2 merge gate. This fixture-only harness sends no real user words.
export type Label =
  | "must-silent"
  | "must-never"
  | "expect-tier-1"
  | "expect-tier-2"
  | "expect-tier-3";
export interface InsightDraft {
  id: string;
  purpose: string;
  draft: string;
  label: Label;
  sender: {
    name: string;
    items: Array<{ id: string; kind: string; words: string }>;
  };
  receiver: { name: string };
  shared_items: Array<{ id: string; kind: string; words: string }>;
  must_never?: string[];
}
interface Fixture {
  version: number;
  drafts: InsightDraft[];
}
export interface PipelineResult {
  tier: 0 | 1 | 2 | 3;
  note?: string;
  violations?: string[];
}
export type Pipeline = (
  draft: InsightDraft,
  mode: "real" | "mock",
) => Promise<PipelineResult>;

const PURPOSES = new Set([
  "raise a problem",
  "repair",
  "care or check-in",
  "reply",
  "decline or set a limit",
  "good news or plans",
  "logistics",
]);

async function fixture(): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(new URL("./drafts.json", import.meta.url)),
  ) as Fixture;
}

/**
 * Step 2's future route contract is next/engine/bridge/write_pipeline.ts:
 * export async function runInsightPipeline(draft, { mode: "real" | "mock" }): Promise<PipelineResult>
 * CI passes mock unless a recorded model implementation is selected. A normal keyed run passes real.
 */
async function routePipeline(
  mode: "real" | "mock",
): Promise<{ pipeline: Pipeline; built: boolean }> {
  const route = new URL(
    "../../next/engine/bridge/write_pipeline.ts",
    import.meta.url,
  );
  try {
    await Deno.stat(route);
    const module = await import(route.href) as {
      runInsightPipeline?: (
        draft: InsightDraft,
        options: { mode: "real" | "mock" },
      ) => Promise<PipelineResult>;
    };
    if (typeof module.runInsightPipeline !== "function") {
      throw new Error(
        "write_pipeline.ts must export runInsightPipeline(draft, { mode })",
      );
    }
    return {
      built: true,
      pipeline: (draft) => module.runInsightPipeline!(draft, { mode }),
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { built: false, pipeline: () => Promise.resolve({ tier: 0 }) };
    }
    throw error;
  }
}

export async function runInsightGate(
  mode: "real" | "mock" = Deno.env.get("ANTHROPIC_API_KEY") ? "real" : "mock",
) {
  const data = await fixture();
  if (
    data.version !== 1 || data.drafts.length < 56 || data.drafts.length > 70
  ) throw new Error("expected about 60 insight drafts");
  if (
    new Set(data.drafts.map((d) => d.purpose)).size !== PURPOSES.size ||
    data.drafts.some((d) =>
      !PURPOSES.has(d.purpose) || !d.sender.name || !d.receiver.name ||
      d.shared_items.length === 0 || !d.label
    )
  ) {
    throw new Error(
      "fixture must cover the seven purposes with sender, receiver, shared items, and label",
    );
  }

  const { pipeline, built } = await routePipeline(mode);
  const results = await Promise.all(
    data.drafts.map(async (draft) => ({
      draft,
      result: await pipeline(draft, mode),
    })),
  );
  const mustSilent = results.filter(({ draft }) =>
    draft.label === "must-silent"
  );
  const mustSilentSilent = mustSilent.filter(({ result }) => result.tier === 0);
  const mustNever = results.flatMap(({ draft, result }) =>
    (result.violations ?? []).map((violation) => ({ id: draft.id, violation }))
  );
  const tiers = Object.fromEntries(
    [0, 1, 2, 3].map((tier) => [
      tier,
      results.filter(({ result }) => result.tier === tier).length,
    ]),
  );

  const silentRate = mustSilent.length === 0
    ? 1
    : mustSilentSilent.length / mustSilent.length;
  console.log(
    `insight gate: ${results.length} fictional drafts; must-never ${mustNever.length}; must-silent ${mustSilentSilent.length}/${mustSilent.length} (${
      Math.round(silentRate * 100)
    }%); tiers 0=${tiers[0]} 1=${tiers[1]} 2=${tiers[2]} 3=${tiers[3]}`,
  );
  if (!built) console.log("insight gate: pipeline not built (silent stub)");
  if (mustNever.length) {
    throw new Error(
      `must-never cases: ${
        mustNever.map((x) => `${x.id}:${x.violation}`).join(", ")
      }`,
    );
  }
  if (silentRate < .9) {
    throw new Error(
      `must-silent rate ${Math.round(silentRate * 100)}% is below 90%`,
    );
  }
  return {
    built,
    total: results.length,
    mustNever: mustNever.length,
    silentRate,
    tiers,
  };
}

if (import.meta.main) {
  const mode = Deno.args.includes("--live") ? "real" : "mock";
  if (mode === "real" && !Deno.env.get("ANTHROPIC_API_KEY")) {
    throw new Error("--live requires ANTHROPIC_API_KEY");
  }
  await runInsightGate(mode);
}
