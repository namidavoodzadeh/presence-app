// Issue #11 (setup task A7): one real call per operation in contract/openapi.yaml, read by contract_test.ts.
// A fixture, not an assertion: each scenario is the fake database (fake_supabase.ts) and request a handler in next/api
// answers with 2xx, so the success shape in the file is checked against what the server really returns. Database
// function replies (`__rpc`) copy the jsonb the migrations build (accept_invite 0054, receiver_view 0006,
// register_apns_device 0011).

export interface ContractScenario {
  operation: string;
  path: string;
  tables?: Record<string, Record<string, unknown>[]>;
  env?: Record<string, unknown>;
  callerId?: string;
  body?: Record<string, unknown>;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const BELIEF = "00000000-0000-4000-8000-0000000000c3";
const THEIR_BELIEF = "00000000-0000-4000-8000-0000000000c4";
const BRIDGE = "00000000-0000-4000-8000-0000000000d5";
const LINK = "00000000-0000-4000-8000-0000000000e6";
const INSTALLATION = "00000000-0000-4000-8000-0000000000f7";
const AT = "2026-11-20T09:00:00.000Z";

const profiles = () => [
  { id: ME, name: "Sam", initial: "S", color: "#7D6BC9", created_at: AT, settings: {} },
  { id: OTHER, name: "Robin", initial: "R", color: "#4F8A6B", created_at: AT, tz: "Europe/London" },
];
const link = () => ({ id: LINK, person_a: ME, person_b: OTHER, status: "active", created_at: AT });
const belief = (id = BELIEF, owner = ME) => ({
  id,
  owner,
  label: "Plain words",
  statement: "I mean things plainly.",
  own_wording: null,
  type: "something I believe is true",
  kind: "belief",
  level: 2,
  area: "relationships",
  domains: ["close_relationships"],
  status: "confirmed",
  rating: "very",
  confidence: 1,
  source: "own",
  created_at: AT,
  rated_at: AT,
  confirmed_at: AT,
});
const sentBridge = () => ({
  id: BRIDGE,
  sender: ME,
  receiver: OTHER,
  original: "I miss our walks.",
  bridged: null,
  final: "I miss our walks.",
  used: "mine",
  status: "scheduled",
  deliver_at: AT,
  tz: "UTC",
  heads_up: true,
  show_original: false,
  created_at: AT,
  updated_at: AT,
});

// POST /auth/apple: Supabase Auth's id_token grant answered without the network, so the real handler runs end to end.
let realFetch: typeof fetch | null = null;
function supabaseAuthDouble() {
  realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://auth.contract.invalid/auth/v1/token")) {
      return Promise.reject(new Error(`contract scenario: unexpected fetch ${url}`));
    }
    const now = Math.floor(Date.now() / 1000);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: "contract-access-token",
          refresh_token: "contract-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          user: { id: ME, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: AT },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
}
function restoreFetch() {
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = null;
}

