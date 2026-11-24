// Linux-safe contract tests for CONTRACT v1.22: every belief shape carries the neutral tone until its setter is decided.
import { assertEquals } from "jsr:@std/assert@1";
import { beliefsFor, cardsFor } from "../api/lib/objects.ts";

function emptyDb() {
  const query = {
    select: () => query,
    in: () => query,
    order: () => Promise.resolve({ data: [] }),
    then: (resolve: (value: { data: never[] }) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [] as never[] }).then(resolve, reject),
  };
  return { from: () => query } as never;
}

const row = {
  id: "belief-1",
  label: "Afterthought",
  statement: "Part of you may feel like an afterthought when plans move without you.",
  type: "something I believe is true",
  kind: "foundation",
  area: "relationships",
  domains: ["self", "close_relationships"],
  birth_mood: "lonely",
  confidence: 0.78,
  rating: null,
  status: "guess",
  tone: 0.9,
};

Deno.test("CONTRACT v1.22: every Card returns neutral belief tone", async () => {
  const [card] = await cardsFor(emptyDb(), [row]);
  assertEquals(card.tone, 0);
});

Deno.test("CONTRACT v1.22: every map Belief inherits neutral tone", async () => {
  const [belief] = await beliefsFor(emptyDb(), [row], []);
  assertEquals(belief.tone, 0);
});
