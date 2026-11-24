// $0 tests for the reply normaliser (CONTRACT §0: times in UTC with Z and milliseconds; A-Q10) and the client Ref header (A-Q8).
import { assertEquals } from "jsr:@std/assert@1";
import { clientRefs, isoUtc, json, normaliseTimes } from "../api/lib/errors.ts";

Deno.test("isoUtc: Postgres offsets and long fractions become Z with milliseconds; non-times pass through", () => {
  assertEquals(isoUtc("2026-10-27T09:14:22.06097+00:00"), "2026-10-27T09:14:22.060Z");
  assertEquals(isoUtc("2026-10-27T09:14:22+00:00"), "2026-10-27T09:14:22.000Z");
  assertEquals(isoUtc("2026-10-27 16:30:00+00"), "2026-10-27T16:30:00.000Z"); // an error detail from Postgres
  assertEquals(isoUtc("2026-10-27T20:00:00.5+03:30"), "2026-10-27T16:30:00.500Z"); // a zone other than UTC
  assertEquals(isoUtc("2026-10-27T10:43:12.123Z"), "2026-10-27T10:43:12.123Z"); // already right
  assertEquals(isoUtc("infinity"), "infinity"); // muted_until "always"
  assertEquals(isoUtc("2026-10-27"), "2026-10-27"); // a date is not a time
  assertEquals(isoUtc("Opens at 2026-10-27T10:43:12Z"), "Opens at 2026-10-27T10:43:12Z"); // text stays text
});

Deno.test("normaliseTimes touches time keys only", () => {
  const body = {
    created_at: "2026-10-27T09:14:22.06097+00:00",
    muted_until: "infinity",
    at: "2026-10-27 16:30:00+00",
    since: "2026-10-27T09:14:22+00:00",
    when: null,
    text: "2026-10-27T09:14:22.06097+00:00",
    label: "Late replies",
    nested: {
      deliver_at: "2026-10-27T20:00:00+03:30",
      items: [{ opened_at: "2026-10-27T09:14:22.1+00:00" }],
    },
  };
  const out = JSON.parse(JSON.stringify(body, normaliseTimes));
  assertEquals(out.created_at, "2026-10-27T09:14:22.060Z");
  assertEquals(out.muted_until, "infinity");
  assertEquals(out.at, "2026-10-27T16:30:00.000Z");
  assertEquals(out.since, "2026-10-27T09:14:22.000Z");
  assertEquals(out.when, null);
  assertEquals(out.text, "2026-10-27T09:14:22.06097+00:00");
  assertEquals(out.nested.deliver_at, "2026-10-27T16:30:00.000Z");
  assertEquals(out.nested.items[0].opened_at, "2026-10-27T09:14:22.100Z");
});

Deno.test("json() replies carry normalised times and the contract header", async () => {
  const res = json({ ok: true, at: "2026-10-27T09:14:22.06097+00:00" });
  assertEquals(res.headers.get("x-presence-contract"), "1");
  assertEquals(await res.json(), { ok: true, at: "2026-10-27T09:14:22.060Z" });
});

Deno.test("clientRefs: the Ref alphabet only, upper-cased, de-duplicated, at most eight", () => {
  assertEquals(clientRefs(null), []);
  assertEquals(clientRefs("7f3k"), ["7F3K"]);
  assertEquals(clientRefs("7F3K, XAUR 7F3K"), ["7F3K", "XAUR"]);
  assertEquals(clientRefs("0OI1"), []); // 0, O, I and 1 are not in the alphabet
  assertEquals(clientRefs("ABCDE"), []); // five characters
  assertEquals(clientRefs("AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH JJJJ").length, 8);
});
