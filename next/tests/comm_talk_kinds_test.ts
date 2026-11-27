// Issue #9. Acceptance test written in C4 from packages/01 (routes.md "Not ready" 7, flows/talk.md, compliance.md) and
// next/api/CONTRACT.md v1.87 (`POST /comm/talk/turn`) only. Until field-level encryption exists for What lands hard and
// This week, the engine does not offer them in Talk. (The app also drops such a card; that half is app-side, not here.)
//
// API the tests expect:
// - `POST /comm/talk/turn` (CONTRACT v1.87, unchanged shape) never answers a `reply.item` whose `kind` is `lands_hard` or
//   `this_week`, on any turn: an `ask` reply, the last answer's `done` reply, every `way_in`, a first or a later session,
//   and when every other kind is already held. Nothing else about the route changes.
// - The model double reaches the route through `hooks.client = () => double` of `next/api/talk.ts`, as `tests/comm_talk_api_test.ts`
//   does. The double always proposes the person's own last answer, word for word, as the item, so whatever kind the
//   engine attaches to it is the engine's choice; the answer the test gives fits the kind the engine asked about.
// - The route is registered in `next/api` (loaded through `next/api/index.ts`), behind `commItems` / `commOwnerIds`, on
//   `tests/fake_supabase.ts`. Between conversations the person keeps each offered item through `POST /comm/items`
//   (`source: "talk_said"`), as "That's me" does, so later sessions are reached.
// Positive control: the same walks must offer items at all (at least one offered item per walk, and at least three
// different kinds offered across the walks), so the test cannot pass because nothing is ever offered.
// Left out on purpose (a gap, see the issue): whether the engine may still ASK a lands_hard or this_week question
// (`reply.comm.kind`); the package only says those kinds are not offered.
import { assert, assertEquals } from "jsr:@std/assert@1";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface RouteLike {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: (ctx: unknown) => Promise<Response>;
}
interface ModelRequestLike {
  purpose: string;
  system: string;
  messages: { role: string; content: string }[];
  maxTokens: number;
  model?: string;
}
interface ModelClientLike {
  complete(req: ModelRequestLike): Promise<unknown>;
}