export const SCENARIOS: ContractScenario[] = [
  {
    operation: "POST /auth/apple",
    path: "/auth/apple",
    tables: { profiles: profiles() },
    env: { supabaseUrl: "https://auth.contract.invalid", anonKey: "contract-anon-key" },
    body: { identity_token: "apple-identity-token", nonce: "raw-nonce", name: "Sam", adult_confirmed: true },
    setup: supabaseAuthDouble,
    teardown: restoreFetch,
  },
  {
    operation: "GET /home",
    path: "/home",
    tables: { profiles: profiles(), links: [link()], bridges: [sentBridge()], __rpc: [{ receiver_bridges: [] }] },
  },
  {
    operation: "PATCH /beliefs/{id}",
    path: `/beliefs/${BELIEF}`,
    tables: { profiles: profiles(), beliefs: [belief()] },
    body: { rating: "partly" },
  },
  {
    operation: "GET /beliefs/{id}",
    path: `/beliefs/${BELIEF}`,
    tables: {
      profiles: profiles(),
      beliefs: [belief()],
      receipts: [{ belief_id: BELIEF, owner: ME, quote: "I mean things plainly.", said_at: AT }],
    },
  },
  {
    operation: "GET /people",
    path: "/people",
    tables: { profiles: profiles(), links: [link()] },
  },
  {
    operation: "PUT /links/{person}/share/items/{belief_id}",
    path: `/links/${OTHER}/share/items/${BELIEF}`,
    tables: { profiles: profiles(), links: [link()], beliefs: [belief()] },
    body: { shared: true },
  },
  {
    operation: "POST /invites/{code}/accept",
    path: "/invites/ABC234/accept",
    tables: { profiles: profiles(), __rpc: [{ accept_invite: { link_id: LINK, person: OTHER } }] },
  },
  {
    operation: "GET /threads/{person}",
    path: `/threads/${OTHER}`,
    tables: { profiles: profiles(), links: [link()], bridges: [sentBridge()], __rpc: [{ receiver_bridges: [] }] },
  },
  {
    operation: "GET /drafts/{person}",
    path: `/drafts/${OTHER}`,
    tables: { drafts: [{ owner: ME, other: OTHER, text: "I wanted to say", reply_to: null, updated_at: AT }] },
  },
  {
    operation: "PUT /drafts/{person}",
    path: `/drafts/${OTHER}`,
    tables: { drafts: [] },
    body: { text: "I wanted to say", reply_to: null },
  },
  {
    operation: "DELETE /drafts/{person}",
    path: `/drafts/${OTHER}`,
    tables: { drafts: [{ owner: ME, other: OTHER, text: "I wanted to say", reply_to: null, updated_at: AT }] },
  },
  {
    operation: "GET /people/{person}/map",
    path: `/people/${OTHER}/map`,
    tables: {
      profiles: profiles(),
      links: [link()],
      beliefs: [belief(THEIR_BELIEF, OTHER)],
      share_items: [
        { owner: OTHER, other: ME, belief_id: THEIR_BELIEF, wording: "I mean things plainly.", shared_at: AT, updated_at: AT },
      ],
    },
  },
  {
    // Under twelve characters the app does not ask; the server's quiet reply is the shape every reply starts from.
    operation: "POST /bridge/insight",
    path: "/bridge/insight",
    tables: { profiles: profiles(), links: [link()] },
    body: { person_id: OTHER, text: "Hi", seq: 1, with_wording: true },
  },
  {
    operation: "POST /bridges",
    path: "/bridges",
    tables: { profiles: profiles(), links: [link()], bridges: [] },
    body: {
      person_id: OTHER,
      original: "I miss our walks.",
      bridged: null,
      final: "I miss our walks.",
      used: "mine",
      show_original: false,
      heads_up: true,
      deliver_at: "now",
      tz: "UTC",
      reply_to: null,
    },
  },
  {
    operation: "POST /bridges/{id}/open",
    path: `/bridges/${BRIDGE}/open`,
    callerId: OTHER,
    tables: {
      profiles: profiles(),
      __rpc: [{
        open_bridge: {
          id: BRIDGE,
          from: ME,
          sealed: false,
          ready: false,
          deliver_at: AT,
          opened_at: AT,
          final: "I miss our walks.",
          used: "mine",
          bridged_mark: false,
          original: null,
          tone: null,
          reply_to: null,
        },
      }],
    },
  },
  {
    operation: "PUT /devices/apns",
    path: "/devices/apns",
    tables: {
      __rpc: [{
        register_apns_device: {
          id: "00000000-0000-4000-8000-000000000108",
          installation_id: INSTALLATION,
          environment: "sandbox",
          bundle_id: "com.namidavoodzadeh.presence",
          locale: "en-GB",
          enabled: true,
          registered_at: AT,
          last_seen_at: AT,
        },
      }],
    },
    body: {
      installation_id: INSTALLATION,
      token: "a".repeat(64),
      environment: "sandbox",
      bundle_id: "com.namidavoodzadeh.presence",
      locale: "en-GB",
    },
  },
  {
    operation: "GET /export",
    path: "/export",
    tables: {
      profiles: profiles(),
      links: [link()],
      beliefs: [belief()],
      bridges: [sentBridge()],
      __rpc: [{ receiver_bridges: [] }],
    },
  },
  {
    operation: "DELETE /account",
    path: "/account",
    tables: { profiles: profiles() },
  },
  {
    operation: "DELETE /devices/apns/{installation_id}",
    path: `/devices/apns/${INSTALLATION}`,
  },
];
