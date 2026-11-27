// Issue #8: one scenario per model route (next/api/lib/ai_consent.ts MODEL_ROUTES), a fixture for tests/ai_consent_gate_test.ts.
// Each scenario is the smallest call that reaches that route's first model call on the fake database: the gate test proves it does
// with a current consent, and that it makes none without one. Not an assertion file; it holds no tests.

import { hooks as talkHooks } from "../api/talk.ts";
import { hooks as bridgeHooks } from "../api/bridge_engine.ts";
import { hooks as mirrorHooks } from "../api/mirror.ts";
import type { Caller } from "../api/lib/db.ts";
import type { Ctx } from "../api/lib/router.ts";
import type { ModelClient } from "../engine/model/client.ts";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

export interface ModelClientLike {
  complete(req: { purpose: string; system: string; messages: { role: string; content: string }[]; maxTokens: number; model?: string }): Promise<unknown>;
}

export interface ModelRouteScenario {
  route: string;
  path: string;
  body: Row;
  tables: () => Tables;
  env?: Row;
  install: (client: ModelClientLike) => void;
  uninstall: () => void;
}

const ME = "00000000-0000-4000-8000-0000000000a1";
const JAN = "00000000-0000-4000-8000-0000000000a2";
const CONVERSATION = "00000000-0000-4000-8000-0000000000c1";
const BELIEF = "00000000-0000-4000-8000-0000000000b1";
const WORDS = "I go quiet when I'm tired and people think I'm upset, but I'm not.";
const PROFILE: Row = { id: ME, name: "Sam", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" };
const COMM_ENV: Row = { commItems: true, commOwnerIds: [ME] };

const asClient = (c: ModelClientLike) => c as unknown as ModelClient;

const talk = {
  install: (c: ModelClientLike) => { talkHooks.client = () => asClient(c); },
  uninstall: () => { talkHooks.client = null; },
};
const bridge = {
  install: (c: ModelClientLike) => { bridgeHooks.client = () => asClient(c); },
  uninstall: () => { bridgeHooks.client = null; },
};

/** Two linked people, as the Bridge routes read them. */
function linked(): Tables {
  return {
    profiles: [{ ...PROFILE }, { id: JAN, name: "Jan", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" }],
    links: [{ id: "00000000-0000-4000-8000-0000000000l1", a: ME, b: JAN, owner: ME, other: JAN, status: "active", relationship: "partner" }],
    beliefs: [{
      id: BELIEF, owner: ME, label: "Quiet is not upset", statement: WORDS, status: "confirmed", rating: "very", confidence: 1,
      type: "something I believe is true", kind: "everyday", area: "relationships", domains: [], confirmed_at: "2026-11-02T00:00:00.000Z",
    }],
    receipts: [{ id: "00000000-0000-4000-8000-0000000000r1", owner: ME, belief_id: BELIEF, quote: WORDS, said_at: "2026-11-02T00:00:00.000Z" }],
  };
}

export const MODEL_ROUTE_SCENARIOS: ModelRouteScenario[] = [
  {
    route: "POST /talk/turn", path: "/talk/turn", body: { text: WORDS },
    tables: () => ({ profiles: [{ ...PROFILE }] }), ...talk,
  },
  {
    route: "POST /talk/finish", path: "/talk/finish", body: { conversation_id: CONVERSATION },
    tables: () => ({
      profiles: [{ ...PROFILE }],
      conversations: [{
        id: CONVERSATION, owner: ME, status: "active", mode: "text", risk_turn: null, hypotheses: [], deleted_at: null,
        created_at: "2026-11-20T00:00:00.000Z", last_active_at: "2026-11-20T00:05:00.000Z",
      }],
      messages: [
        { id: "00000000-0000-4000-8000-0000000000m1", owner: ME, conversation_id: CONVERSATION, role: "me", turn: 1, text: WORDS, superseded: false, deleted_at: null, answer_kind: "told" },
        { id: "00000000-0000-4000-8000-0000000000m2", owner: ME, conversation_id: CONVERSATION, role: "presence", turn: 1, text: "You go quiet when you're tired.", superseded: false, deleted_at: null },
      ],
    }),
    ...talk,
  },
  {
    route: "POST /bridge/insight", path: "/bridge/insight", body: { person_id: JAN, text: WORDS, seq: 1 },
    tables: linked, ...bridge,
  },
  {
    route: "POST /bridge/run", path: "/bridge/run", body: { person_id: JAN, text: WORDS },
    tables: linked, env: COMM_ENV, ...bridge,
  },
  {
    route: "POST /bridge/reword-part", path: "/bridge/reword-part", body: { person_id: JAN, text: WORDS, start: 0, end: 12 },
    tables: linked, ...bridge,
  },
  {
    route: "POST /bridge/why-it-matters", path: "/bridge/why-it-matters", body: { person_id: JAN, belief_id: BELIEF, text: WORDS },
    tables: linked, ...bridge,
  },
  {
    route: "POST /preview/mirror-sample", path: "/preview/mirror-sample", body: {},
    tables: () => ({ profiles: [{ ...PROFILE, is_preview: true }] }),
    install: (c) => {
      mirrorHooks.client = () => asClient(c);
      bridgeHooks.client = () => asClient(c);
      // The route authenticates itself; on the fake database the caller is the preview account.
      mirrorHooks.authenticate = (ctx: Ctx) => Promise.resolve({
        id: ME, db: ctx.service, persona: null, isExample: false, isPreview: true, profile: { ...PROFILE, is_preview: true },
      } as unknown as Caller);
    },
    uninstall: () => { mirrorHooks.client = null; bridgeHooks.client = null; mirrorHooks.authenticate = null; },
  },
  {
    route: "POST /comm/talk/turn", path: "/comm/talk/turn", body: { text: WORDS },
    tables: () => ({ profiles: [{ ...PROFILE }] }), env: COMM_ENV, ...talk,
  },
  {
    // The only model call here is the semantic safety reading, so the scenario turns it on.
    route: "POST /comm/items", path: "/comm/items", body: { kind: "how_i_mean", wording: WORDS, source: "typed" },
    tables: () => ({ profiles: [{ ...PROFILE }] }), env: { ...COMM_ENV, safetySemantic: true }, ...bridge,
  },
];