const ME = "00000000-0000-4000-8000-0000000000a1";
const PROFILE: Row = { id: ME, name: "Sam", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" };
const ENV: Row = { isHosted: false, releaseBuild: false, requireAiConsent: false, commItems: true, commOwnerIds: [ME] };
const NOT_OFFERED = ["lands_hard", "this_week"];

/** An answer in the person's words that fits each kind of question. */
const ANSWERS: Record<string, string> = {
  how_i_mean: "I go quiet when I'm tired, and it doesn't mean I'm upset.",
  feels_like_care: "A call from a friend made me feel looked after.",
  bring_up: "It helps when you ask me first before we talk about money.",
  lands_hard: "It's hard for me to hear that I was late.",
  gets_heated: "When it gets tense, I need to leave the room for a minute.",
  coming_back: "After a hard moment, it helps when we sit together quietly.",
  matters: "Being honest matters more to me than being liked.",
  this_week: "This week I'm short on sleep, so I may be slow to answer.",
  other: "I keep a paper diary and write in it every night.",
};

async function repoRoot(): Promise<URL> {
  let dir = new URL("./", import.meta.url);
  for (let i = 0; i < 8; i++) {
    try {
      await Deno.stat(new URL("AGENTS.md", dir));
      return dir;
    } catch { dir = new URL("../", dir); }
  }
  throw new Error("repository root (AGENTS.md) not found above " + import.meta.url);
}

/** The model proposes the person's last answer as the item, with a plain reflection and no question of its own. */
class EchoModel implements ModelClientLike {
  calls = 0;
  lastAnswer = "";
  complete(req: ModelRequestLike) {
    this.calls++;
    const raw = JSON.stringify({ reflection: "That sounds important to you.", question: "", item: this.lastAnswer });
    return Promise.resolve({
      purpose: req.purpose,
      request: { model: req.model ?? "double", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: raw,
      usage: { model: req.model ?? "double", inputTokens: 0, outputTokens: 0, cents: 0, ms: 1 },
    });
  }
}

async function api() {
  const root = await repoRoot();
  const router = await import(new URL("next/api/lib/router.ts", root).href) as { routes: RouteLike[] };
  await import(new URL("next/api/index.ts", root).href);
  const talk = await import(new URL("next/api/talk.ts", root).href) as { hooks: { client: (() => ModelClientLike) | null } };
  const errors = await import(new URL("next/api/lib/errors.ts", root).href) as {
    ApiError: new (...a: never[]) => Error & { code: string; extra: Record<string, unknown> };
    errorReply: (code: string, ref: string, message: string, extra?: Record<string, unknown>) => Response;
  };
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as { fakeClient: (t: Tables) => unknown };
  async function call(t: Tables, method: string, path: string, body: Row = {}) {
    const r = router.routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path} is not registered in next/api`);
    const m = r.pattern.exec(path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const db = fake.fakeClient(t);
    const url = new URL(`https://x.invalid${path}`);
    const res = await r.handler({
      env: { ...ENV },
      req: new Request(url, { method }), url, params,
      caller: { id: ME, db, persona: null, isExample: false, isPreview: false, profile: PROFILE },
      service: db, tz: "UTC", body: () => Promise.resolve(structuredClone(body)),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    return { status: res.status, body: await res.json() as Row };
  }
  return { call, talk };
}

interface Reply {
  state?: string;
  comm?: { kind?: string } | null;
  item?: { kind?: string; wording?: string } | null;
  item_state?: string | null;
}

/**
 * Walk Talk as a person would: open, answer each question in words that fit it, keep every offered item, and start a
 * new conversation when one ends. Every reply is checked; the offered kinds are returned for the positive control.
 */
async function walk(t: Tables, wayIn: string, label: string, conversations = 5, turnsEach = 8) {
  const { call, talk } = await api();
  const model = new EchoModel();
  talk.hooks.client = () => model;
  const offered: string[] = [];
  const check = (r: { status: number; body: Row }, where: string) => {
    assert(r.status < 500, `${label} ${where}: ${r.status} ${JSON.stringify(r.body)}`);
    const reply = (r.body.reply ?? {}) as Reply;
    const kind = reply.item?.kind;
    assert(!NOT_OFFERED.includes(String(kind)), `${label} ${where}: offered ${kind}: ${JSON.stringify(reply.item)}`);
    if (reply.item && kind) offered.push(kind);
    return reply;
  };
  try {
    for (let c = 0; c < conversations; c++) {
      const open = await call(t, "POST", "/comm/talk/turn", { way_in: wayIn, name: "Lea" });
      let reply = check(open, `conversation ${c} opener`);
      if (open.status !== 200 || reply.state !== "ask") break;
      const cid = (open.body.conversation as Row).id as string;
      for (let n = 0; n < turnsEach && reply.state === "ask"; n++) {
        const asked = reply.comm?.kind ?? "other";
        const text = ANSWERS[asked] ?? ANSWERS.other;
        model.lastAnswer = text;
        const r = await call(t, "POST", "/comm/talk/turn", { text, conversation_id: cid, way_in: wayIn, name: "Lea" });
        reply = check(r, `conversation ${c} turn ${n + 1} (asked ${asked})`);
        if (r.status !== 200) break;
        if (reply.item?.kind && reply.item.wording) {
          // "That's me": keep it, so the next conversation is a later session.
          await call(t, "POST", "/comm/items", { kind: reply.item.kind, wording: reply.item.wording, source: "talk_said" });
        }
      }
    }
  } finally {
    talk.hooks.client = null;
  }
  return { offered, calls: model.calls };
}

const held = (kind: string, i: number): Row => ({
  id: `held-${kind}`, owner: ME, label: kind, statement: ANSWERS[kind], own_wording: ANSWERS[kind], status: "confirmed",
  rating: "very", source: "own", comm_kind: kind, comm_scope_type: "everyone", comm_scope_value: null,
  comm_status: kind === "other" || kind === "gets_heated" || kind === "coming_back" ? "private_only" : "active",
  comm_source: "talk_said", comm_native: true, created_at: `2020-01-0${i + 1}T00:00:00.000Z`,
  confirmed_at: `2020-01-0${i + 1}T00:00:00.000Z`,
});

Deno.test("#9 Talk never offers What lands hard or This week, for any way in, across first and later sessions", async () => {
  const all: string[] = [];
  for (const wayIn of ["own_download", "invited_by_partner", "invited_by_friend"]) {
    const t: Tables = { profiles: [{ ...PROFILE }] };
    const { offered, calls } = await walk(t, wayIn, wayIn);
    assert(calls > 0, `${wayIn}: the walk reached the model`);
    assert(offered.length > 0, `${wayIn}: positive control, Talk offered items at all`);
    all.push(...offered);
  }
  assert(new Set(all).size >= 3, `positive control: several kinds were offered (${[...new Set(all)].join(", ")})`);
});

Deno.test("#9 with every other kind already held, Talk still offers neither kind", async () => {
  const others = ["how_i_mean", "feels_like_care", "bring_up", "gets_heated", "coming_back", "matters", "other"];
  for (const wayIn of ["own_download", "invited_by_partner", "invited_by_friend"]) {
    const t: Tables = { profiles: [{ ...PROFILE }], beliefs: others.map(held) };
    await walk(t, wayIn, `${wayIn}, all other kinds held`, 3, 8);
  }
  // Nothing new was kept under either kind on the way.
  // (A walk only keeps what Talk offered, so a stored lands_hard or this_week item means one was offered.)
});

Deno.test("#9 positive control for the held-kinds case: the same harness does reach the model and offer an item", async () => {
  const t: Tables = { profiles: [{ ...PROFILE }], beliefs: ["how_i_mean"].map(held) };
  const { offered, calls } = await walk(t, "own_download", "control", 1, 8);
  assert(calls > 0);
  assert(offered.length > 0, "an item was offered");
  assertEquals(offered.filter((k) => NOT_OFFERED.includes(k)), []);
});
