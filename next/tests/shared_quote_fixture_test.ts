// Contract v1.51: the shared-item quote fixture obeys the CPO ruling (d-cpo-law10-quote-10nov).
import { assert, assertEquals } from "jsr:@std/assert@1";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/bridge_insight_shared_quote.json", import.meta.url)));
type Entry = { wording: string; item_id: string | null; quote: string | null; quote_label: string | null };
const entries = (r: { highlights: { from_them: Entry[] }[] }) => r.highlights.flatMap((h) => h.from_them);

Deno.test("a quoted entry carries item id, words and the 'From what <Name> shared:' label together", () => {
  const quoted = entries(fx.reply_with_quote).filter((e) => e.quote !== null);
  assertEquals(quoted.length, 1, "at most one quoted entry per reply");
  const e = quoted[0];
  assert(e.item_id && e.quote_label && /^From what \S+ shared:$/.test(e.quote_label));
});

Deno.test("a revoked share has all three keys null and keeps the label-only wording", () => {
  for (const e of entries(fx.reply_after_revoke)) {
    assertEquals([e.item_id, e.quote, e.quote_label], [null, null, null]);
    assert(e.wording.length > 0);
  }
});

Deno.test("an unreadable receiver map gives no highlights from them", () => {
  assertEquals(fx.reply_receiver_not_readable.highlights, []);
});

Deno.test("the offsets point at the original words", () => {
  const t: string = fx.request.text;
  for (const h of fx.reply_with_quote.highlights) assertEquals(t.slice(h.start, h.end), h.original);
});

Deno.test("v1.61: every highlight says what it is about; no receiver note without its one shared item", () => {
  for (const r of [fx.reply_with_quote, fx.reply_after_revoke, fx.reply_receiver_not_readable]) {
    for (const h of r.highlights as { about: string; from_them: Entry[] }[]) {
      assert(h.about === "receiver" || h.about === "wording");
      if (h.about === "receiver") assert(h.from_them.some((e) => e.quote !== null), "a receiver note carries its shared item");
    }
  }
  assertEquals(fx.reply_with_quote.highlights.map((h: { about: string }) => h.about), ["receiver", "wording"]);
  assertEquals(fx.reply_after_revoke.highlights.map((h: { about: string }) => h.about), ["wording"]);
});
