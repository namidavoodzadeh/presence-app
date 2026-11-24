import { assertEquals } from "jsr:@std/assert@1";
import { decidePark } from "../engine/checkin/park.ts";

const writerId = "00000000-0000-4000-8000-000000000031";
const partnerId = "00000000-0000-4000-8000-000000000032";

const positive = [
  "My partner hurt me when I tried to leave the room.",
  "My partner threatened me after I said no.",
  "My partner controls who I can call.",
  "I am scared because my partner blocks the door.",
];

const negative = [
  "We keep missing each other when plans change.",
  "I wanted help with the dishes and did not say it clearly.",
  "We disagreed about which train to take.",
  "I felt left out when the invitation arrived late.",
];

Deno.test("TQ3: four mocked partner-harm positives are never parked or shared; only the writer gets resources", () => {
  for (const text of positive) {
    const out = decidePark(true, { writerId, partnerId, text }, { safety: "risk", reason: "writer safety" });
    assertEquals(out.state, "safety");
    assertEquals(out.store, null);
    assertEquals(out.shared, null);
    assertEquals(out.writer?.resources.resources[0].label, "Find a helpline");
  }
});

Deno.test("TQ3: four mocked ordinary negatives can be parked writer-only", () => {
  for (const text of negative) {
    const out = decidePark(true, { writerId, partnerId, text }, { safety: "none" });
    assertEquals(out.state, "parked");
    assertEquals(out.store, { writerId, partnerId, text });
    assertEquals(out.writer, null);
    assertEquals(out.shared, null);
  }
});

Deno.test("TQ3: the Check-in switch defaults closed and outbound abuse is not parked", () => {
  const input = { writerId, partnerId, text: negative[0] };
  assertEquals(decidePark(false, input, { safety: "none" }), {
    state: "feature_off",
    store: null,
    writer: null,
    shared: null,
  });
  assertEquals(decidePark(true, input, { safety: "threat_or_abuse" }), {
    state: "declined",
    store: null,
    writer: null,
    shared: null,
  });
});

Deno.test("TQ3 storage is writer-only and the server switch is opt-in", async () => {
  const [migration, env] = await Promise.all([
    Deno.readTextFile("../supabase/migrations/0020_parked_notes.sql"),
    Deno.readTextFile("api/lib/env.ts"),
  ]);
  assertEquals(migration.includes("using (auth.uid() = writer)"), true);
  assertEquals(migration.includes("auth.uid() = partner"), false);
  assertEquals(migration.includes("for insert"), false);
  assertEquals(migration.includes("for all"), false);
  assertEquals(env.includes('get("PRESENCE_CHECK_IN") === "true"'), true);
});
