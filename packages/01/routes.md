# Package 01: routes

The server routes each screen uses, by name from `next/api/CONTRACT.md`. Every route below is registered in `next/api/` today except where marked **does not exist yet**. Setup task A7 copies exactly these into `contract/openapi.yaml`.

Every call sends `Authorization`, `apikey`, `Content-Type`, `X-Presence-Client` and `X-Presence-TZ` (CONTRACT §0). Errors are always `{error, ref, message?, …}`.

## By screen

| Screen | Route | Used for | Notes |
| --- | --- | --- | --- |
| `signIn` | `POST /auth/apple` | Sign in, make the account | `adult_confirmed: true` is required |
| `signIn` | Supabase Auth refresh (`refresh_token`) | Keep the session | Not an API route; the Supabase endpoint |
| (routing) | `GET /conversations` | Has this person talked before; is a conversation open | `active` |
| (routing), `you`, `suggestions`, `invitePreview`, `home` (F5 line) | `GET /kennings` | Confirmed kennings (`groups`) and suggestions (`suggested`) | The code already returns `own_wording` and `offered_wording` on items (offered only on suggestions); CONTRACT §5 does not list them yet |
| `talk` | `POST /talk/turn` | Opener (`text: ""`, `source: "onboarding" \| "invite"`), then each turn | Non-streaming. `409` carries `active` |
| `talk` | `POST /talk/consent` | Sure, Not now, Never | |
| `talk` | `GET /conversations/:id` | Continue an open conversation; find a reply after a 30 s timeout | `unrated` cards |
| `talk`, `suggestions` | `PATCH /beliefs/:id` | That's me: `{rating: "very", own_wording}` or `{rating: "very"}` | |
| `talk` | `POST /talk/finish` | Close Talk | `ratings: []`, `not_now`; handles `still_working` |
| `kenning` | `GET /beliefs/:id` | Words and receipts | |
| `home` | `GET /home` | People in stack order with reasons | Read-only; check-in reasons are absent while that switch is off |
| `invitePreview` | `POST /beliefs` | F4b: the person's own line becomes a confirmed kenning | `{statement, relationship}`; `state: "safety"` answers 200 |
| `invitePreview` | `POST /invites` | Make the one-person link | **Needs new body fields, see below** |
| `gift` | `GET /invites/:code` | What the invited person sees before accepting | **Needs the gift in its reply, see below** |
| `gift` | `POST /invites/:code/accept` | Link the two people | `409` already linked; `404` used, expired or revoked |
| `person`, `home` (unread tap) | `GET /threads/:person` | The cards between the two people | Receiver view per §1.7 |
| `card` | `POST /bridges/:id/open` | Open a ready card | Sets `opened_at`; returns `final` |
| `write` | `GET /drafts/:person`, `PUT /drafts/:person`, `DELETE /drafts/:person` | Keep unsent words | |
| `write` | `GET /people/:person/map` | Only to choose the basis line: `403` means [Name] has shared nothing | Nothing from the reply is shown or sent anywhere in package 01 |
| `write` | `POST /bridge/insight` | Notes at a pause | Body `{person_id, text, seq, with_wording: true, reply_to}`; reads `state`, `spans` (belief spans), `highlights` (with `friction_kind`), `headline`, `line`, `resources`, `seq` |
| `write` | `POST /bridge/why-it-matters` | The "From what you said" line | `{person_id, text, belief_id}` from a belief span |
| `write` | `POST /bridges` | Send now | `{person_id, original, bridged: null, final, used: "mine" \| "edited", show_original: false, heads_up: true, deliver_at: "now", tz, reply_to}`; `outcome` is left out (the code stores null) |
| `safety` | none | Shows what the Talk, Write or invite reply carried | |

## Does not exist yet

**1. The invite carries one kenning (V3 F4, F4b, F3b).** Today `POST /invites` takes no body and `GET /invites/:code` returns only `{inviter: {name, initial}, expires_at}`. The server keeps no grant before a link exists (v1.55, law 10), so the invited person cannot read the gift before accepting, and the inviter's relationship choice has nowhere to go.

Proposed, additive:
- `POST /invites {relationship?, gift: {belief_id}}` → as today. `relationship` is `partner | friend | family` (or absent). `gift.belief_id` must be the caller's confirmed kenning with `own_wording` (`403 forbidden`, `reason: "not_confirmed"` otherwise). The invite row keeps the belief id and a copy of the words at that moment.
- `GET /invites/:code` → adds `gift: {wording}`: exactly the words the inviter saw on the preview ("[Name] will read exactly these words"). No id, no date, no other kenning, nothing else about the inviter. Still read-only.
- `POST /invites/:code/accept` → also writes the per-item grant (the same row `PUT /links/:person/share/items/:belief_id` writes, with the stored wording) and the inviter's `relationship` on the link. Nothing else is shared.
- If the inviter deletes or sets aside that kenning before the accept, `GET /invites/:code` returns `gift: null` and the accept writes no grant; the gift screen then shows the inviter's header with no words (engine to confirm this reading; it widens nothing).

Until this exists, the invite flow cannot be built as drawn. Nothing else in the package depends on it.

## Not used in package 01

Everything else in CONTRACT.md, including `POST /bridge/run`, `/bridge/reword-part`, scheduled `deliver_at`, `PATCH /bridges/:id`, withdraw, `/letstalk`, `/remind`, `/reading`, `GET /map`, `/kennings/map`, `/comm/*`, `/checkin/*`, `/mirror*`, `/imports/ai`, `/links/*`, `/export`, `DELETE /account`, `/preview/*` and streaming Talk.

`POST /comm/talk/turn` is the alternative Talk engine named in Q2. It is registered but behind an owner-only switch and its migration is not applied.
