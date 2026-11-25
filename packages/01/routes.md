# Package 01: routes

The server routes each view uses, by name from `next/api/CONTRACT.md`. Every route below is registered in `next/api/` today. Routes, fields and switches marked **not ready** must exist on the hosted project before the matching part can be built. Setup task A7 copies exactly these into `contract/openapi.yaml`.

Every call sends `Authorization`, `apikey`, `Content-Type`, `X-Presence-Client` and `X-Presence-TZ` (CONTRACT §0). Errors are always `{error, ref, message?, …}`.

## By view

| View | Route | Used for | Notes |
| --- | --- | --- | --- |
| `signIn` | `POST /auth/apple` | Sign in with Apple | `adult_confirmed: true` |
| `signIn` | `POST /auth/google` | Sign in with Google | **Not ready:** staging only (v1.74) |
| `signIn` | Supabase Auth refresh | Keep the session | Not an API route |
| `talk` | `GET /home` | The greeting's real line | Read-only |
| `talk` | `POST /comm/talk/turn` | First question (no `text`), then each answer | **Not ready:** see "The communication engine" below |
| `talk`, `invite` (typed line) | `POST /comm/items` | Keep a suggestion (`source: "talk_said"`) or the invite's typed line (`source: "typed"`) | **Not ready** (same switch). Needs `strength`, below |
| `talk` | `PATCH /beliefs/:id` | Partly, as `{rating: "partly"}`, until `POST /comm/items` takes `strength` | Engine to confirm it works on a communication item |
| `scope` | `GET /people` | Names under Who sees this | Active links only |
| `scope` | `PUT /links/:person/share/items/:belief_id` | Share a kept item with a person | Refuses kinds that never reach a card (`comm_kind_not_shareable`) |
| `you` | `GET /comm/items` | The list by kind | **Not ready** (same switch) |
| `kenning` | `GET /beliefs/:id` | The receipt (quote and date) | Engine to confirm receipts are returned for a communication item |
| `kenning` | `GET /comm/items/:id/visibility` | Seen by | **Not ready** (same switch) |
| `people` | `GET /home` | Rows, most urgent first, reasons | Read-only |
| `someoneNew` | `GET /comm/items` | The eligible gift | As above |
| `someoneNew` | `POST /invites` | The one-person link | **Not ready:** needs the gift fields, below |
| (invited person) | `GET /invites/:code` | What the invite carries | **Not ready:** needs the gift in its reply, below |
| (invited person) | `POST /invites/:code/accept` | Link the two people | `409` already linked; `404` used, expired or revoked |
| `thread` | `GET /threads/:person` | The cards between the two people | Receiver view per §1.7 |
| `thread` | `GET /drafts/:person`, `PUT /drafts/:person`, `DELETE /drafts/:person` | Keep unsent words | |
| `thread` | `GET /people/:person/map` | Only to pick the basis line: `403` means [Name] has shared nothing | Nothing from the reply is shown |
| `thread` | `POST /bridge/insight` | Underlines and notes at a pause | `{person_id, text, seq, with_wording: true, reply_to, from_me_skip}`; reads `state`, `highlights` (with `friction_kind`), `from_me`, `spans`, `headline`, `line`, `resources`, `seq` |
| `thread` | `POST /bridges` | Send now | `{person_id, original, bridged: null, final, used: "mine" \| "edited", show_original: false, heads_up: true, deliver_at: "now", tz, reply_to}` |
| `reading` | `POST /bridges/:id/open` | Open a folded card | Returns `final` |
| `thread` | `PATCH /cards/:bridge_id` | Keep: `{state: "kept"}` | **Not ready:** migration 0038 not deployed |
| (notifications) | `PUT /devices/apns` | Register for the `bridge_ready` push | Built (CONTRACT §12) |
| (routing), `aiConsent` | `GET /me` | `ai_consent.required_version` and `given` | **Not ready:** the `ai_consent` field is a proposal (§11.4) |
| `aiConsent` | `POST /consent/ai` | Give consent `{version, providers: ["anthropic"]}` | **Not ready** (§11.4) |
| `settings` | `DELETE /consent/ai` | Withdraw it | **Not ready** (§11.4) |
| `settings` | `GET /export` | Download your data | Built |
| `settings` | `DELETE /account` | Delete my account (revokes the Apple token first) | Built; refused on preview and example accounts |
| `settings` | `DELETE /devices/apns/:installation_id` | Log out | Built |

## Not ready

**1. The communication engine (owner answer 2b).** `POST /comm/talk/turn`, `/comm/items` and `/comm/items/:id/visibility` sit behind `PRESENCE_COMM_ITEMS` and the owner list `PRESENCE_COMM_OWNER_IDS`, and need migrations 0069, 0072 and 0075 applied (CONTRACT v1.85 to v1.96). Before package 01 can be built:
- the migrations applied on the hosted project;
- the switch on, with every test account on the owner list;
- field-level encryption of What lands hard and This week is not built, and the CPO spec keeps the switch off for real people until it is.

**2. A strength on a kept item.** `POST /comm/items` takes no strength, so Partly has nowhere to go. Proposed, additive: `strength: "very" | "partly"` (default `very`). Until then the app follows with `PATCH /beliefs/:id {rating: "partly"}`.

**3. The invite carries one thing (H2, X1).** Today `POST /invites` takes no body and `GET /invites/:code` returns only `{inviter: {name, initial}, expires_at}`. Proposed, additive:
- `POST /invites {relationship?, gift: {item_id}}`. `relationship` is `partner | friend | family`. `gift.item_id` must be the caller's own active item of an invite kind (How I mean things, What feels like care, How to bring something up with me), not scoped to one person; otherwise `403 forbidden`, `reason: "not_giftable"`. The invite keeps the id and a copy of the words at that moment.
- `GET /invites/:code` adds `gift: {kind, wording}` and `way_in: "invited_by_partner" | "invited_by_friend"` (partner → partner; friend or family → friend). Nothing else about the inviter.
- `POST /invites/:code/accept` also writes the per-person grant for the gift and the inviter's `relationship` on the link. Nothing else is shared.
- If the inviter sets the item aside before the accept, `gift` is `null` and no grant is written.

**4. Keep.** `PATCH /cards/:bridge_id` needs migration 0038 on hosted.

**5. Sign in with Google.** `POST /auth/google` on hosted.

**6. AI consent and its gate (App Store 5.1.2(i)).** CONTRACT §11.4 as written: `GET /me` `ai_consent`, `POST /consent/ai`, `DELETE /consent/ai`, and the gate on every route that sends words to a model. The gate must also cover `POST /comm/talk/turn` and `POST /comm/items` when they make a model call; §11.4 lists only the older routes.

**7. Kinds not offered yet.** Until field-level encryption exists for What lands hard and This week, the engine should not offer them in Talk (the app also drops such a card, `flows/talk.md`).

## Not used in package 01

Everything else in CONTRACT.md, including `POST /talk/turn` and the belief-card Talk, `/talk/finish`, `/kennings`, `GET /map`, `/kennings/map`, `/comm/map`, `/bridge/run`, `/bridge/reword-part`, `/bridge/why-it-matters`, scheduled `deliver_at`, `PATCH /bridges/:id`, withdraw, `/letstalk`, `/remind`, `/reading`, `/checkin/*`, `/mirror*`, `/imports/ai`, `/links/*` other than the share-item route, and `/preview/*`.
