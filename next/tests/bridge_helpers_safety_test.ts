// QA-B336 (QA 03:50Z 16 Nov): /bridge/reword-part and /bridge/why-it-matters send the draft to a model, so each runs the one safety entry
// first and fails closed. Real route table, recorded client, $0. A stop means no reword/why package is ever sent to a model.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/bridge_engine.ts";
import { UNREAD_LINE } from "../api/lib/safety_gate.ts";
import "../api/bridge_engine.ts";

const OWNER = "00000000-0000-4000-8000-000000000051";
const OTHER = "00000000-0000-4000-8000-000000000052";
const UNLISTED = "My brother keeps telling me the stairs at his place are going to be the end of me."; // the floor lets it through
const NONE = JSON.stringify({ act: "an ordinary evening", purpose: "neither", risk: "none", class: "ordinary", reason: "nothing" });
const OTHERS = JSON.stringify({ act: "poison a person", purpose: "harm", risk: "others", class: "plan", reason: "a plan to poison a person" });
const ORDINARY = "You always change plans at the last minute, so thanks for that.";

const PAST_GATE = "past-the-gate";
const db = { from() { throw new Error(PAST_GATE); } } as never;

function call(path: string, body: Record<string, unknown>, semantic: boolean) {
  const found = routes.find((r) => r.method === "POST" && r.pattern.test(path));
  assert(found, `no route for POST ${path}`);
  return found.handler({
    env: { safetySemantic: semantic }, req: new Request("https://presence.invalid" + path, { method: "POST" }), url: new URL("https://presence.invalid" + path),
    params: {}, caller: { id: OWNER, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}

function callV3(path: string, body: Record<string, unknown>) {
  const found = routes.find((r) => r.method === "POST" && r.pattern.test(path));
  assert(found, `no route for POST ${path}`);
  return found.handler({
    env: { safetySemantic: false, commItems: true, commOwnerIds: [OWNER] }, req: new Request("https://presence.invalid" + path, { method: "POST" }), url: new URL("https://presence.invalid" + path),
    params: {}, caller: { id: OWNER, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}

const ROUTES: [string, (text: string) => Record<string, unknown>][] = [
  ["/bridge/reword-part", (text) => ({ person_id: OTHER, text, start: 0, end: 5 })],
  ["/bridge/why-it-matters", (text) => ({ person_id: OTHER, text, belief_id: "b1" })],
];

async function withClient(client: RecordedClient, fn: () => Promise<void>) {
  hooks.client = () => client;
  try { await fn(); } finally { hooks.client = null; }
}

for (const [path, body] of ROUTES) {
  Deno.test(`${path}: a floor stop shows the resources and sends nothing to any model (switch on or off)`, async () => {
    for (const semantic of [true, false]) {
      const client = new RecordedClient({});
      await withClient(client, async () => {
        const res = await call(path, body("I want to end it all tonight."), semantic);
        const j = await res.json();
        assertEquals([res.status, j.state], [200, "risk"]);
        assert(j.resources, "resources are shown");
        assertEquals(client.exchanges.length, 0);
      });
    }
  });

  Deno.test(`${path}: with the switch on, a line the floor misses is stopped by the semantic reading, no downstream model call`, async () => {
    const client = new RecordedClient({ safety: [OTHERS] });
    await withClient(client, async () => {
      const j = await (await call(path, body(UNLISTED), true)).json();
      assertEquals(j.state, "risk");
      assertEquals(client.exchanges.map((e) => e.purpose), ["safety"]);
    });
  });

  Deno.test(`${path}: FAILS CLOSED, an unavailable reading is the "couldn't read" state (PSY 16 Nov 2c), never a pass, no downstream package`, async () => {
    const client = new RecordedClient({}); // no reply queued: the reading is unavailable
    await withClient(client, async () => {
      const j = await (await call(path, body(ORDINARY), true)).json();
      assertEquals(j.state, "unavailable");
      assertEquals([j.line, j.action, j.help], [UNREAD_LINE, "Try again", "Need to talk to someone now?"]);
      assert(j.resources, "the resources sheet is one tap away (2d)");
      assertEquals(client.exchanges.length, 0);
    });
  });

  Deno.test(`${path}: a clear reading goes on to the route (and only the one safety read has been made)`, async () => {
    const client = new RecordedClient({ safety: [NONE] });
    await withClient(client, async () => {
      let msg = "";
      try { await call(path, body(ORDINARY), true); } catch (e) { msg = (e as Error).message; }
      assertStringIncludes(msg, PAST_GATE);
      assertEquals(client.exchanges.map((e) => e.purpose), ["safety"]);
    });
  });
}

for (const path of ["/bridge/insight", "/bridge/run"]) {
  Deno.test(`${path}: V3 forces the semantic reader on while the general switch is off`, async () => {
    const client = new RecordedClient({ safety: [OTHERS] });
    await withClient(client, async () => {
      const res = await callV3(path, { person_id: OTHER, text: UNLISTED });
      const j = await res.json();
      assertEquals([res.status, j.state], [200, "risk"]);
      assertEquals(client.exchanges.map((e) => e.purpose), ["safety"]);
    });
  });
}

// Ratchet: Ask me. buildCards has no route yet; whoever adds one must also run semanticStops, or this fails.
Deno.test("source: any non-test caller of buildCards also calls semanticStops, and every model-sending Bridge helper gates its text first", async () => {
  const api = new URL("../api/", import.meta.url);
  for await (const f of Deno.readDir(api)) {
    if (!f.isFile || !f.name.endsWith(".ts")) continue;
    const src = await Deno.readTextFile(new URL(f.name, api));
    if (/\bbuildCards\(/.test(src)) assertStringIncludes(src, "semanticStops(", `${f.name} calls buildCards without semanticStops`);
  }
  const src = await Deno.readTextFile(new URL("bridge_engine.ts", api));
  for (const p of ["/bridge/reword-part", "/bridge/why-it-matters"]) {
    const at = src.indexOf(`route("POST", "${p}"`);
    const body = src.slice(at, src.indexOf("\nroute(", at + 10) === -1 ? undefined : src.indexOf("\nroute(", at + 10));
    assert(body.indexOf("helperStop(") !== -1 && body.indexOf("helperStop(") < body.indexOf("client.complete("), `${p} must gate before its first model call`);
  }
});
