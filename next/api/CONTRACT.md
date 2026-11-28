# Presence App v1 — API contract v1

Engine lane, 2026-10-27 13:10 Tehran. Built from `docs/APP-V1-BUILD.md` §4–§5 and Design Package v1 (`docs/design/v1/DESIGN-PACKAGE-v1.md`): "The user's story", the screen specs, "States every screen handles", "Edit, delete and archive rules", "Notifications", "The sculpture and the map blob".

**Status: CONTRACT v1 ready.** Later changes are additive and listed under "Changed" below. A field that is listed here is always present in the reply (with `null` when it has no value); new fields may appear and must be ignored when unknown.

## Changed

- v1.98 (2026-11-27, issue #8, package 01 routes.md "Not ready" 6; migration 0084): AI consent and the model-call gate, built from §11.4 as §7 "AI consent". `GET /me` gains `ai_consent`; new `POST /consent/ai` and `DELETE /consent/ai`; on a release deployment (and elsewhere with `PRESENCE_REQUIRE_AI_CONSENT=true`) every model route answers `403 forbidden`, `reason: "ai_consent_required"` without a current consent and makes no model call. The gate also covers `POST /comm/talk/turn` and `POST /comm/items` (when it makes a model call). Mirror (package 04) reads no moment on a release deployment until its consent flow is built: `POST /m/:slug/contributions` answers `403 forbidden` `reason: "feature_off"` and held moments stay held. Elsewhere a contributor needs their own current consent before their moment is stored, and again when a held moment is released (§11.4 "Mirror"). On `POST /comm/talk/turn` a concurrent retry of the same kept answer answers `409 conflict` `reason: "already_answering"`. Rollback: deploy the previous version (no switch turns the gate off in release); the table and columns can stay.

- v1.97 (2026-11-20, K-0046, PSY card and Ask me eligibility; migrations 0077 and 0078; behind `PRESENCE_COMM_ITEMS`, owner-only, staging first): `GET /comm/eligible-items?surface=card|ask` is the sole server-side eligibility read for card picker, Surprise me, pre-selection, story/photo preview and Ask me presets. It returns `{surface, items, question, adults_only}`. `items` includes only owner-confirmed, sufficiently scoped items that pass the conservative content and safety exclusions; `question` is `"Describe a time it happened."` and `adults_only` is true for `ask`, otherwise both are null/false. The content reader sees the item's own wording, is cached by wording hash, and fails closed; no item is made eligible by a reader. An Ask whose source is set aside, retired, or narrowed stops accepting new answers while retaining answers already received. Rollback: revert the route and migrations; no cards, asks, or answers are deleted.

- v1.42 (in progress on engine/v2, not on hosted; E27, CEO 09:55 PT 07 Nov: Bridge that uses both maps).
  - **Part 2 (analysis reads both maps).** `friction_kind` gains `heat` ("I hate", "sick of") and `you_blame` (a claim
    about what the receiver does or is: "you ignore my needs"). They can appear in `POST /bridge/insight` `spans[]`
    and `POST /bridge/run` `changes[].kind`, each with its fixed note/why line. **The app must decode an unknown
    `friction_kind` without failing before this reaches hosted.** No other reply field changes yet; the
    `highlights[]` and `summary` shape is part 3.
  - **Part 3 (`POST /bridge/run` reply, additive).** Every reply that read the draft carries `highlights[]`, `summary`
    and `words_changed`: `highlights: [{ start, end, original, suggested, why_line, friction_kind, from_you: [{ belief_id, wording,
    receipt, date }], from_them: [{ belief_id, wording }] }]` (UTF-16 offsets into `text`, in text order, never
    overlapping; `original` = `text[start:end]`; `suggested` is the verified rewrite's own words for that part, so the
    `bridged` text is built from the suggestions; `suggested` = `original` where the words stand; `why_line` is the
    fixed line per friction kind, or "This comes from something that matters to you: <the belief's wording>." / "This
    may touch something they've shared with you."; `friction_kind` is the friction the part carries, `null` for a part that only touches a
    belief; `from_you` receipts are the sender's own words with the date they said them, law 2; `from_them`
    is wording only, never a receipt, and only from beliefs the receiver shared, law 10). `summary` is one line that
    describes in plain words, no engine terms ("This comes from something that matters to you: part of you feels your
    needs come last when plans get made. Words like “I hate” and “you ignore my needs” may land as blame. It may touch
    something they've shared with you: direct asks."; the receiver's side by label only). A safety stop or a refusal carries
    `highlights: []` and `summary: null` (law 8). `could_not_bridge` now also carries the highlights and summary, with
    `suggested` = `original`.
  - **`nothing_to_change` only when nothing was found on either side.** Zero frictions and zero belief touches on both
    maps: `line` and `summary` = "Checked the wording for heat, blame and pressure, and both maps for what it touches.
    This already reads clearly." (was "This already reads clearly."). The vague_ask case keeps `nothing_to_change`
    with `ask_unresolved: true` and `next_step: "add_ask"` as in v1.5, now with its highlights and summary.
  - **Clear wording that touches a belief is `ok` with `words_changed: false`** and `bridged` = `text` (an exception to
    v1.5's "ok always carries a changed text"); the highlights carry the touches. Every other `ok` has
    `words_changed: true`.
  - Receiver beliefs on the phone route (E27 (4) first half): `POST /bridge/run` reads the receiver's shared beliefs
    only when the receiver is a practice person (`profiles.is_practice`), from the receiver's own `link_prefs` share
    (`share_on` and `share_areas`), confirmed beliefs only, wording only (never a receipt). A real receiver's map is never
    read through that area share (v1.52: their per-item grants are, see below). The practice person Jan's seed is still to come.
  - **Code validators after the analysis (CEO 13:15 PT 07 Nov), no shape change.** A friction whose kind has no sign
    in its own words (an always/never line with no absolute, a sarcasm line on a literal sentence, a you_blame or
    mind_reading line with no you-word, a heat line with no heat word, a vague_ask on a draft that asks) is named in the
    one repair call both routes already make; one that survives it is dropped, so it reaches neither `spans[]` nor
    `highlights[]`. A highlight's `from_you` is only a belief the sender confirmed; a belief wording or shared label that
    holds a friction kind's name is quoted in the summary and why line, so neither names a kind as the engine's own word.
  - **Eval spend apart (Q16 (a), migration 0032, not on hosted).** Eval and harness calls reserve under an `eval:` kind
    with its own 1,000¢ a UTC day; they no longer count toward the shared 3,000¢ (+500¢ owner preview). `GET
    /preview/spend` gains `eval_today_cents` and `eval_daily_cap_cents`; `today_cents` is what counts toward the shared
    cap. A refusal's ledger detail names `scope: "eval" | "shared"`. Before 0032 the kind is only a label.
  - Eval only: `POST /eval/bridge/run` (§6, closed on hosted) also answers `eval.analysis` (frictions, and the belief
    touches on both sides: the sender's with one receipt and its date, the receiver's shared ones wording only).

- v1.41 (2026-11-07, E26 P0, CEO 23:10 PT 06 Nov: "Bridge is the main function of the app... I have related
  beliefs that could help here"): three fixes to `POST /bridge/insight`, additive to v1.36/v1.40.
  - **Rated imports now count for `touches`.** `loadMap` (Bridge's and Mirror's read of the sender's own map) no
    longer excludes `source: "import"` beliefs (that exclusion stayed only on Talk's own `loadState`, so a session
    never quotes an import as something said in it). A touch now needs only status `endorsed` — the person's own
    rating (law 3) — never an extra `confidence >= 0.7` floor on top of it: that floor was law 9's live-conversation
    screen threshold, wrongly re-applied here, and it silently dropped every rated import because an import's
    engine-assigned confidence (`importConfidence()`) never reaches 0.7 regardless of the person's rating. This was
    the cause of Nami's report: his imported, endorsed beliefs were invisible to Bridge insight on two independent
    counts.
  - **Never an empty `state: "insight"`.** When the one retry `analyse()` already makes internally (the repair
    call) still leaves no readable analysis, the reply is now `state: "unavailable"`, `error_code:
    "insight_unavailable"`, with a `ref` — a reply the app shows Retry for — rather than the old `state: "insight"`
    with empty `points`/`spans`, indistinguishable from "nothing found yet".
  - **No friction found is a calm line, not a blank panel.** When `frictions` is empty on an ordinary `state:
    "insight"` reply, `line` now reads "Nothing here is likely to get in the way" instead of `null`. The softer
    Bridged version is unchanged: still only reachable by the sender's own tap at `POST /bridge/run`, never sent
    or applied from this route.
- v1.39 (2026-11-07, E24 (C) remainder, COO 2026-11-07 00:20 Tehran): `Person` gains `practice` (boolean), backed
  by its own `profiles.is_practice` column (migration 0030) — additive, distinct from `is_example`. `is_example`
  already carries other meanings (the preview-cast reset in `seed_preview.py`, the example-account refusal on
  `DELETE /map`/`DELETE /account`, the QA pair's Jo, who is `is_example` but never linked to the owner and so
  never `practice`); `practice` is the one plain signal the app needs to show a "Practice" label, without
  inferring it on the phone. True today for the owner's cast (Lea, Mom, Sam, Ari, Dara); false for Jo and every
  real or preview person.
- v1.38 (2026-11-07, SD6b, COO Q9 2026-11-06 17:15 Tehran, system design work plan #6): `POST /auth/apple` accepts
  an optional `authorization_code` so the backend can exchange it for an Apple refresh token (encrypted at rest,
  keyed to the profile) and `DELETE /account` revokes that token at Apple before the tombstone (§7). Nami's Apple
  key (`APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`) doesn't exist yet, so both the exchange and the revoke
  are a no-op everywhere today — nothing stored, nothing to revoke, sign-in and deletion behave exactly as before.
- v1.41 (2026-11-08, bridge cards; migration 0038, not deployed): additive. Bridge history is cards, never a chat thread. `GET /cards/:person` (a person's cards, latest first, closed ones apart) and `PATCH /cards/:bridge_id` (one state both people share: open, kept, talked, resolved, with who set it and when). See §6 "Cards".
- v1.45 (2026-11-09, E35, app Q-B4 option a; additive, no migration): `POST /bridge/insight` takes an optional `with_wording: true` (boolean; anything else is `400 invalid` field `with_wording`). With it the one reply also carries `bridged` (Bridge's wording, or null when the words stand or none could be verified), `highlights[]` and `summary` (the v1.42 shapes, `start`/`end` UTF-16 offsets into the sent `text`, `original` = `text[start:end]`), and `words_changed`. Without it the reply is as v1.43 (no new keys). Same states as before (`insight`, `risk`, `declined`, `unavailable`); `risk` and `declined` carry `bridged: null`, `highlights: []`, `summary: null` (law 8). `seq` is echoed. The floor runs before any model call; the draft is never stored (trace words become length + hash). Cost: this path runs the whole Bridge pipeline on the run model, so it books more than the plain 1¢ (see docs/design/dv16-live-insight-plan.md).
- v1.46 (2026-11-09, E36; migration 0042, not deployed; behind `PRESENCE_CHECK_IN`; additive): `PUT /checkin/:person_id/schedule` accepts `repeats: weekly | fortnightly | monthly` (default weekly; `400 invalid` field `repeats` otherwise). fortnightly = every second `day`, counted from the day the repeat was set (kept when re-PUT); monthly = the first `day` of each month. One-date form: `{ on: "YYYY-MM-DD", time, tz?, remind_other? }` with no `repeats` and no `day` (mixing is `400 invalid` field `repeats` or `day`; a malformed or past date is field `on`); reply `{ dated: { id, person_id, on, time, tz, remind_other, status, next_at } }`. Same date PUT again replaces it. A person has at most one repeating check-in plus any number of dated ones. `GET /checkin` adds `dated[]` (still to come, soonest first) and each home row adds `repeats`; `GET /checkin/:person_id` adds `dated[]`. A dated check-in is an invite like the repeating one: the person's accept answers both, decline removes invited ones, and the content-free reminder goes once within the hour before, only for accepted ones. `DELETE /checkin/dated/:id`.
- v1.48 (2026-11-09, E38 + E39 + E40; migration 0044, not deployed; behind `PRESENCE_CHECK_IN`; additive except the DELETE reply gains `drafts`): (E38) `deliver_at: "next_checkin"` on `POST /bridges` and `PATCH /bridges/:id` resolves to the soonest ACCEPTED check-in with that person, the repeating one or a dated one still to come; none at all is `400 invalid` reason `no_check_in`, only waiting ones `not_accepted`. (E39) `DELETE /checkin/:person_id/schedule` replies `{ deleted: true, drafts: [ { id, person_id, origin, text, created_at } ] }`: the writer's parked items for that person (notes and parked bridges; oldest first) come back once as drafts and leave the parked list (the reply is the only copy: the app saves the drafts before it says the check-in ended); a parked bridge not yet opened is withdrawn and the receiver sees nothing; talked and kept-for-later notes stay; `drafts` is empty when a dated check-in with that person is still to come, and for Just you. The row leaves the other person's lists (`/checkin/invites`, `incoming`); no notification, no text (law 10). (E40) every `GET /checkin` row, and a schedule object, carries `accepted_at` (null while invited), `moved_at` and `moved_by` (person id; set when an ACCEPTED check-in gets a new day, time, zone or repeat; a remind-only change or an edit before acceptance is not a move); a dated object carries `accepted_at`. `GET /checkin` adds `incoming[]`: check-ins other people started with me that I accepted (`check_in_id, person_id, repeats, day, time, tz, next_at, accepted_at, moved_at, moved_by`), soonest first, so the other side can say who moved it.
- v1.50 (2026-11-10, V25 board 13 Let go; no migration; behind `PRESENCE_CHECK_IN`; additive): `DELETE /checkin/notes/:id` → `{ "deleted": true }`. The writer takes one of their own notes off their list for good: a hard delete in any state (parked, kept for later, talked about). Writer only; any other caller, or an unknown id, is `404 not_found`, `where: "note"` (the route never says whether the note exists). If the note is a parked bridge's words (`origin: "bridged"`, state `parked`) and nobody has opened the bridge, the bridge is withdrawn as in `DELETE /checkin/:person_id/schedule`; an opened bridge is left as it was. The other person is told nothing and gets no push (laws 10, 11). A second call on the same id is `404`. Keep stays as `PATCH` state `later`.
- v1.87 (2026-11-15, CEO V3 alignment 4.2 Talk on the bank; migration 0069 first; NOT applied, NOT deployed; same switch and owner list as v1.85; additive; the ordinary `POST /talk/turn` is unchanged): `POST /comm/talk/turn {text?, conversation_id?, way_in?, name?}` (`way_in` `invited_by_partner` | `invited_by_friend` | `own_download`, default `own_download`; `name` at most 40 characters, put into the bank's question in place of "someone close"). No `text` = the opener: the planner's first question, no model call, one presence row at turn 0 (an answer is required once a question is open: `400 invalid` `field: "text"`). With `text` = the answer to the question asked before: a wording that shows risk answers `200` with `reply.state: "safety"`, `resources`, no conversation or message, no call and nothing stored (law 8); otherwise the answer is stored like any Talk turn and ONE model call is made (`purpose` `talk_comm_turn`, ledger scope `talk`, traced in `engine_calls`). Reply: `{conversation: {id, status, session_number}, message, reply: {message_id, turn, state: "ask"|"done"|"safety", reflection, question, comm: {kind, question_from: "model"|"bank"}|null, item: {kind, wording}|null, item_state: "offered"|"offer_request"|"offer_i_statement"|"drop"|"safety_route"|null, offer?, reason?, resources?}, latency_ms}`. The model's question is kept only when it passes the 4.2 rules, otherwise the bank's own words, word for word; a failed call (timeout, unreadable) is not a failed turn: the bank's question, no reflection, no item; a refused ledger is `429 daily_limit` as in Talk with `saved: true`. `reply.item` is at most one item in the person's own words (75% of its content words are theirs, at most 40 words, through the 4.3 checks as said in Talk) and is NEVER stored by this route: "That's me" posts it to `POST /comm/items` with `source: "talk_said"` (law 3). `state: "done"` (`reason` `end_on_care` | `session_budget` | `nothing_left`) carries the last answer's reflection and item, asks nothing, and marks the conversation finished. `session_number` is 2 when an item existed before this conversation began. Model: `claude-sonnet-5-5` until the staging gold run records a pass for the cheaper model. `403 forbidden` `reason: "feature_off"|"owner_only"` otherwise. Rollback: revert the commit (unset the switch). Tests `next/tests/comm_talk_api_test.ts`.
- v1.88 (2026-11-15, CEO V3 alignment 4.4 per-surface reads, Check-in; NOT applied, NOT deployed; no migration; additive; same switch and owner list as v1.85): the session view (`GET|POST /checkin/:person_id/session` and every route that returns `session`) gains `theirs.shared`: `[{kind, heading, wording, when}]`, the other person's shared items the check-in may show, in the items phase only (`[]` in the appreciations phase). Only `feels_like_care`, `bring_up`, `coming_back` and `this_week` (the table in `engine/comm.ts`, surface `checkin`); never `lands_hard`, `gets_heated`, `how_i_mean`, `matters` or `other`; never `private_only`, set-aside, expired or unconfirmed items; a person-scope item only for that person, a type-scope item only when the item's owner labels the reader with that type (`link_prefs.relationship`, friend = friends; no label = not shown). Words by kind only: no id, no date, no count. Read live at each view, nothing about it stored in the session. `[]` when `PRESENCE_COMM_ITEMS` is off or the reader is not on `PRESENCE_COMM_OWNER_IDS`, so the shipped app sees an empty list. Rollback: revert the commit. Tests `next/tests/checkin_shared_items_test.ts` (6).
- v1.89 (2026-11-15, CEO V3 alignment 4.4 per-surface reads, Reading; NOT applied, NOT deployed; no migration; no new field on any route; behaviour only): `POST /bridges/:id/reading` reads a granted item (`share_items`) of a kinded V3 item only when its kind is `how_i_mean` or `this_week` (table in `engine/comm.ts`, surface `what_may_mean`, helper `grantMayRead`); a grant on `lands_hard`, `gets_heated`, `matters`, `feels_like_care`, `bring_up`, `coming_back` or `other`, on a set-aside item, or on an expired `this_week` is not read. When nothing is left the answer is the same `{available:false}` as "nothing granted", with no model call. A grant on an old kenning (no kind) carries on exactly as before (CARRY-2). The system text is unchanged (the "beliefs" wording waits for PSY). Rollback: revert the commit. Tests `next/tests/reading_test.ts` (1 new).
- v1.90 (2026-11-15, CPO READ-1 split, 21:50Z; NOT applied, NOT deployed; no migration; no new field; behaviour only): `GET /kennings/map` and the older `GET /map` leave out every item with a `comm_kind` (a V3 communication item: no topic line, no honest place on the map, laws 1 and 3): not a station, not in `set_aside`, not in the counts, not an ask. `GET /kennings` (the List) and `GET /comm/items` (You) are unchanged and show them to their owner. Old kennings are byte-for-byte as before. The map read now selects `*` and trims to its own columns in code, so it works the same before and after migration 0069. Rollback: revert the commit. Tests `next/tests/kenning_map_test.ts` (1 new), `next/tests/map_comm_hidden_test.ts` (1).
- v1.91 (2026-11-15, COO 23:20Z contract gaps from app, app2, app3; NOT applied, NOT deployed; additive; needs migration `0072_comm_source.sql` after 0069; behind the owner-only switch): (a) `PATCH /comm/items/:id` accepts `kind` (Change kind is a PATCH, not delete + POST; Q-APP2-COMM-5 (1)). Today's words are re-checked under the new kind exactly as a typed item (4.3: safety floor, control of another person, about the other person, forbid-raising, never-on-screen words); a refusal answers as POST does (`state` `safety` | `offer_request` | `offer_i_statement` | `not_kept`, `item: null`) and changes nothing. Words, date, receipts and rating are untouched and no receipt is added. Changing kind never widens who reads it: an `active` item moved into `lands_hard`, `this_week`, `gets_heated`, `coming_back` (without a person scope) becomes `private_only` unless the same PATCH sets `status`; an explicit widening is `400 item` with `problems`. Moving to `this_week` sets the expiry (`expires_in_days`, default 14); moving away clears it; leaving `matters` drops the topic. A pending carry-over suggestion on the item is cleared (the person has chosen) and the item counts as confirmed (`last_confirmed_at`). (b) The item shape gains `source`: `typed` | `talk_said` | `null` (null on an old kenning carried over; Q-APP2-COMM-5 (2)); `dated_at` is the day the words were typed or said. A `PATCH` with new `wording` makes the item `typed` and dated today, as its new receipt is. `POST /comm/items` already took `source`; it is now stored. (c) Carry-over, naming only (Q-APP3-CARRY-1): the suggested kind for an old kenning is `suggestions[].kind` in `GET /comm/suggestions` (the row `id` is the kenning id; app3's `proposedKind` is nil when the id is not in that list, and the list is the next three, so a kenning not yet in it has no card). "Leave it" is `POST /comm/suggestions/:id {action:"dismiss"}`: stored, the suggestion is cleared and never returns, the item stays under Other and shared as before (v1.86, unchanged). "Change" is (a), a `PATCH` with `kind`. (d) `POST /bridge/insight`: when the comm owner switch is on for the caller and the reply's `state` is `insight`, the reply carries `from_me`: `{item_id, wording}` or `null` (Q-APP-P4-1 (2)). It is one of the sender's OWN `how_i_mean` items (active or private_only, not expired, shared with this person or not: only the sender sees it) chosen on the server by shared content words with the draft, no model; `null` when the receiver shared something (Bridge then uses theirs), or when nothing fits. Absent everywhere else (switch off, safety, declined, unavailable) so those replies are byte for byte as before. Never stored with the saved insight; computed fresh each time. Rollback: revert the commit; `alter table public.beliefs drop column if exists comm_source;`. Tests `next/tests/comm_items_api_test.ts` (5 new), `next/tests/comm_from_me_test.ts` (4).
- v1.92 (2026-11-16, CPO Q-APP-P4-2 + PSY Q-ENG-FROMME-1 5a-5f; no migration; additive; staging only): `POST /bridge/insight` `from_me` is now narrower, owner switch only. It names ONLY one of the sender's own How I mean things items that the sender has shared with THIS receiver now (a live per-person grant, not set aside, not expired): `{item_id, wording}` with the wording as shared, else `null`; a private item never gets a line. Chosen on the server by shared words, no model: the shared word must come from the item's first half (everything before "means", or before the comma when the item starts with "When"; a match on the second half alone never fires; an item with neither shape needs two shared content words); a fixed never-count list (say/said, tell/told, talk, mean, feel, want, need, know, think, thing, time, really, just, people, someone, something, sorry, today, tonight, week and their plain endings); plain endings (s, ed, ing, ly) are the same word, no synonyms; at most one line per draft, ties to the more recently confirmed. New optional body field `from_me_skip` (array of up to 20 item ids, strings): ids the person passed or edited past in this draft; they are not offered again (more than 20, or any non-string, is `400 invalid` `field: "from_me_skip"`). Never on a risk, declined or unavailable reply. Tests `next/tests/comm_from_me_test.ts` (6, including PSY's fixed set of 20 pairs in `next/tests/fixtures/comm_from_me_pairs.json`).
- v1.93 (2026-11-16, CPO Q-ENG-READ1-CARRYOVER-1 (b), COO 03:20Z; migration `0075_comm_native.sql` after 0069 and 0072; NOT applied, NOT deployed; additive; staging first): the Map keeps every old kenning, including one the carry-over pass gave a kind; only items CREATED as communication items stay off it. `GET /kennings/map` and `GET /map` (v1.90) now leave out rows with `comm_native = true`, not rows with a `comm_kind`. `comm_native` is written `true` only by `POST /comm/items` (+ Add, the Talk bank answer); carry-over, "That's me" on a suggestion, a re-word and a change of kind never set it, so a carried-over item stays on the Map whatever it becomes. No new field on any route. The carry-over job may run on staging once this is applied. `GET /kennings` and `GET /comm/items` are unchanged. Rollback: revert the commit; `alter table public.beliefs drop column if exists comm_native;`. Tests `kenning_map_test.ts` (1 new, 1 changed), `map_comm_hidden_test.ts` (changed), `comm_items_api_test.ts` (2 assertions).
- v1.86 (2026-11-15, CEO V3 alignment 4.7 carry-over; migration 0071 `comm_suggestion` after 0069; NOT applied, NOT deployed; same switch and owner list as v1.85; additive): `GET /comm/suggestions` returns `{suggestions: [{id, wording, kind, heading, topic}]}`: at most three of the kinds the background carry-over pass suggests for the owner's old kennings, strongest first, words and kind only (never a confidence, a count, a total or a progress figure; empty list when none). `POST /comm/suggestions/:id {action: "accept"|"dismiss"}`: accept ("That's me") re-runs the 4.3 checks on today's wording (a refusal answers `200 {item: null, state: "not_kept"|...}` and writes nothing), then writes the kind with `last_confirmed_at`; exactly one grantee today gives scope `person` for that person (`active`), none or several stays `everyone`/`private_only` while the old grants carry on unchanged (sharing never widens), and `topic` survives only on `matters`; answers `200 {item, state: "accepted"}`. dismiss clears the suggestion and keeps the item under Other, shared as before, never suggested again: `200 {item, state: "dismissed"}`. Unknown id, already answered, someone else's item: `404 not_found` `where: "comm_suggestion"`; other `action`: `400 invalid` `field: "action"`. The job itself is `next/scripts/comm_carryover_job.ts` (plan / submit / collect, Batch API, staging only, no hosted switch, not run). After the pass an item that was a plain kenning shows under Other on `GET /comm/items`, and `PUT /links/:person/share/items/:belief_id` refuses NEW grants on it until the person confirms a kind (its existing grants stay). Rollback: revert the commit (unset the switch; 0071's own rollback lines are in the migration). Tests `next/tests/comm_items_api_test.ts`, `next/tests/comm_carryover_job_test.ts`.
- v1.85 (2026-11-15, CEO V3 alignment, docs/engine/COMM-CONTRACT.md; migration 0069 `comm_items` must be applied first; NOT applied anywhere, NOT deployed; behind `PRESENCE_COMM_ITEMS` plus `PRESENCE_COMM_OWNER_IDS`, off and empty by default; additive): the owner's own communication items. `GET /comm/items` returns `{this_week: [item], groups: [{kind, heading, starter, items}]}` (This week on top, then the kinds in the You order, newest first, empty kinds absent, expired and deleted items never). `POST /comm/items {kind, wording, scope?, when?, expires_in_days?, topic?, status?, source?}` stores one item the person typed or said in Talk (`source` `typed` default or `talk_said`; any other source is `400 invalid` `field: "source"`, because lands_hard and this_week are never inferred), answers `201 {item, state: "created"}` with one receipt of their own words; a wording that shows risk answers `200 {item: null, state: "safety", resources}` and stores nothing; the 4.3 checks answer `{item: null, state: "offer_request"|"offer_i_statement"|"not_kept"}` and store nothing. `scope` is `{type: "everyone"|"type"|"person", value}`; `status` defaults by kind (one-person kinds and Other `private_only`, the rest `active`); `expires_in_days` is 7, 14 (default) or 30 and only for `this_week`. `PATCH /comm/items/:id {wording?, scope?, when?, status?, expires_in_days?, topic?, still_true?}` re-words (one more receipt, same checks), re-scopes, sets aside (`status: "set_aside"`), or confirms (`still_true: true` sets `last_confirmed_at`); every rule is re-checked (`400 invalid` `field: "item"`, `problems: [..]`, for example `one_person_at_a_time`). `DELETE /comm/items/:id` marks it deleted (`{deleted, undo_until}`). `403 forbidden` `reason: "feature_off"|"owner_only"` when the switch is off or the account is not listed. Item shape: `{id, kind, wording, scope, when, expires_at, last_confirmed_at, status, topic, still_true_due, dated_at}`. The stored row is a `beliefs` row with the 0069 columns and fixed compatibility values (type `something I believe is true`, kind `everyday`, area the topic or `relationships`, source `own`, no level). `PUT /links/:person/share/items/:belief_id` now refuses a NEW grant (`403 forbidden` `reason: "comm_kind_not_shareable"`) on an item whose kind never reaches a card (lands_hard, gets_heated, coming_back, this_week, other) or that is not `active`; revoking and existing grants are unchanged. Field-level encryption of lands_hard and this_week is NOT built, so the switch stays off for real people until it is. Rollback: revert the commit (unset the switch; 0069's own rollback lines are in the migration). Tests `next/tests/comm_items_api_test.ts`.
- v1.96 (2026-11-19, K-0040; migration 0075 after 0069; NOT applied, NOT deployed; owner-only switch as v1.85): V3's separate kind-line view is `GET /comm/map`. It returns `{lines: [{kind, heading, stations}], list}` where a station is `{id, wording, scope:{type,value}, when, hidden, show_separately}`. Only the owner's confirmed, non-expired, non-set-aside communication items appear. `lines` has one line per kind; within it scope is left-to-right `everyone`, `type`, `person`, then scope value/id. `list` is the exact same stations in that order without spatial data. There is no engine size, direction, link, conflict, centrality, or total. `PATCH /comm/items/:id/map {hidden?,show_separately?}` stores the two 0075 boolean fields on that owner row and returns `{station}`; hiding affects the Map only, never List, sharing, or a receipt. Change word remains `PATCH /comm/items/:id {wording}`: safety runs before it writes the person's replacement wording and receipt. `GET /comm/items/:id/visibility` returns `{item_id,scope,people:[{person_id,name,sees}]}` for active links. Each `sees` is read via the live pair context, so the per-person grant plus current status, expiry and scope must all permit the same item; it is never a cached audience. `GET /comm/card-items` returns `{items:[{id,wording,kind,topic}],max_selected:3,persisted:false}` for the local card maker: confirmed active own-word items only, excluding What lands hard, When it gets heated, Coming back after, This week, and politics/faith/body tags. It creates no card, selection, or share record; the phone renders and shares locally. Rollback: revert the commit; migration 0075's rollback drops only its display columns. Tests `next/tests/comm_map_test.ts`.
- v1.81 (2026-11-15, COO 15:25Z 15 Nov AI-BUDGET; migration 0067 `monthly_ai_budget`; STAGING ONLY, not applied anywhere yet; hosted waits for Nami's yes and figure): the lifetime 20,000¢ cap becomes a monthly budget from the one-row table `ai_budget(monthly_cap_cents, warn_pct_1, warn_pct_2)` (seed 20,000 / 50 / 80; the amount is a setting, one `update`, no deploy). `ledger_reserve` sums this UTC month of live use (every kind except `eval:*`) and refuses with `month_limit` (`month_used_micros`, `month_cap_micros`, `opens_at` = the 1st of next month 00:00 UTC); eval spend keeps its own 1,000¢ day cap. The API maps it to the same 429 `daily_limit` code the app already handles, with `message` "Talk opens again on <D Month>.", `opens_at` and `limit: "month_limit"` (a true date, never "12:00 AM"). `ledger_snapshot()` keeps every key and adds `month_cents`, `month_cap_cents`, `month_pct`, `level` (`ok` below warn_pct_1, `warn` from it, `high` from warn_pct_2, both inclusive) and `month_opens_at`; `total_cents` stays as information and `total_cap_cents` is null. The 3,000¢ day cap, 300¢ person allowance and eval cap are unchanged. Rollback: re-run `ledger_reserve` and `ledger_snapshot` from 0033 (the lifetime cap returns at once); `drop table ai_budget` optional. Not built here: the supervisor's hourly alert line per level per month (reads `level`), and the CPO's sentence if it differs from the one above.
- v1.82 (2026-11-15, COO 16:20Z 15 Nov, Q-APP-B358-2 (1) answered yes; no migration; no shape change; STAGING ONLY until QA, not in the hosted map-only cut): the `receipts` list on `GET /kennings/map` carries the receipts a `hidden: true` station's memberships cite on the owner's own read, so the List sheet shows their own words (this was already so in v1.80; it is now the rule and is tested both ways). On a `?seen_by=` read hidden stations are not returned and their receipts are never in `receipts`, even when the person had shared that kenning with the other before keeping it off. Rollback: revert the commit.
- v1.84 (2026-11-15, COO 17:20Z 15 Nov, READY 2 / CPO KM2-C3; no migration; additive in shape; staging after QA, not in the hosted map-only cut): each station on `GET /kennings/map` carries `keyword_candidates`: up to 6 other words for that kenning's word menu, each a word the person wrote in the kenning's wording or its receipts, passing every station rule (v1.83 lists, the station's own lines, names the person only writes capitalised mid-sentence), in the order they first appear (wording first, then receipts by id), never the station's current word or its plural. Empty array when none passes, and always empty on a `?seen_by=` read (the menu is the owner's). A harsh self-statement offers the topic (`Enough`), never the verdict, and `Worth` only if the person wrote it (C1). No AI at map time, no phone tagger; same rows give the same list. Rollback: revert the commit (the phone treats a missing field as empty).
- v1.83 (2026-11-15, QA 17:21Z 15 Nov, QA-B368 rejection 2; no migration; no shape change; staging after QA, not in the hosted map-only cut): the server's keyword rules now equal the phone's KM2-W4 / PSY C1-C4 lists, so a word the phone would draw as a dot never arrives. Besides the CPO map-banned, trait, judgement and feeling words, a station word may not be a feeling, mood or clinical word even when the person said it (`Peace`, `Calm`, `Love`, `Tired`), a kind of person (`Pleaser`, `Hero`, `Strong`, `Kind`), a health, substance, sexual or body word (`Alcohol`, `Weight`, `Face`), a verdict (`Good`, `Best`, `Normal`), a weak noun (`Part`, `Thing`, `People`), or a banned UI word. `Worth` is a station word only when the person wrote the word `worth` themselves (C1: it is the stem of `worthless`). A stored word that fails falls back to the label's or wording's next passing word, else `keyword: null`, `keyword_source: "none"`. Applies at read time to every stored keyword, so no backfill. Rollback: revert the commit.
- v1.80 (2026-11-15, COO 15:25Z 15 Nov READY ITEM 3, Q-APP-B358-1 answered yes; no migration; additive; STAGING ONLY until QA passes it; NOT in the hosted map-only cut): `GET /kennings/map` also returns a person's kept-off kennings (`beliefs.hidden_from_map = true`, confirmed or Partly, same filter as the drawn ones) in `stations[]` with `hidden: true`, after all drawn stations; every drawn station carries `hidden: false`. A hidden station has the same fields as a drawn one (words, strength, lines, `said_in`, `said_dates`, `keyword`, `memberships` with receipt ids, `group_id`) with `central`, `new` and `ask_central` always false; its `group_id` is the alone form (`k:<home line>:<kind>`) because it is never folded. It is for the List only: it is never in `layout`, `links`, `ask_comes_from` or `lines`, and the `receipts` list includes the receipts its memberships cite so its sheet shows the person's own words (law 2). A Seen-by view (`?seen_by=`) never returns hidden stations. Turning it back on is the existing `PATCH /kennings/:id/map {"hidden": false}`; the next GET draws it. Numbering: v1.79 was already taken by the talk.finish note, so this is v1.80. Rollback: revert the commit; a client that ignores `hidden` shows hidden stations as drawn ones, so the phone half must ship with or after this.
- v1.79 (2026-11-15, COO 07:20Z 15 Nov, talk.finish plan (a) + (c) in docs/ops/AI-COST.md; no migration, additive; STAGING ONLY until QA): `POST /talk/finish` has its own model cap of 25 s, one attempt (`TALK_FINISH_TIMEOUT_MS`), separate from the 12 s Talk-turn cap; a finish call that already took over 10 s skips the label-rename repair (a card whose label is still not a name is dropped, as when a repair fails). The first finish that fails (timeout, unreadable or cut-off reply) since the person last talked no longer marks the conversation finished with the work lost: the ratings are saved, the conversation stays `active` or `paused`, and the reply is `200` with `still_working: true`, `summary: null`, a `ref`, and the conversation as it was. The same request again is the one server retry (ratings already saved are not rewritten, so their undo state is kept); if that fails too, the conversation ends with `summary: null` and a `ref` as before (no `still_working`). A ledger refusal is unchanged (`saved: true`, no retry). Phones that do not know `still_working` see a 200 with no summary, which is what they already handled. Tests `next/tests/talk_finish_timeout_test.ts` (slow fake client: finish at 13 s and 30 s, turns capped at 12 s).
- v1.78 (2026-11-15, PSY 15 Nov point 4 on Q-ENG-KMV2-LINES, "a membership never changes silently"; migration 0065 `kenning_map_said`; no shape change; STAGING ONLY with v1.75): on `GET /kennings/map` the engine's second line (`source: "said"`) is stored the first time the map shows it (`beliefs.map_said` = the line and a short hash of the wording, never a copy of the words) and is kept on every later GET while a receipt of that kenning still names it and the wording is unchanged, even when newer receipts name another area more often. It goes only when its receipts are deleted, the wording is edited (whitespace alone is not an edit), or the person picks the lines (`PATCH /kennings/:id/map` `lines` also clears it). Then it is chosen afresh by the v1.77 rule. A kenning with no second line can gain one from a new receipt (that adds a line; it changes none). A harsh statement about the self still gets none. The write is best effort: if it fails the reply is unchanged and the next GET stores it. This closes the v1.77 "not yet". Rollback: `alter table public.beliefs drop column if exists map_said;` and restore the previous api (the v1.77 code does not read the column). Tests `next/tests/kenning_map_v2_test.ts`.
- v1.77 (2026-11-15, COO 02:20Z 15 Nov, app2 'Receipt quotes on the kenning map response', CPO KM2-W1, law 2; and PSY 15 Nov on Q-ENG-KMV2-LINES; no migration; additive in shape, STAGING ONLY with v1.75): `GET /kennings/map` also returns top-level `receipts: [{ id, quote, said_at }]`: exactly the receipts that some `stations[].memberships[].receipt_ids` cites, so the station sheet shows the person's own words and the month for each. `quote` is the stored quote of the person's own words (the receipts table holds only what the person said; Mirror input never sits there), `said_at` ISO 8601 UTC; sorted by `said_at`, then `id`. A receipt of a kenning that is hidden, set aside or off the map is never sent; in a `seen_by` view only receipts of stations shown at full strength (`show_label: true`) are sent. No AI call. Memberships under PSY's ruling (replacing the v1.75 word list): at most TWO lines, the home line plus one. Words in the person's receipts add a second line ONLY for family, relationships, work and money; morality, meaning, politics, body and me come only from the kenning's own area (its home line), never from a word. "partner" counts only as "my partner" ("friends" counts). One receipt is enough; whole words; the receipt must be that kenning's. When more than one area qualifies, the one named in more receipts wins; a tie goes to the more recent receipt. A harsh statement about the self (PSY 6(d)) never gets a second line from the engine; the person's own line choice (`source: "you"`) still stands. Not yet built: PSY's "a membership never changes silently" (it stays until its receipt is deleted, the wording edited, or the person takes the line off): today the second line is recomputed on every GET, so a new receipt on the same kenning can change it (Q-ENG-KMV2-STICKY). Tests `next/tests/kenning_map_v2_test.ts`.
- v1.76 (2026-11-15, CPO keyword rules KM2-W4 and PSY's two-line limit, relayed by the COO 01:20Z 15 Nov; no migration; additive in shape, STAGING ONLY with v1.75): on `GET /kennings/map`, `stations[].keyword` MAY NOW BE NULL: the station shows its line's dot with no label and its sheet opens as usual (CPO: "never a made-up word"). `keyword_source` gains `"none"` for that case. A keyword is title case ("Rest") and is never a trait or label about the person, a judgement, a feeling, another person's name, one of core, root, origin, deep, conflict, contradiction, tension, torn, pulled, crossroads, score, complete (plurals too), a card-banned or clinical word, or the name of any of the station's own lines ("Work" never sits on the work line). The server checks every station at map time, so a word stored under older rules is replaced by the label's or wording's own word, or by null. `memberships` is now at most 2 (home line first, then the line the person's own words name most) until PSY answers Q-ENG-KMV2-LINES. Talk's turn prompt and the backfill prompt carry the same rules. Tests `next/tests/kenning_map_v2_test.ts`.
- v1.75 (2026-11-15, HQ d-all-kenning-map-v2-14nov, Nami 15:38 PT 14 Nov: a real subway map, one word per station, interchanges, folding, pan; the phone lays it out; migration 0064 `kenning_map_v2`; additive; STAGING ONLY until the map pre-approval with QA PASS): `GET /kennings/map` also returns `map_version: 2` and `lines: [topic]` (every topic any station belongs to, in the fixed line order family, relationships, work, money, meaning, body, politics, morality, me). Each `stations[]` entry also carries: `keyword` (one plain word, first letter upper case, at most 18 letters; never null for a kenning with a label), `keyword_source` (`"made"`: given by Talk when the kenning was made, or by the one-time backfill; `"label"`: the label's own longest content word, until the backfill reaches it), `memberships: [{ line, receipt_ids, source }]` (home line first; at most 3; `source` `"you"`: the person chose the lines (PATCH `lines`), which stand alone; `"home"`: the kenning's area from extraction, `receipt_ids` the receipts whose words name that area, else every receipt it was read from; `"said"`: another area the person's OWN words name, `receipt_ids` exactly the receipts that name it. Body is only ever a line for a kenning whose own domain is body. No quote is sent: ids only) and `group_id` (fold group: `"g:<id>"` for kennings that share a keyword or that extraction linked as one resting on another; `"k:<home line>:<kind>"` for a kenning alone; tension links never fold two kennings together; same rows, same ids). Nothing is computed by a model at map time. The v1 fields (`layout`, `lines` per station, etc.) are unchanged; the phone's layout engine reads `lines` + `stations[].{belief_id, keyword, memberships, group_id}`. Talk's turn reply now carries `keyword` per belief (engine-internal; stored once in `beliefs.map_keyword`, never rewritten). Backfill: `next/scripts/backfill_kenning_keywords.ts` (dry run by default; `--apply --cap-cents N`; Haiku 5.5 reads the label and wording only, never a receipt). PSY's ruling on which words name an area (Sunday) changes only `next/api/lib/kenning_v2.ts`. Rollback: `alter table public.beliefs drop column if exists map_keyword;` and restore the previous api. Tests `next/tests/kenning_map_v2_test.ts`, `backfill_kenning_keywords_test.ts`.
- v1.74 (2026-11-14, d-ceo-cdo-coo-google-signin-14nov, CPO-S-1; migration 0063 `google_signin`; additive; STAGING ONLY, nothing deployed yet; Google Cloud setup is Q-ENG-GOOGLE-1): `POST /auth/google` (no bearer), the Google twin of `POST /auth/apple`. Body `{ id_token, nonce, adult_confirmed: true, server_auth_code? }`; `400 invalid` with `field` for a missing or oversized `id_token` / `nonce`, `adult_confirmed` not `true`, or a non-string `server_auth_code`. Supabase Auth checks the token (audience = the iOS client id, nonce). We keep only the email: Google's name and photo claims are removed from the Auth user and its Google identity right after every sign-in (`scrub_google_profile`), and if that fails the sign-in fails (`500 internal`), never kept. The session is then reissued (a refresh), so the access token the phone keeps is minted from the scrubbed metadata; a failed reissue is `500 internal` too. No `name` is read from the body; a new account is named "You" until the person names themselves. An email Google has not verified, or none, is `401 unauthorized`. One person one account: a verified Google email that already has an account (Auth links the identity) signs in to it, `created: false`, its name, settings and `auth_provider` unchanged. A deleted account is `401`. Reply: the same shape as `/auth/apple` (`access_token`, `refresh_token`, `expires_at`, `created`, `me`). The server code, when sent, is exchanged for a Google refresh token, stored encrypted in `profiles.google_refresh_token_enc` (a failed exchange never fails the sign-in). `DELETE /account` revokes it at Google and clears the column before the deletion (a failed revoke is logged, never blocking). Rollback: in the migration header; restore the previous api. Tests `next/tests/google_auth_test.ts`.
- v1.73 (2026-11-14, app Q-APP-B299-1 ask (a), COO 15:20Z; no migration; behind `PRESENCE_CHECK_IN`; additive; STAGING ONLY until Nami's named yes): `PATCH /checkin/notes/:id` also accepts `{ "text": "…" }` (not together with `state`): the writer rewords their own note. Reply `{ state: "ok"|"risk"|"declined", note: Note|null, line, resources }`, the POST shape. The text goes through the same law 8 screen as `POST /checkin/:person_id/notes` (keyword floor, then the model read); `risk` or `declined` changes nothing (text, `updated_at` and state stay as they were; `note: null`; resources to the writer only). `origin`, `origin_ref`, `state` and `created_at` are kept; `updated_at` moves. `400 invalid` `field: text` (empty, blank, not a string, over 4000 characters) or `field: state` (both sent); `404 not_found` `where: "note"` for anyone but the writer; `409 conflict` `reason: "bridged"` for a parked bridge's note (its words are the bridge's). The other person is told nothing. Tests `next/tests/checkin_api_test.ts`.
- v1.72 (2026-11-14, app Q-APP-KM-2(2), CPO KM-W3; migration 0062 `kenning_because`; additive; STAGING ONLY until Nami's yes): `GET /kennings/map` also returns `ask_comes_from: [{a, b}]`, one entry per heard pair "for me, `a` comes from `b`" (ids only, no words) where both ends are on the map, the person has not said 'Not now', and no `comes_from` link already joins them. It is always `[]` in a `seen_by` view. `PATCH /kennings/:id/map` accepts `comes_from_declined: "<other belief id>"` (this kenning comes from that one): stored on the pair, so the ask never returns; `400 invalid` for a non-string or the kenning itself, `404 not_found` (`where: "ask"`) for a pair that was never heard. Drawing the link (`PUT /kennings/links` kind `comes_from`) answers the ask too. The table `kenning_because` is read-only for the API; pairs are written by the extractor when a told episode says "X because Y" (NOT yet wired: until then the list is empty on every account). Rollback: `drop table public.kenning_because;` and restore the previous api. Tests `next/tests/kenning_map_test.ts`.
- v1.71 (2026-11-14, Q-ENG-FEEDBACK-400; migration 0061 `feedback_screenshot_optional`; relaxing; STAGING ONLY until Nami's yes): `POST /feedback` accepts a report without a screenshot: `screenshot_base64` missing, null or empty stores the row with `screenshot_path` null and no storage object. A present value is checked as before (JPEG, at most 2 MB, else `400 invalid` field `screenshot_base64`). `pull_feedback.py` writes the report json and no `.jpg` for a null path (no `screenshot_missing`). Rollback: pull then delete null-path rows, `alter table public.feedback alter column screenshot_path set not null;`, restore the previous api.
- v1.70 (2026-11-13, QA-B240 + QA-B298 (b); migration 0059 `draft_saved_insight`; additive; STAGING ONLY until Nami's yes): `POST /bridge/insight` returns the draft's saved reply when the draft is unchanged. The reply is saved on the draft's own row (`drafts.insight`, `insight_key`, `insight_at`) after a finished `state: "insight"` reply, only if the row still holds that exact text (the call never creates a draft, DV-16); a safety stop, `declined`, `unavailable` or `could_not_bridge` is never saved. The key is a hash of text, relationship, `with_wording` and the sender's belief ids, status and wording, so a changed draft, a changed map or the other mode recomputes. A served-from-save reply is the same shape plus `saved: true`, and echoes the caller's `seq`. New optional body field `refresh: true` (boolean, else `400 invalid` field `refresh`) always recomputes with today's map. Editing a draft's text clears its saved insight (trigger); deleting the draft, sending, or deleting the account removes it. Separately, the model-call trace is written after the reply (no contract change). Probe `next/scripts/probe_saved_insight.py`; tests `next/tests/bridge_saved_insight_test.ts`, `bridge_trace_after_reply_test.ts`.
- v1.69 (2026-11-12, CPO 12 Nov 22:40Z ruling (1), docs/design/app-v3/CPO-NOW-V165-Q27A-12nov.md; COO 23:20Z; no migration; additive; STAGING ONLY until Nami's yes, joins the Q-ENG-V166 deploy): the send replies `POST /bridges` and `PATCH /bridges/:id` carry `held_by_window` (boolean) beside `parked_on_check_in`; `bridge.deliver_at` (ISO, already there) is the time the message reaches the receiver and `bridge.delivered` says whether it has. `held_by_window` is `true` only when the receiver's own delivery window moved the time the sender chose. **The engine has no receiver delivery window**: `deliver_at: "now"` is stored as the server's now (`delivered: true` in the same reply), and a later time is the sender's own pick, so `held_by_window` is `false` on every reply today. App: show CPO (1)'s 'Scheduled · <when> · Jan's chosen time' row and status line only when `held_by_window` is `true` and `deliver_at` is in the future; a sender-chosen later time (`held_by_window: false`) keeps its usual scheduled row; absent field (hosted v71) = interim (c).
- v1.68 (2026-11-12, CPO 12 Nov 22:40Z ruling (2), docs/design/app-v3/CPO-NOW-V165-Q27A-12nov.md; COO 23:20Z; no migration; a guard on v1.65, no new field; STAGING ONLY until Nami's yes, joins the Q-ENG-V166 deploy): `PATCH /checkin/notes/:id {state: "talked"}` closes a parked bridge's card only when the writer BROUGHT that note into the open (unexpired) check-in session between the two people (a `checkin_session_items` row for this note, this writer and that session). Then the card closes as v1.65 says, always tagged `closed_in_check_in: true`. A kept note the writer did not bring (no session, an expired session, a session where only the other person brought something, or a note brought elsewhere) stays writer-only (board 28 bring rule): the note is marked on the writer's own list and nothing changes on the receiver's side: no card state, mark, count or trace. The reply is unchanged (`{ note }`).
- v1.67 (2026-11-12, V3 P9 close on both phones; Q-ENG-THEIRS-STATE, app3 Q27(b); COO 21:20Z; no migration; additive; STAGING ONLY until Nami's yes, joins the next hosted ask): every `brought[]` item in the shared check-in session (`mine` and `theirs`) gains `state`: `parked` (brought, not marked yet), `talked` (its writer marked Talked about it) or `later` (its writer marked Next week after bringing it). It is the writer's own mark on their own note (`PATCH /checkin/notes/:id`), copied as is: no words beyond the text already shown, no time, no id on `theirs`, nothing stored. A brought note is already `later` from "Still matters?", so `later` here is read from the note being marked after it was brought; taking a note back and bringing it again starts at `parked`. Fixture `fixtures/checkin_session.json` updated. Tests `next/tests/checkin_session_test.ts`.
- v1.66 (2026-11-12, V3 kenning voice and own kennings; CPO 20:45Z ruling (1) option A, docs/design/app-v3/CPO-KENNING-VOICE-F3b-F4b-12nov.md; COO 21:20Z Q-ENG-KENNING-VOICE + Q-ENG-OWN-KENNING; app Q-APP-V3-19; migration 0057 `kenning_own_wording`; additive; STAGING ONLY until Nami's yes): two optional fields on every Card and Belief, a field on PATCH, one route. **(1) `own_wording`** (string or null): the kenning in the person's own first-person voice, set only by the person, never by the engine: the exact offered text they confirmed on the Y5 card, an owner edit (Y2/H2 'Edit the words'), or a line they typed (`POST /beliefs`). It is the only first-person line the app may show as theirs (law 3). `statement` is unchanged: the engine's gentle second-person sentence, still what review cards and Talk's reflection use (law 5); nothing in v1.66 rewrites it. **(2) `offered_wording`** (string or null, non-null only while `status` is `guess`): Talk's first-person offer for the same belief, returned in the same `POST /talk/turn` call (no extra model call) and through the statement's own checks (no banned or harsh words, not the quote) plus a first-person check; an offer that fails is dropped (null), never repaired. Show it only on the Y5 'Is this you?' card. **Confirming:** 'That's me' on a card that showed `offered_wording` sends `PATCH /beliefs/:id {"rating": "very", "own_wording": "<that exact text>"}`; a confirmation that showed `statement` (a review card, an old build) sends the rating alone and `own_wording` stays null. An offer the person never confirmed is never on a kenning (`GET /kennings` groups) or a share. **(3) `PATCH /beliefs/:id {"own_wording": "…"}`** (1 to 400 characters, whitespace folded; `null` clears; empty or longer is `400 invalid` `field: "own_wording"`) is 'Edit the words'; it never touches `statement`. A V2.5 `PATCH {statement}` edit still writes `statement` only. **(4) `GET /kennings`** items gain `own_wording`, `offered_wording` (suggestions only; null on groups) and `source`; `wording` stays the statement. **(5) Sharing:** `GET /links/:person/share` items' `wording` is `own_wording` when set, else `statement` (items gain `own_wording`); `PUT …/share/items/:belief_id` without `wording` uses the same default. Display order on You, Y2, Y3/X1 and share previews is the app's (CPO (1d)): `own_wording`, else `statement` when it is first person or neither, else the label (statement on the detail sheet only). **(6) `POST /beliefs {"statement": "…", "relationship": "partner|friend|family|coworker"}`** (F4b, own kenning): see §5. `source` gains `own`. Backfill of existing first-person kennings (copy `statement` to `own_wording`, CPO (1f)) is a separate script, not this migration. Tests `next/tests/kenning_voice_test.ts`.
- v1.65 (2026-11-12, app Q-APP-V3-22, the writer for v1.63's 'At the check-in' tag; no migration; additive; STAGING ONLY until Nami's yes, joins the v1.63-v1.64 ask): `PATCH /checkin/notes/:id {state: "talked"}` on a parked bridge's note (origin `bridged`, `origin_ref` = the bridge) also closes that bridge's card as `talked`, set by the writer, with `closed_in_check_in` true when the two have an accepted check-in or an open session, exactly as `PATCH /cards/:bridge_id {state: "talked", at_check_in: true}` would. The reply is unchanged (`{ note }`). Quiet on anything else: a card already closed keeps its first close; `later` never touches the card; a bridge that is not this writer's with this partner, withdrawn, deleted on the writer's side, still sealed for a receiving writer, or a link that is not active leaves the card alone and the note is still marked. The receiver sees the card move to Talked about, as with any card close.
- v1.64 (2026-11-12, V3 P8 alternating turns; app3 Q24, after the CPO's 12 Nov ruling (3) and COO 19:25Z P8 turn order; migration 0056 `checkin_done_bringing`; additive; STAGING ONLY until Nami's yes, joins the v1.63 ask): one route and one optional field. `PUT /checkin/session/:id/done_bringing` (no body) is the text-free "Nothing else" mark in the items step: nothing typed, no safety read, no model call, stored only on the person's own part row, so ending or expiring the session deletes it. Before both appreciations are in it is `409 conflict` `appreciation_first`; again after it is idempotent. `Session.mine.done_bringing` and `Session.theirs.done_bringing` (bool) are true once that person chose "Nothing else" OR has two brought, so both phones can tell "still choosing" from "brings nothing more" and move to the next turn on the same fact. `theirs.done_bringing` is false until phase `items` and never says what they could still bring (no count, no eligible list). After "Nothing else", bringing a new note is `409 conflict` `reason: "done_bringing"` and `mine.can_bring_more` is false; taking a brought note back still works (law 10) and the mark stays. Without the mark, taking one of two back makes `done_bringing` false again (they may bring another). The server does not enforce item turn order; the app alternates from `first` using these facts. Tests `next/tests/checkin_session_test.ts`.
- v1.63 (2026-11-12, V3 P8 check-in session and Talked about; CPO 18:45Z rulings (2) and (3), app3 Q20/Q22, app Q-APP-V3-17; COO 19:25Z; migration 0055 `checkin_said_first_card_closed`; additive; STAGING ONLY until Nami's yes): three optional fields and one route. **(1) Said aloud.** `PUT /checkin/session/:id/said` (no body) is the text-free 'said' mark for the appreciation step: nothing typed, no safety read (there are no words), no model call, stored only on the session's own row, so ending or expiring the session deletes it (no streak, no history, no count). It counts the same as a written appreciation: phase `items` starts once each person has either a mark or a written one (a person gives one or the other, never both: the second is `409 conflict` `already_given`). The first speaker marks first; the other person's mark before theirs is `409 conflict` `reason: "not_your_turn"`, so both phones agree on whose turn it is. The written `PUT …/appreciation` is unchanged (V2.5 builds keep it). `Session.mine.said` and `Session.theirs.said` (bool) say whether each mark is in, in every phase, with no words and no time. **(2) Turn order.** `Session.first` (user id): the person who accepted the check-in invite (`check_ins.person` / `check_in_dates.person` of the accepted check-in, never the inviter), fixed when the session opens, the same on both phones whoever opened it. With accepted check-ins both ways, the one accepted earliest decides (repeating before dated on a tie). The app shows 'Jan goes first.' / 'You go first.' and alternates from it. (`opened_by_me` stays; it is who tapped open, not the order.) **(3) Closed at the check-in.** `Card.closed_in_check_in` (bool, on every card; true only on `closed[]` items): set when `PATCH /cards/:bridge_id` marks it `talked` or `resolved` while a check-in session is open between the two people, or when the app sends `at_check_in: true` (marked from the check-in screen) and the two have an accepted check-in. Fixed at that write (no session id, nothing else about the session); reopening clears it. `at_check_in` that is not a boolean is `400 invalid` `field: "at_check_in"`. The card's `check_in_id` still means the check-in active now; use `closed_in_check_in` for the 'At the check-in' tag. Tests `next/tests/checkin_session_test.ts`, `next/tests/cards_test.ts`.
- v1.62 (2026-11-12, V3 H2 Add a person; app Q-APP-V3-7, COO 07:17Z Q-ENG-INVITE1; migration 0054 `invite_single_use`; STAGING ONLY until Nami's yes, with v1.60 and v1.61): an invite code links ONE person and new codes last 7 days. `POST /invites` returns `expires_at` 7 days ahead (codes made before 0054 keep their own date). Once someone has accepted a code, `GET /invites/:code` and `POST /invites/:code/accept` answer `404 not_found` for anyone else, the same as revoked or expired, and no link is made; the person who accepted it still gets `409 conflict` on a repeat accept (already linked), and the inviter still gets `400 invalid`. A code stays used after its joiner deletes their account. No reply shape changes. The app can show the server's `expires_at` and say the link works for one person. Tests `next/tests/invite_single_use_test.ts` (runs the migrations on PGlite).
- v1.61 (2026-11-12, V3 Write source rule; app Q-APP-V3-4, COO Q-APP-V3-3, PSY C1; no migration; additive field plus a narrower reply; staging first): every `highlights[]` entry on `POST /bridge/run` and the live `POST /bridge/insight` (`with_wording`) gains `about: "receiver" | "wording"`. `"receiver"`: the note describes the other person (a belief touch on their shared map only, `friction_kind: null`, why line "This may touch something they've shared with you."). `"wording"`: the note is about how the sender's own words may land (a friction kind) or about the sender's own belief; it needs no source. **Source rule:** a `"receiver"` note is in the reply only when one of its `from_them` entries carries the receiver's shared item (`item_id`, `quote`, `quote_label` set, v1.51); without it the note is dropped by the engine, so the phone never infers what to hide. The one quoted entry per reply goes to a receiver note first. A practice person read through the old area share has no items, so its receiver notes no longer appear. `summary` is unchanged (the receiver's side by label only). Fixture `fixtures/bridge_insight_shared_quote.json` (`reply_with_quote`: a receiver note with its quote plus a wording note; `reply_after_revoke`: the wording note only). Tests `next/tests/share_items_test.ts`, `bridge_touches_test.ts`, `shared_quote_fixture_test.ts`.
- v1.60 (2026-11-12, V3 Mirror ask, CDO boards Y6 and X2; COO 05:20Z Q-ENG-MIRROR-Q; migration 0053 `mirror_links.question`; additive; STAGING ONLY until Nami's yes): the owner's one question on their Mirror link (§ Mirror). `PATCH /mirror { "question": "When do I shut a conversation down?" }` stores it (whitespace folded, at most 140 characters; longer, or not a string, is `400 invalid` with `field: "question"` and nothing in that call is applied; `null` or blank clears it). It can be set while the link is off and does not turn it on. The law 8 keyword floor runs first and no model call is made: a question showing risk stores nothing (no other field in the same call either) and answers `200 { mirror, state: "safety", resources }` to the owner only. `Mirror` gains `question` (string or null) on `GET /mirror` and every reply that returns it; `GET /m/:slug` gains `question`, filled only while the page is open (`null` when off, paused or not found), and the HTML page leads with it ("<Name> asked you one thing"), escaped. `POST /mirror/rotate` clears it (a new link starts with no question); `DELETE /mirror` deletes it with the link. `GET /export` `mirror.link` gains `question`. The question is the owner's own words; the moment prompts, the convergence gate and laws 11 and 12 are unchanged (perspectives still arrive converged and unnamed; no named recipients in this slice). Tests `next/tests/mirror_question_test.ts`.
- v1.59 (2026-11-11, V3 You, CEO 15:20 PT; no migration; additive; staging first): `GET /kennings` (§ 5 Map, after `GET /map`): the owner's confirmed beliefs grouped by topic (area), dated, each with who can see it. Tests `next/tests/kennings_test.ts`.
- v1.58 (2026-11-11, V3 Home order, CEO 15:20 PT "V3 is the build now"; no migration; additive; staging first): `GET /home` (§ "Home order" under Threads). One read for the Home card stack, so the app does not compute it from `/threads`, `/checkin`, `/checkin/invites` and drafts. Numbers and kinds only: no bridge words, note text, draft text or preview, and no count of what the other side saved (laws 10, 12). Tests `next/tests/home_test.ts`.
- v1.55 (2026-11-11, V25 onboarding, app Q-V25-ON1 option b; additive, no migration) and the second half of v1.54: `GET /invites/:code` (§ "People and invites"; migration 0051 `peek_invite`; read-only, inviter name and initial plus `expires_at`, 404 when expired). `GET /people` rows gain `invite_code`: the code of the invite that made the link, present only for the inviter on links made from their own invites, `null` for the joiner, for links not made by an invite, and when the invite row is gone. No server-side pre-join grants (law 10).
- v1.54 (2026-11-11, V25 onboarding, app Q-V25-ON4; additive, no migration): `POST /talk/turn` with `text: ""` (or no `text`) and `source: "onboarding" | "invite"` returns only the opening question, from a fixed set of wordings: one recent moment, never why, never childhood. Optional `about: { name, relationship }` (`name` 1-40 chars, control characters cleaned; `relationship` `partner | friend | family | coworker | other`, optional) names the person in the question; a bad `about` answers `400 invalid` with `field` `about`, `about.name` or `about.relationship`. No model call (so no spend and no `daily_limit`), no listener call, no conversation row, no message row, nothing extracted; there are no person words to read, so the safety floor has nothing to act on, and any request that carries text takes the ordinary path with its floor unchanged. Reply: `{ conversation: null, message: null, opener: true, reply: Reply, latency_ms: 0 }` with `reply.state "turn"`, `reflection ""`, `question` the opener, `move {kind: "open"}`, `message_id null`, `turn 0`, `cards []`. The app starts the real conversation with the person's first words (`conversation_id: null`, `text` set). Non-streaming only (`?stream=1` is not needed). Fixture `fixtures/talk_opener.json`; tests `next/tests/talk_opener_test.ts`.
- v1.53 (2026-11-10, V25 board 28 shared check-in session; CPO d-coo-cpo-b2b3-10nov GO; migration 0050; behind `PRESENCE_CHECK_IN`; additive): two linked people with an accepted check-in (repeating or dated, either direction) open one short session. Routes (§ "Shared check-in session" below): `POST /checkin/:person/session` (open, or return the open one), `GET /checkin/:person/session`, `PUT /checkin/session/:id/appreciation`, `PUT /checkin/session/:id/items/:note_id`, `POST /checkin/session/:id/close`. CPO conditions: each person's saved things become visible to the other only inside the session, and only notes the writer kept through "Still matters?" (`PATCH /checkin/notes/:id` state `later`) and then chose to bring, at most two each (a parked note that was never kept is never offered; consent is the act of bringing, revocable until the session ends); the law 8 floor ran when each note was parked and runs again on every appreciation (keyword floor, then the same safety read as notes; a stop stores nothing and returns `state: risk` with resources to the writer only); one appreciation each first (phase `appreciations`; neither side reads the other's until both are in, then phase `items`); either person can end it, and ending (or expiry after 4 hours) DELETES the session, both appreciations and every reference: nothing about the session (counts, who brought what, what was skipped) is kept or shown afterwards. The only lasting marks are each person's own `PATCH /checkin/notes/:id` "We talked about it". Not a chat: no free replies, no read receipts, no push of any kind (both people are in the check-in together; the other side reads `GET`; app polls while the check-in screen is open). Never reads either person's map or beliefs. The other person's brought notes arrive as `{ text }` only: no note id, no date, no count of what they saved. Fixture `fixtures/checkin_session.json`; tests `next/tests/checkin_session_test.ts`.
- v1.57 (2026-11-11, V2.5 boards 10/11/11b and 18's reading row; app Q-ENG-READ1 shape CONFIRMED; migration 0052 link_prefs.help_read + help_read_at; STAGING ONLY until Nami's yes): `GET /links/:person/reading` -> `{person_id, help_read, confirmed_at?}` (my switch for that person, default false); `PUT /links/:person/reading {help_read: bool}` -> same shape (on, or 'Keep on', restarts the 30-day clock; off tells no one: no push, no event). `POST /bridges/:id/reading {}` (receiver of an opened message only; 404 not_found otherwise, 403 forbidden `not_opened`) -> `{available: true, meanings: [{meaning, item}]}` with 2 or 3 meanings (never 1, unranked, at least one ordinary or kind), each tied to ONE item the writer granted this reader (`item` = the writer's shareable wording, read live from share_items; a revoked grant is gone at once); or `{available: false}` for EVERY other case (switch off, nothing granted, unsupported message, model unsure or unusable output) so the reader cannot tell which; or `{available: false, flagged: true, resources}` when the safety screen (keyword floor first, before the switch; then the model) flags risk, a threat, an insult or a restriction on money, friends, phone or where someone goes: no reading, resources to the reader only (`resources` is the shared safety envelope `{message, resources: [{label, url}]}`, as on every other risk reply; fixture matches, app Q-APP-READ2). Errors for the app's 'Couldn't read' line: `unreachable`, `engine_failed`, `ai_off` (Bridge kill switch). Nothing is stored on either side: the trace keeps length and hash, never words. Haiku via the Bridge insight client. Fixture `fixtures/reading.json`; tests `next/tests/reading_test.ts` (8, mocked model, $0). Hosted waits for Nami's yes; readers stay off for friends until the 20 Nov licensed review.
- v1.56 (2026-11-11, V25 board 28 roll-over; CPO (A) answers-28-i1-24-25-11nov; no migration; behavior-only, behind `PRESENCE_CHECK_IN`): ending a session (`POST /checkin/session/:id/close`) and the 4-hour expiry delete the session, both appreciations, every brought reference, and only those brought notes their writer marked `talked` ('We talked about it'). A brought note still `later` ('Next week') and every note not brought stay as their writer's saved notes and roll over: they are eligible again in the next session (at most two brought each time; the rest wait). Nothing is deleted that its writer did not close. Response shapes unchanged. Tests `next/tests/checkin_session_test.ts` (roll-over on close and on expiry).
- v1.52 (2026-11-10, V25 board 18 "What I share", per-item sharing; CPO d-coo-cpo-v25-share-granularity-10nov; migration 0049; additive except the area-share gate below): the product rule is per item. Each person picks which single beliefs each linked person may draw on; nothing is shared by default; only a belief the owner confirmed (rated Very me or Partly, or edited; `status: confirmed`, never "Not me") can be offered. New routes (§ "Per-item sharing" under Link settings): `GET /links/:person/share`, `PUT /links/:person/share/items/:belief_id`, `GET /links/:person/share/preview`. `GET /people/:person/map` now returns the items they shared with me, each in the wording its owner approved for me, never a receipt (`quotes: false`, `receipts: []`, `items: true`); `GET /people` `shares_map` is true when they granted me at least one live item; `GET /data/export` gains `shared_items`. **Gate:** the v1.49 per-area share (`PATCH /links/:person` `share.on/areas/quotes`, `link_prefs.share_*`) is honoured on reads only when at least one side is a test, practice, example or preview account (owner testing); between two real accounts it reads as not shared and never reaches friends. Groups are not in this slice (a group would be a client fan-out of per-person items; see QUESTIONS). Law 10: a revoke deletes the row and takes effect on the next read (no cache; the grantee's read re-checks the belief live, so a set-aside, deleted or re-rated belief stops being shared at once); the other person is told nothing and gets no push. Deleting an account deletes every grant made or received. **v1.51 is now built on these grants:** `from_them[].item_id`, `quote` and `quote_label` are filled from the receiver's live grant to this sender (at most one entry per reply), for ANY receiver, real people included (CPO 10 Nov: receiver-aware wording is the default only when the receiver has shared something with the sender, and it cites only those items); nothing else of a real receiver's map is ever read, and a receiver who granted nothing (or revoked) leaves the sender's map only and the keys `null`; an entry read through the old area share is never quoted. Under per-item grants the `wording` of a `from_them` entry is the approved shared wording itself (the engine cannot read the private one). Fixture `fixtures/share_items.json`; tests `next/tests/share_items_test.ts`, `next/tests/share_items_rls_test.ts`.
- v1.51 (2026-11-10, V25 board 08 "From what Jan shared"; CPO ruling d-cpo-law10-quote-10nov; contract + fixture only, not built, no migration yet; additive): each `highlights[].from_them[]` entry (on `POST /bridge/run` and on `POST /bridge/insight` with `with_wording`) gains three keys: `item_id` (string or null), `quote` (string or null) and `quote_label` (string or null, the receiver's first name in "From what <Name> shared:"). Rules, from the CPO: the quote is ONE item the receiver chose to share with this sender, word for word, in the wording its owner approved for that person (the per-person share item of board 18; `PUT /links/:person/share/items/:belief_id`). It is never private card wording, a receipt, a Talk quote, a private note, Mirror input, or an unrated or inferred item. The server stores only the item id and renders `quote` from the live grant on every call, so a revoked or edited share shows no quote (`item_id`, `quote` and `quote_label` all `null`, the label-only `wording` stays as in v1.45) and nothing about the quote is cached or written to a trace (the trace keeps the item id). At most one quoted `from_them` entry per reply. With no live grant the three keys are `null` (law 10). The fixed line "It describes the message, not Jan." stays app copy. Safety: `risk` and `declined` replies carry no highlights (law 8). Fixture `fixtures/bridge_insight_shared_quote.json`; test `next/tests/shared_quote_fixture_test.ts`.
- v1.49 (2026-11-09, E41; no migration; behind `PRESENCE_CHECK_IN`; additive): on `GET /threads/:person` the SENDER's own bridge rows for a message parked on a check-in (`deliver_at: "next_checkin"`, its note still waiting) carry `parked_on_check_in: true` and `checkin_id` (the repeating check-in's id, or the dated one whose coming time is the bridge's `deliver_at`). Other rows carry neither field. The receiver's rows never carry them, nor any hint of a parked message (law 10; the receiver is told nothing before the check-in). Once the note is talked about or kept for later the flag is gone. When a repeating check-in MOVES (an accepted check-in gets a new day, time, zone or repeat; E40), every bridge parked on it that is not yet delivered or opened moves its `deliver_at` to the new coming time in the same call; the reply's `next_at` is the new time. Nothing is sent to the receiver. Dated check-ins have no move (a new date is a new check-in).
- v1.47 (2026-11-09, E37; migration 0043, not deployed; behind `PRESENCE_CHECK_IN`; additive): a "Just you" check-in has no other person. Chosen form: the person id `self`, so `PUT /checkin/self/schedule` (every v1.46 body: weekly, fortnightly, monthly, or `{on, time}`), `GET /checkin/self`, `DELETE /checkin/self/schedule`. It needs no link, is `status: "active"` at once, and never invites, parks, counts or notifies anyone: no reminder push, nothing on `/checkin/invites`, and `POST /checkin/self/notes`, `/accept`, `/decline` answer `400 invalid` field `person_id` reason `just_you`. `GET /checkin` returns it in `check_ins[]` (and its dates in `dated[]`) with `person_id: null` and `parked: 0`. At most one repeating Just you row per person and one per date. Apps that do not know it see a null `person_id` only on rows they created.
- v1.44 (2026-11-09, sre-08; migration 0041, not deployed; additive): Mirror contribution guards on hosted. `POST /m/:slug/contributions` takes `adult: true` (CONTRACT 11.1). With `PRESENCE_MIRROR_REQUIRE_ADULT=true` (on for hosted, off in preview) a missing or non-true `adult` answers `403 forbidden`, `reason: "adult_attestation"`, `version: "2027-01"`, nothing stored, no model call; when sent as true the row stores `adult_attested_at` and `attestation_version` (no identity). New error code `rate_limited` (429, `reason: "rate_limited"`): one contributor may leave 5 moments per link per 24 hours and one link takes 30 per hour; checked before anything is stored. The page shows its normal quiet "isn't taking more moments right now" line. Not built: the hosted page domain (the HTML still rewrites to text/plain on the shared domain; needs a custom domain, Nami's decision) and the Mac mini move itself.
- v1.43 (2026-11-09, DV-16 engine part; additive, no migration): live Bridge insight while typing. `POST /bridge/insight` accepts an optional `seq` (integer 0 to 2147483647; anything else is `400 invalid`, `field: "seq"`) and echoes it as `seq` on every reply (`null` when not sent), so the phone drops a reply that is not for the latest text. Debounce about 1.5 s after typing stops; cancel the request in flight when the text changes; the server cannot see a cancel, so a cancelled call still finishes and is booked (about 1¢). Texts under 12 characters make no call. The safety floor runs on every call before any model call (risk answers `state: "risk"`, threat or abuse `declined`; the app stops live insight for that draft). The draft is never stored: the insight trace row keeps model, tokens, cents and latency, and the draft and the reading become length + sha256 prefix (as Talk). The call counts against the person's daily allowance and the Bridge kill switch (`ai_off`). Fixture `fixtures/bridge_live_insight.json`; cost and plan in `docs/design/dv16-live-insight-plan.md`.
- v1.42 (2026-11-09, sre-07; migration 0040, not deployed): additive. One kill switch per AI feature (`talk`, `bridge`, `import`, `mirror`). A feature that is switched off answers `503 ai_off` with `scope` (the feature) and a plain `message`; no model call is made and no cost is booked. Talk: the person's words are saved (`saved: true`, `message_id` as on `daily_limit`), nothing is extracted. Bridge: the draft can still be sent as written (the app falls back to `used: "mine"`); no insight, no bridged version. The risk floor does not use the ledger and keeps working with every switch off (law 8). Apps that do not know `ai_off` treat it like any other 503. Every `usage_ledger` row also carries `release` (the deploy's git sha and date).
- v1.40 (2026-11-08, E34; migration 0037, not deployed): additive. `POST /diagnostics` (signed-in bearer), the phone's MetricKit crash and hang reports. See §7 "Diagnostics".
- v1.39 (2026-11-08, E33; migration 0036, not deployed; behind `PRESENCE_CHECK_IN`): additive. A check-in is an invite until the other person accepts: `status` ("invited" | "active") on schedules and home rows; `GET /checkin/invites`, `POST /checkin/:person_id/accept`, `POST /checkin/:person_id/decline`. `PATCH /bridges/:id` accepts `deliver_at: "next_checkin"` and parks the bridge on the check-in (`parked_notes`, `origin: "bridged"`); `POST /bridges` does the same; both reply `parked_on_check_in`. Reminders and "Next check-in" use accepted check-ins only. See §6A "Invite and parking".
- v1.38 (2026-11-08, E32, app v2 Bridge check-ins; migration 0035, not deployed; behind `PRESENCE_CHECK_IN`): additive. See §6A "Schedule" below: `PUT/DELETE /checkin/:person_id/schedule`, `GET /checkin` (home rows), `schedule`/`parked` on `GET /checkin/:person_id`, `origin`/`origin_ref` on Park it, `deliver_at: "next_checkin"` on `POST /bridges`, and the `checkin_reminder` push kind with `POST /internal/checkin/remind`.
- v1.37 (2026-11-06, E25, CEO priority "Bridge is the most important thing"): new §6A Check-in, additive, server
  switch `PRESENCE_CHECK_IN` default off. `POST /checkin/:person_id/notes` (Park it), `GET /checkin/:person_id`
  (the week's list), `PATCH /checkin/notes/:id` (done and reschedule). Writer-only; no partner read, no slot, no
  session queue (later item). The safety read is the keyword floor, then (when that clears) the same model-based
  `analyse()` Bridge's own insight route uses; `engine/checkin/park.ts`'s `decidePark` (TQ3) turns that reading
  into `parked` / `risk` / `declined`.
- v1.36 (2026-11-06, E23, CPO d-cpo-bridge-insight-spec-06nov for the "Send mine, with insight" cards): behavior-only tightening of `POST /bridge/insight`, same reply shape.
  - **No receiver field, named or not.** The body must carry only `person_id` and `text`; any other key (a receiver id, a receiver belief, `relationshipType`, anything else) answers `400 invalid`, `field: "<the unknown key>"`, before any lookup or model call. The route still derives `relationship` itself from the sender's own `link_prefs` row, never from the caller.
  - **`points` is capped at 3**, in the model's own order ("Presence hears:" up to three short lines, Card A).
  - **`touches` is capped at 2** and now also requires `confidence >= 0.7` on top of the existing confirmed-only (`endorsed`) filter, so Card C ("This seems to touch…") never names a belief below the screen threshold (law 9) or an unconfirmed one (law 3).
- v1.35 (2026-11-06, release-switch follow-up): behavior-only; closes the gap v1.34 documented but
  hadn't yet wired into code. `GET /preview/spend` and `POST /preview/mirror-sample` now also answer
  `404 not_found` under `PRESENCE_RELEASE=true`, checked before the bearer token so an unauthenticated
  caller on a release build gets `404`, not `401`. Both routes already carried their own `isPreview`/owner
  check unchanged; only the release-build short-circuit moved earlier.
- v1.34 (2026-11-06, P0 preview/login lockdown): breaking change to `POST /preview/login` only; every other route unchanged.
  - **`persona: "nami"` is gone.** It answers `403 forbidden`, `reason: "preview_login_restricted"`, unconditionally, hosted or Mac. His account carries his own real talks, not a cast.
  - **Hosted requires a device secret.** On the hosted runtime only (never the Mac dev server), the request must carry `X-Presence-Preview-Secret` matching the hosted project's own `PRESENCE_PREVIEW_DEVICE_SECRET` secret, or the reply is `401 unauthorized`, `reason: "preview_secret_required"` — with no secret configured at all, every hosted call to this route refuses. The app bundle never carries this value.
  - **A release build never reaches it.** `PRESENCE_RELEASE=true` makes this route `404 not_found`, same as the other preview-only routes documented below.
- v1.33 (2026-11-05, E17 Import first round): behavior-only change to round sizing, same shapes; server switch still off.
  - **The first review round covers more areas.** `GET /imports/ai/round`'s first round (before any import guess for the person has been rated) returns 5 to 7 items, not three: the top-ranked item from each distinct area first, at most two per area, at least one me-lens and one others-lens item when available, then filled by rank. Every later round still returns at most three items, now preferring areas with no confirmed belief.
- v1.32 (2026-11-04, revised E13 hosted owner Import): additive import fields and behavior; owner-only switch on.
  - **Hosted access remains an account allowlist, not a build or persona check.** Every Import route is available on the hosted API only when `PRESENCE_IMPORT_FROM_AI` is on and the authenticated account id equals the single configured owner id. Partner, example, and every other real account receive `403 forbidden`, `reason: "owner_only"`.
  - **Source metadata is canonical.** `POST /imports/ai` requires `source: "chatgpt|claude|gemini|other"` and `imported_at` as an ISO-8601 timestamp. Raw answer text is processed on arrival and is never persisted; only the canonical source, import time, de-identified structured moments, and guarded guesses remain.
  - **Answers combine across assistants, earlier imports, and Talk.** Identical readings share one review item. Two or more distinct AI sources add `agreement: { "sources": n, "line": "n of your AIs noticed this" }` and raise only Presence-owned confidence; repeat imports from one source count once. Different readings for one merge key remain a `disagreement` choice card (`first|second|both|neither`). An already confirmed Talk belief wins over matching AI wording and evidence.
  - **Only thin answers make no cards.** A refusal/no-access/no-memory answer, `KNOWS ME: a little` with no completed interview evidence, or no grounded guess after whole-answer extraction returns `{ "state": "thin", "import_id": null, "created_at": null, "guesses": [] }` and saves no import rows. Markdown, reordered or missing labels, prompt-v2 `WITH PEOPLE`, `MORE TO COME` pasted parts, and completed interview-style answers are accepted with no item cap.
  - **Keep going is unbounded.** Rounds continue until no waiting guesses remain. Within each round, ordering is depth, evidence, area spread (at most two items from one area), then distinct-source agreement; there is no lifetime round/import cap.
- v1.31 (2026-11-04, E12 Import finish): additive import fields and route; server switch still off.
  - **The private finish question is stored once.** `POST /imports/ai/:id/feel` accepts only `{ "answer": "yes|partly|not_really|skipped" }`. It stores the answer on that caller's import, returns `{ "saved": true }`, and a second answer returns `409 conflict`, `reason: "already_answered"`. The answer is private to the importer and is not included in another person's response or any shared map, belief, receipt, Mirror, or Bridge surface.
  - **A round says only whether its Import score may appear.** Import round replies carry `score_eligible`. It becomes `true` after at least three guesses that passed Presence's generic-card check have been rated Very me, Partly, or Not me. Not sure and Skip do not count.
  - **Thin material is not retained.** A cloud import whose `KNOWS ME` answer is `a little` and contains no completed interview evidence, or whose whole-answer listener leaves no grounded guess after the generic-card check, returns thin and persists no import, moment, or guess rows.
- v1.30 (2026-11-04, E9 person-wide Import rating): additive import fields and route; server switch still off.
  - **Every round guess names its owning import.** Each `GET /imports/ai/round` item has an `item_id`, and each source entry carries the corresponding `guess_id` and `import_id` beside its assistant and date.
  - **One person-wide transaction rates a whole round.** `POST /imports/ai/round/answers` accepts ordinary or merged guess ratings plus disagreement resolutions across any of the caller's imports. The server validates ownership of every referenced waiting guess before changing anything; one missing or foreign guess makes the whole request `404 not_found` with no writes. `not_sure` retires a guess, while `skip` leaves it waiting. A disagreement resolution rates both readings together: `first` or `second` keeps that reading and rates the other Not me, `both` keeps both and links the two beliefs as pulling against each other, and `neither` rates both Not me. The existing per-import `POST /imports/ai/:id/answers` is unchanged.
- v1.30 (2026-11-04, E8 Import wiring): additive import routes, server switch still off.
  - **On-device imports cross the API only as guarded structured guesses.** `POST /imports/local` accepts source metadata, `knows_me`, and rated guesses; it rejects raw answer text and AI note text. Imported beliefs carry only the receipt line `From your AI · <date>`, `source: "import"`, and no Talk receipt rows.
  - **Import review is person-wide.** `GET /imports/ai/round` returns at most three ordinary, merged, or disagreement items across every import, with `has_waiting` as a boolean. It replaces the per-import `/:id/round` GET, which is folded into this route and is no longer public. (Superseded by v1.33: the first round returns 5-7.)
  - **Clear the rest is person-wide.** `POST /imports/ai/clear-rest` retires every waiting guess for the caller across all imports.
- v1.29 (2026-11-04, E7 from the tq-19 error-shape audit): streaming Talk error behavior only.
- v1.28 (2026-11-04, E7 from the tq-19 error-shape audit): streaming Talk error behavior only.
  - **A Talk stream keeps the real §0 error after `accepted`.** The `error` SSE event carries the same code, message and public extras as the non-stream route, and its Ref points to an `errors` row with that same code. In particular, `daily_limit` keeps `opens_at`, `scope`, `saved` and `message_id`; unexpected failures are `internal` rather than `unreachable`.
- v1.28 (2026-11-03, contract proposal, docs only, tq-11 from the tq-07 drift audit): describes what the code already does; no code or behaviour change. Awaiting review before it counts as contract.
  - **The streaming Talk `error` event is documented** (§4 streaming), exactly as `next/api/talk.ts:413-422` emits it, with the mismatch between the `errors` row code (`internal`) and the event's `error` (`unreachable`) noted.
  - **`GET /health` is documented** (§0), as implemented at `next/api/index.ts:291`.
  - **`POST /internal/push/drain`'s refusal is described exactly** (§12.5): body `{ "error": "not_found" }` only, no `ref`, no `errors` row (`next/api/push.ts:279-282`).
- v1.27 (2026-11-01, prototype item 2, tests only; not deployed): additive, behind the server switch `PRESENCE_PARTNER_ENTITLEMENTS=true` (default off).
  - **One Presence subscription covers one mutually linked partner.** This is a Presence server entitlement, not App Store Family Sharing. After an App Store Server Notification v2 payload and its nested transaction JWS are signature-verified, `appAccountToken` identifies the paying Presence account; only `inAppOwnershipType: PURCHASED` and the two Presence Plus product ids can create an entitlement. The raw signed payload is never stored. The production notification URL is reserved as `POST /app-store/notifications/v2`; this tests-only branch does not register or deploy that public route until its Apple root-certificate verifier is configured.
  - **`GET /me` adds `plan: { active, source: "own" | "partner", partner_name }`.** Own coverage wins. Partner coverage requires an active link and `relationship: "partner"` on both sides. Ending or blocking the link removes partner-derived coverage on the next read; the payer's own coverage is unchanged. The global provider-spend safety cap can still return `429 daily_limit`; there is no per-person talk, invite, or test-account cap to remove.
- v1.26 (2026-10-31, CDO craft pass v1 "Sounds", engine item 8): additive, push payload only.
  - **The Bridge-ready push names the `arrived.caf` sound.** §12.4's `bridge_ready` payload carries `aps.sound: "arrived.caf"` instead of `"default"`; `bridge_reminder` and `talk_reply_ready` are unchanged (`"default"`), so no other notification names a sound. New test in `push_test.ts`. The app ships the CAF; the engine only writes the filename.
- v1.25 (2026-10-31, CDO "Spheres behind the curtain", engine item 7): additive, live-voice-phase1 Talk SSE only.
  - **New `forming` SSE event on `POST /talk/turn?stream=1`.** One event per hypothesis kept after checks, carrying only `{ id, area, area_confidence, confidence, state, conviction?, existing_belief_id? }` — no label, statement or receipt, so no belief wording leaves the server ahead of the ordinary `reply.cards` (law 9). Drives the Talk spheres animation (app2 Build B) against the engine's real event instead of its fixture. See §4 streaming.
- v1.24 (2026-10-31, tester report intake): additive.
  - **New `POST /feedback` (§13).** A signed-in bearer or the shared tester token submits a JSON body plus a screenshot (≤2 MB JPEG) into the private `feedback` storage bucket and a row in the new `feedback` table (migration 0016), idempotent on the client's `report_id`. `next/scripts/pull_feedback.py` moves unpulled rows into `outputs/qa/inbox/<date>/` for verify to triage into `BUGS.md`.
- v1.23 (2026-10-31, Nami's hand-test pair): additive.
  - **`POST /preview/login` also accepts `persona: "kai"` and `persona: "noor"`.** Two normal people (not `is_example`), linked to each other only, as partners, each with an empty map. Nami uses them to hand-test Bridge without touching his own map or the example cast. They are never linked to `nami` or to any example person.
  - **`persona: "jantest"` and `persona: "namitest"`** (flagged `account_kind = test`, created by `scripts/seed_test_contact.py`): "Jan (test)" is partner of the real owner; "Nami (test)" is partner of Jan (test) only and never linked to the owner. Both hold no map; they exist for the two-way BRIDGE-E2E.
- v1.22 (2026-10-30, belief tone): additive.
  - **Every Card and Belief carries `tone`, a float from `-1` (heavy) through `0` (neutral) to `1` (light).** It is always `0` until the CPO confirms what sets it; clients may decode the full range now. This is separate from the categorical `birth_mood` and from Bridge's tone reading.
- v1.21 (2026-10-29, Sign in with Apple): additive.
  - **Real accounts exchange an Apple credential at `POST /auth/apple`.** The request carries Apple's identity token, the raw nonce whose hash Apple put in that token, the person's name when Apple supplies it, and the O02 18+ confirmation. Supabase Auth verifies Apple's signature, issuer, audience, expiry and nonce and creates or resolves the Auth identity; Presence never accepts a client-supplied Apple subject or email. The function then creates the missing real `profiles` row without overwriting an existing person's name or settings and returns the normal Supabase access/refresh session. The same Apple identity signs into the same Presence account. Tokens and nonces are never stored or logged.
  - **Real-account pairing uses the existing invite contract.** Two Apple accounts call `POST /invites` and `POST /invites/:code/accept` exactly as §6 describes; the invite RPC has no Example/preview restriction. `DELETE /account` remains available to real accounts, hard-deletes the Auth user, provider identity, sessions and push credentials, and retains only the anonymised “Deleted account” bridge tombstone. Preview personas and `/preview/login` are unchanged and remain test-build only.
- v1.20 (2026-10-29, QA-B16): behavior only; no reply shape changes.
  - **Clearing a Bridge thread now cuts received bridges by when they were created.** A sealed bridge scheduled before `DELETE /threads/:person` stays removed for that viewer; a bridge scheduled afterward appears immediately even when both have the same `deliver_at`. The sender's copy is unchanged. The hosted both-directions journey covers schedule → clear → schedule again.
- v1.19 (2026-10-29, live voice phase 1): additive, behind `PRESENCE_LIVE_VOICE_PHASE1=true`.
  - **Guarded Talk SSE.** `POST /talk/turn?stream=1` takes the exact v1.18 Talk body and returns `text/event-stream`. It stores the person's turn before `accepted`, asks the same Talk engine once (with the same one-repair path), and persists the same final `Conversation`, `Message`, `Reply`, beliefs, ledger rows and `engine_calls` rows as the JSON route. The ordinary `POST /talk/turn` response and execution path are unchanged.
  - The ordered events are `accepted`, zero or more sentence-complete `speech` events, then `reply`, then `done`. `safety` replaces every `speech` event for S07; `fallback` precedes `reply` when the safe thread-line was used. Raw provider deltas never leave the function. A reflection can be emitted early only after the deterministic risk floor and the model's leading safety decision both say no risk, and after its complete sentence independently passes the Talk wording, copy, grounding and no-question guards. The question, permission move and all cards wait for the complete ordinary Talk checks, including Never.
  - **Barge-in.** The client sends barge-in by cancelling/closing the SSE request. That aborts an in-flight provider request and any repair; no later SSE event is sent. The already stored person's turn remains, and the server persists the ordinary safe fallback if no complete reply existed. Once `done` has arrived, barge-in is local TTS cancellation and makes no server request.
- v1.18 (2026-10-28, QA-B6): additive.
  - **An unresolved Bridge ask has an action.** Every `POST /bridge/run` reply carries `next_step: "add_ask" | null`. It is `"add_ask"` only when `outcome: "nothing_to_change"` and `ask_unresolved: true`; the B05 note offers “Add what you'd like”, and the app reopens the original draft with the cursor at the end. Bridge never invents the ask. App2 owns that editor action.
- v1.17 (2026-10-28, QA-B3): behavior only; no reply shape changes.
  - **Talk retries once, then answers with the safe thread-line.** A provider timeout, network failure, unreadable reply or parser failure after the one retry is persisted as a normal `200` Talk reply with `"I lost my thread for a moment. Could you say a little more?"`, no cards, and a trace Ref; it never becomes `502 engine_failed` or `503 unreachable`. Each provider attempt is bounded to 12 seconds, so both attempts plus persistence fit inside the app's 30-second Talk contract. A ledger refusal remains `429 daily_limit`; database reachability errors remain `503 unreachable`.
- v1.16 (2026-10-28, APNs A4): ready and deployed.
  - **Real push is built for three existing events:** bridge ready, the receiver's reminder, and a Talk reply becoming ready. The app registers an APNs device token through `PUT /devices/apns`; registration metadata is returned but the token never is. Migration 0011 queues and deduplicates service-only events in the same database write as product state; migration 0012 and `configure_push_schedule.py` drain due rows once a minute through credentials held in Vault. The protected drain signs ES256 provider tokens with Team `UK39PYVJ96`, chooses the sandbox or production APNs host from device registration, and records only status metadata. Approved topics are `com.namidavoodzadeh.presence` and `com.namidavoodzadeh.presence.qa`. Every payload is content-free: fixed localization keys plus opaque routing ids only. Local notifications remain the offline fallback. Hosted function version 27. See §12.
- v1.15 (2026-10-28 06:55 Tehran, B-Q10): additive.
  - **Blocked perspectives can now be listed and unblocked without exposing a contributor.** `GET /mirror/blocked` → `{ "blocked": [{ "id": "<outside perspective id>", "label": "Keeps an exit" }] }`; the list is A–Z by the de-identified card label and carries no contributor name, key, moment or people/contribution count. `DELETE /mirror/blocked/:id` → `{ "unblocked": "<outside perspective id>" }`; `404 not_found` when the caller has no such block. Deleting removes every opaque contributor-key row behind that card without returning how many. Migration 0009 stores service-only rows and keeps them independent of a Mirror link, so rotate/delete cannot clear them. Hosted function version 21; 8821 reloaded. The broader §11 report/block proposal is still unbuilt.
- v1.14 (2026-10-28 04:15 Tehran, A-Q21 and A-Q22): wording and validation only; no reply shape changes. Hosted function version 20.
  - **Bridge preserves the force carried elsewhere in the rewrite.** For sarcasm or contempt, the critic judges the named feeling across the whole rewrite: a plain statement of dissatisfaction is the planned transformation, not an addition, and another kept sentence may carry the full intensity. Newly invented mock thanks or praise still fails. An `again` that was not in the sender's text is rejected before the critic. A `could_not_bridge` error row now records every critic reason, so its Ref explains the failed attempts rather than only missing points.
  - **Talk labels are complete names, never cut phrases (A-Q22).** Labels of one to four words still stand under A51 when they form a complete name. A label over four words, or one ending in a function word or a common finite verb (for example `Saying no makes`), gets one bounded request for a one-to-three-word name. If that request still does not produce a complete name, the card is dropped and the trace records the warning. Finish applies the same one-rename rule; the rest of the Finish reply is not regenerated.
- v1.13 (2026-10-28 01:20 Tehran, COO check-in 00:55: the QA pair, Nami's account, A-Q16, A-Q17): additive. Hosted function version 19.
  - **The receiver's `DELETE /bridges/:id` before its time answers `403 sealed` with `deliver_at` (A-Q16),** never a silent `200` that changes nothing; a bridge that is not yours (neither sent nor received) answers `404 not_found`. After delivery the receiver's copy goes as before. `check_bridge_journey.ts` covers both.
  - **`Change.start` and `Change.end` may be `null` (A-Q17).** They are `null` when the change's `to` text is not found in the bridged text, as with a whole-text `vague_ask` note whose `to` repeats the sender's own sentence; `original_start` and `original_end` are `null` the same way when `original` is not found in the sender's text (as v1.1 said). `original`, `to`, `kind` and `why` are always strings. Decode the four offsets as optional. `spans` on `/bridge/insight` and `wont_carry` always carry integers.
  - **The QA pair `sam` ↔ `jo` (item 10).** `POST /preview/login` also accepts `persona: "jo"`: Jo (Example), cast persona joan-humorous-retirement, linked to Sam only (friends, each sharing two areas), never to Nami. Both carry a cast map with receipts (12 beliefs) and two finished conversations (`Example: <name>` and `A short talk`, three turns with Presence's replies). The app lane's automated walks run as `sam` ↔ `jo`; `nami` ↔ `lea` are the owner's. `next/scripts/seed_preview.py --qa-pair` re-seeds the pair (Jo's rows and both short talks replaced, Sam's map kept); the full seed includes it.
  - **Nami's account (item 11).** `next/scripts/audit_account.py --persona nami --since <iso>` is the read-only audit (ids, timestamps, counts; never a word). Nami's map was never seeded (his map comes from his own talks: the seed gives him the profile, the five links and nothing else); since 16:59 Tehran 10-27 every row on his account carries a lane signature, and nothing phone-written was found (report in `next/reports/20261027T213222Z-nami-account-audit/`). The Nami ↔ Lea link is back as seeded: partner on both sides, Lea sharing relationships and work.
- v1.12 (2026-10-28 00:05 Tehran, COO check-in 23:30: Bridge both sides, item 9): additive.
  - **Read receipts are applied (Y03 "Show when I've opened", on by default; off on either side also hides theirs, as in WhatsApp).** The sender's `Bridge.opened_at` is `null` unless `read_receipts` is on for both the sender's and the receiver's link settings (`PATCH /links/:person { "read_receipts": false }` on either side hides it; a missing setting counts as on). With it hidden, the sender's thread row never reads `opened` for that bridge (`last.kind` stays `scheduled`, `activity_at` ignores the opening) and `GET /export` `bridges_sent` carries `opened_at: null` too. The receiver's own opened view keeps its `opened_at`; the plan (Let's talk) still shows on the sender's side, since the receiver proposed it. The refusals that follow an opening are unchanged: `PATCH /bridges/:id` and `POST /bridges/:id/withdraw` on an opened bridge still answer `403 too_late` whatever the setting (an opened bridge cannot be withdrawn; the app may offer Delete for me then). Before v1.12 the setting was stored and never applied.
  - **The thread row's `last` picks by state, not by a coming time.** Before v1.12 a scheduled or sealed bridge far in the future outranked a bridge that had just become ready or the words just opened, because the sort used its coming time. Now: your draft; else a ready bridge; else what is pending (scheduled, sealed, a planned talk: the soonest first); else the latest thing that happened. Shapes unchanged.
  - **The journey check.** `next/api/check_bridge_journey.ts [--hosted] [--personas nami,lea]` walks Bridge both ways at $0, by default between two throwaway accounts it links by invite and deletes (the preview accounts are in the app lane's hands at the same time: their Delete conversation cleared both Nami ↔ Lea threads under a running journey on 10-27, Q67), or between the preview accounts named: send mine, schedule, deliver at time (a bridge set six seconds ahead is sealed, then ready once its time passes), the receiver's sealed view (no text, tone, `used`, mark or length), open, the read receipt per setting, Talked about it from either side, withdraw (seen → withdrew, unseen → nothing, opened → too_late). Drafts are put back and everything it made is removed. Reports under `next/reports/<stamp>-bridge-journey[-hosted]/`.
- v1.11 (2026-10-27 22:05 Tehran, COO check-in 21:50): additive.
  - **§11 Proposed for launch (not built).** The CEO's launch requirements (`docs/LAUNCH-REQUIREMENTS.md`, 27 Oct 2026: Mirror ships at launch, adults only, full moderation) as a contract proposal for the engine's share: L2 contributor 18+ attestation stored, L3 `POST /report` and `POST /block`, L5 no Example data and no teaser in the release build, L6 the AI-provider consent record with a version and the model-call gate behind a flag that is off in preview. Nothing in §11 is built or deployed; no field in §0–§10 changes until each lands with its own Changed line. Bridge comes first.
  - **Length counterweight (D8), as the COO set it.** `POST /bridge/run` lets a rewrite grow to 1.8× for originals of 60 words or fewer and 1.25× above 60 words; the earlier 30-to-60-word band at 1.4× is gone (the critic's add-nothing judgement stays the guard; a rewrite within 5 words of the original passes whatever the ratio). No reply shape changes; a `could_not_bridge` on a long message still names `length_ratio` in its Ref detail. Bridge runs on Sonnet (decided); the Haiku arm is no longer tuned. Hosted function version 17; 8821 reloaded itself.
- v1.10 (2026-10-27 18:10 Tehran, Q63–Q65 answered by the COO 17:30): additive.
  - **`DELETE /map` is a soft delete with a 5-second undo (Q63, the design's Undo rule).** The reply now carries `undo_until` (ISO, 5 s ahead) beside the counts of what will go (`beliefs_removed`, `conversations_removed`, `outside_removed`); nothing is removed yet. New `POST /map/undo` → `{ "restored": true }` inside the window (the map is whole again), `{ "restored": false, "reason": "window_closed" | "nothing_pending" }` otherwise. While the window is open `GET /map` reads as empty and carries `deleting: { undo_until }` (`deleting: null` otherwise); a second `DELETE /map` inside the window keeps the first `undo_until`. The purge (beliefs with receipts and links, conversations with messages, outside cards, the Talk traces) runs on the first request the person makes after the window closes, whatever the route; anything added to the map inside those 5 seconds goes with it. Example accounts still answer `403 example_account`. Hosted function version 16; 8821 reloaded.
  - **The Mirror page is served from the Mac fallback in preview (Q64, confirmed).** The hosted gateway forces `text/plain` for HTML on its default domain, so the preview opens `http://<mac>:8821/m/<slug>`; real hosting is a later decision, nothing is published now (§9).
  - **The 38 observe trace rows written before v1.8 are scrubbed (Q65 → a).** Every `mirror_observe` row now carries the moment's length and hash, never the words (`next/reports/20261027T141500Z-mirror-trace-scrub/`); example-cast contributions only.
- v1.9 (2026-10-27 16:45 Tehran, the CDO's final S15b copy, 16:23): additive.
  - **S15b headline and counts.** Every reply that refuses a text for a threat or abuse (`POST /bridge/run` `outcome: "wont_carry"`, `POST /bridge/insight` `state: "declined"`, `POST`/`PATCH /bridges` `403 wont_carry`) now carries `counts: { "threat": n, "abuse": n }` beside `spans` (one count per flagged part, after merging), so the app picks the headline: one part, "One part reads as threatening." / "One part reads as abusive."; two parts of one kind, "Two parts read as threatening." / "Two parts read as abusive."; both kinds, "Parts of this read as threatening and abusive."; always followed by "Bridge won't reword or send it." The engine's `headline` field follows the same copy (three or more parts of one kind: "Parts of this read as threatening." / "...abusive."; `null` when no part could be located) and is the fallback when the app has no copy of its own. Underline only the flagged spans. Hosted function version 15; 8821 reloaded.
- v1.8 (2026-10-27 16:20 Tehran, Q62 taken as (b) at $0): trace only, no reply shape changes.
  - **The Mirror observe trace keeps no moment as written.** The `engine_calls` rows for `mirror_observe` and `mirror_observe_repair` store the package sent with the "THE MOMENT, AS WRITTEN" block replaced by `[deleted once processed: <n> characters, sha256 <16 hex>]`, so once a contribution is processed its raw text lives nowhere: not on the contribution row, not in the trace (thesis, Mirror protections). The owner's beliefs, the open themes and the model's de-identified reply stay in the row. Hosted function version 14; 8821 reloaded.
- v1.7 (2026-10-27, the CDO's build review 1, `docs/design/v1/BUILD-REVIEW-1-CDO-ANSWERS.md`; COO 15:45): additive, one line per item below as it lands.
  - **`wont_carry` with spans (S15b; CPO 16:00 10-27: only threats and abuse are refused, insults are bridged).** `POST /bridge/run` with `outcome: "wont_carry"` carries `spans: [{ start, end, kind: "threat" | "abuse" }]` (UTF-16 offsets into `text`, merged, in text order: the parts to underline in red dots) and `headline` (v1.9 copy: "One part reads as threatening." / "One part reads as abusive." / "Two parts read as threatening." / "Parts of this read as threatening and abusive."; `null` when no part could be located; the app's own copy wins) and `counts` (`{threat, abuse}`, v1.9). `POST /bridge/insight` with `state: "declined"` carries the same `spans` and `headline`, so the underlines stay while typing until those parts change. `POST /bridges` and `PATCH /bridges/:id` refusing a text answer `403 forbidden`, `reason: "wont_carry"`, with `spans`, `headline` and `safety: "threat" | "risk"`. Words that signal real risk to anyone still answer the safety outcome instead (`could_not_bridge`, `safety: "risk"`, resources: S07). An insult ("you're pathetic") is `contempt` or `character`: a friction the rewrite turns into the behaviour, never a refusal. Nothing is stored for the receiver; the words leave the phone only as the engine package in the trace.
  - **Talk it through (S15b → Talk; CPO 16:00).** `POST /talk/turn` on a new conversation accepts `source: "bridge_refused"`; `Conversation` carries `source` (`talk` | `bridge_refused`). Such a conversation is exempt from a per-person daily Talk limit (none exists yet: the only limit today is the spend cap, `429 daily_limit`, which still applies). Migration 0007.
  - **The receiver's time zone (Q7).** `Person` carries `tz` (an IANA name, `null` until known), so every `/people` and `/threads` row has the person's zone; a sent `Bridge` fills `receiver_tz` from the receiver's profile. The zone is learned from the app's `X-Presence-TZ` header on `POST /preview/login` and `GET /me` while the profile has none, and set outright with `PATCH /me { "tz": "Asia/Tehran" }` (`null` clears it; a bare offset like `+03:30` is `400 invalid`). The example cast carries zones (Lea Europe/Berlin, Sam America/Los_Angeles, Mom, Ari and Dara Asia/Tehran) so the "8:00 PM for Lea" line shows in preview. Migration 0006.
  - **Remind me later (B10c).** `POST /bridges/:id/remind { "remind_at": "2026-10-27T18:30:00.000Z" | null }`, receiver only, on a ready (delivered, unopened) bridge → `{ bridge: <receiver view>, remind_at }`. The receiver's ready view (`sealed: false, ready: true`) now carries `remind_at` (`null` when none); the app schedules its local notification from it (the picks In 1 hour, Tonight 10:00 PM, Tomorrow 8:00 AM, Pick a time are the app's, turned into a time in the receiver's zone). The sender is told nothing: no sender field changes, `opened_at` is set only when the bridge is opened. Errors: `400 invalid` (a past time, `reason: "past"`), `403 sealed` before `deliver_at`, `409 conflict` once opened, `404` for anyone but the receiver.
  - **No bridged mark when nothing changed (Q4).** The sender's `Bridge` carries `bridged_mark` (`true` only when `used` is `bridged` and `outcome` is not `nothing_to_change`); the receiver's opened view computes `bridged_mark` the same way. `POST /bridges` with `outcome: "nothing_to_change"` stores the text as before; the mark is simply off on both sides.
  - **Mirror on the web (R2, W01–W06).** `GET /m/:slug` answers the HTML page when the browser asks for `text/html` (same path, `noindex`, no store), and the JSON as before otherwise. The JSON now carries `how_long` (`under_a_year | one_to_five_years | over_five_years`), `preview` (the owner is a preview account) and `test_friends` (`[{persona, name}]`, the example people, for "Continue as a test friend"); prompt 3 is the CPO's wording, "What seemed to matter to Nami there?" (optional, Skip). `POST /m/:slug/contributions` takes the three prompts as `happening`, `did`, `mattered` (joined into one moment for the listener; a plain `moment` still works), `how_known`, `how_long`, optional `name`; identity is the bearer as before, or in preview `test_friend: "<persona>"` with no bearer (accepted only when the link's owner is a preview account and the persona is an example person; a preview link takes no other contributor: `403 forbidden`, `reason: "preview_examples_only"`; no bearer and no test friend is `401`). The reply carries `contribution_id` (`null` when nothing was stored). `DELETE /m/:slug/contributions/:id` (same identity; W06 Delete my answer) → `{ deleted: true }`: a held or waiting row is deleted; a row already behind a card is detached and the card's counts shrink; `404` when it is not this contributor's. Apple and Google sign-in are drawn but off until the providers exist; the page is reachable only by its link; insults and threats are dropped silently and a label without a moment is not used (the page asks once, with Skip). **Where the page renders:** the hosted gateway on the shared `*.supabase.co` domain rewrites HTML replies to `text/plain` (a platform rule; the body is the page, the browser shows it as text), so in preview the page is reached through the Mac fallback (`http://<mac-ip>:8821/m/<slug>`, `text/html`) until the function has a custom domain or the page is hosted on its own (Q64). The JSON and the contribution calls work on both bases. The web page's three one-line states: paused ("Nami has paused this link for now."), off, replaced or deleted ("This link no longer works."), approval first (after the first submission on an approval-only link).
  - **Length counterweight (D8).** `POST /bridge/run` lets a rewrite grow to 1.8× for originals under 30 words, 1.4× from 30 to 60 words, and 1.25× above 60 words (the critic's add-nothing judgement stays the guard). No reply shape changes; a `could_not_bridge` on a long message names `length_ratio` in its Ref detail.
- v1.6 (2026-10-27 15:10 Tehran, A53 as decided): wording only, no field changes.
  - §1.3: eight areas is the owner's decision (14:54 Tehran), no ninth area "Self"; the `self` fold is final, not provisional.
  - §10: the answered questions (Q53–Q56, Q59, Q60) moved out of the open list, with their answers named; Q62 and Q63 added.
- v1.5 (2026-10-27 15:40 Tehran, Bridge run 2 reading, COO 15:15): additive.
  - **`POST /bridge/run`: `ok` always carries a changed text.** A rewrite that returns the original word for word is a failed attempt (retried once, then `could_not_bridge`), except when the only planned friction was a `vague_ask` the sender's words do not resolve: then the outcome is `nothing_to_change` with `bridged` = `text`, `ask_unresolved: true` and `line` = the vague_ask note ("This says something has to change; it does not yet say what you want them to do."), so B05 says that instead of "This already reads clearly." Every `/bridge/run` reply now carries `ask_unresolved` (boolean, `false` unless that case).
  - **Absolutes become the event, not a label.** The rewrite rule for `absolute` is now: the specific event, stated as what happened ("When dinner moved twice this week without a heads-up"), never a present-tense label on the person ("You're bailing"); a code check (`absolute_stated_as_event`) rejects the label form and the critic is told the same. No reply shape changes.
- v1.4 (2026-10-27 14:50 Tehran, Your data): additive.
  - **Data (Y05) is live**, hosted function version 10 and the Mac fallback 8821. `GET /export` answers an `application/json` attachment (`Content-Disposition: attachment; filename="presence-YYYY-MM-DD.json"`) with `exported_at, me, conversations (each with messages, summary, next_time), beliefs (with receipts, links, patch, outside), links (belief links), people (each linked person with status, relationship, sharing, since), bridges_sent, bridges_received (opened only, as the receiver sees them), plans, mirror ({link: {on, who, paused, since} | null, perspectives}), never, settings`. Never `engine_calls`, never another person's map, never a Mirror contribution.
  - `DELETE /map` → `{ beliefs_removed, conversations_removed, outside_removed }`: every belief (with receipts and links), every conversation (with messages, soft-deleted ones too) and every outside card go; the Talk traces (`engine_calls` turn/repair/finish) go with them; Bridge threads, the Mirror link, Never topics and the Bridge and Mirror traces stay. Refused on `is_example` accounts (`403 forbidden`, `reason: "example_account"`): the cast's seeded maps are reset by script, not lost by a tap. The owner's preview account may clear its own map (it holds only his own talks).
  - `DELETE /account` → `{ deleted: true, withdrawn: [bridge ids], links_ended }`: bridges the other side has not opened are withdrawn (they see "withdrew" only where they saw the sealed bubble or a delivered one); opened bridges stay with their receivers under the Person `Deleted account`; every link becomes `removed` with a `removed` event (the thread stays read-only for the other side); bridges sent to the account can no longer be read; the map, conversations, consent, drafts, invites, Mirror link with everything pending, link settings, blocks and every `engine_calls` row of the person go; the profile row stays as "Deleted account" with nothing personal on it, and the auth user is soft-deleted. Every later request with the old bearer answers `401 unauthorized`. Refused on `is_example` and on preview accounts (`reason: "preview_account"`), as before.
  - `Person` carries `deleted` (`true` after the account was deleted; the name is then "Deleted account").
- v1.3 (2026-10-27 14:35 Tehran, COO check-in 14:20): additive.
  - **Times.** Every time field (`*_at`, `*_until`, `at`, `since`, `when`) is ISO 8601 UTC with `Z` and milliseconds, e.g. `2026-10-27T09:14:22.060Z`, whatever Postgres stored (A-Q10). `muted_until` may also be `"infinity"` (muted always). Text fields are never touched.
  - **`X-Client-Ref`.** A Ref the phone made itself (S05, Presence never answered) may ride on any later request as `X-Client-Ref: 7F3K` (several, comma-separated, at most eight). Each becomes an `errors` row with source `client` (the phone's Ref is the row's Ref when free, else kept in `client_ref`), so a screenshot's Ref can always be looked up (A-Q8). The reply does not change.
  - **Hosted function version 9** carries everything in v1.3. The Mac fallback moved to **8821** (`deno serve --watch`, reloads on code changes; A-Q9); 8820 stays up on the pre-Map code and is not used.
  - **Threads (B-Q1).** Rows carry `activity_at`: the latest thing that happened in the thread (a bridge sent, delivered or opened, a plan, an event, the draft), never a coming time; the list is sorted pinned first, then `activity_at` desc. `unread` is per viewer: `POST /threads/:person/mark-unread` sets it, opening `GET /threads/:person` clears it, and a ready bridge or today's plan shows it regardless (`badge`). `GET /threads/:person` carries `activity_at` too. `DELETE /threads/:person` removes the viewer's copy only ("Edit, delete and archive rules"): their undelivered bridges are withdrawn (the other side sees "withdrew" only if they saw the sealed bubble), their delivered copies, the bridges they received, the plans and events up to now and their draft leave their view; the link and the other person's copy stay. Reply `{ deleted: true, person_id, withdrawn: [bridge ids], removed, cleared_at }`. There is no server-side undo; the alert is the confirmation.
- v1.2 (2026-10-27 14:45 Tehran, Mirror deployed): additive.
  - Mirror (item 6) is live: `GET`/`PATCH /mirror`, `POST /mirror/rotate`, `DELETE /mirror`, `POST /mirror/approvals/:id`, the contributor page's `GET /m/:slug` (no bearer) and `POST /m/:slug/contributions` (bearer of any signed-in account; in preview, the example people), and `POST /preview/mirror-sample`. See §7 Mirror.
  - `OutsidePerspective` carries `summary` (the paraphrase of the moments; `line` stays the counts line), `note` ("Some people who know you describe this differently." on a different view, else `null`), `variant` (`new | tension`), `type`, `kind`, `area` and `about_belief_id` (the map belief a different view is about). Quiet support for a belief already on the map is never a card: it never appears in `GET /map` `outside`, `GET /outside` or `counts.outside_new`; the belief itself gets `seen_by_others: true` and `outside: {people, moments, summary}`. `PATCH /outside/:id` on such a row answers `409 conflict`, `reason: "quiet_support"`.
  - Rating a `tension` perspective Partly or Very creates the mirror belief with a `tension` link to `about_belief_id`.
  - `POST /preview/mirror-sample` reply: `{ contributions, processed: {contributions, moments, asked_for_moment, concern, dropped, held}, surfaced: [OutsidePerspective], seen_by_others: [{belief_id, people, moments}], spent_cents, stopped, mirror, ref }`; body may carry `cap_cents` (default 15, at most 50).
  - The mirror belief made from a perspective now takes the synthesis's `type`, `kind`, `area` and `domains` (v1.1's defaults apply only to rows made before item 6).
- v1.1 (2026-10-27 13:30 Tehran, Talk deployed): additive.
  - Hosted base is live: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/api` (function `api`, verify_jwt off: the handler checks the bearer; the `apikey` header is still sent). Mac fallback up on 8820.
  - `Reply.consent` carries `domain` (the engine domain, e.g. `body_health`) beside `area` and `label`; `POST /talk/consent` accepts `domain` or `area`.
  - `Reply.move.kind` is always present. A `me` row's `feeling` is `null` on a safety turn.
  - `POST /talk/turn` on a conversation that already stopped on risk: the reply has no cards and no early guess (mapping stays paused, law 8); Keep talking still answers.
  - `POST /talk/finish` after a risk stop makes no model call: cards rated before the stop are already on the map, nothing else is added, `summary` is `null` (A48(b)).
  - `POST /talk/finish` when the summary call fails: the conversation still finishes (ratings saved, unrated guesses to To confirm), `summary` is `null` and `ref` names the trace. The reply has a `ref` field (`null` when nothing failed).
  - Finish writes a new belief row only at confidence 0.7 or more, or when rated (law 9); `added` counts this conversation's confirmed beliefs, `to_confirm` its guesses.
  - `Conversation.beliefs_added` counts confirmed beliefs (was: all non-deleted).
  - Title: set by the engine from turns 1–3 (two to four plain words) until the person renames the conversation (`PATCH` with `title` pins it).
  - Try again after `502`/`503`: send the same `text` with the same `conversation_id`; the saved row is answered, not duplicated. A different text supersedes the stranded row.
  - `429 daily_limit` and `502 engine_failed` on `/talk/*` carry `saved: true` and `message_id` (the person's row).
  - Map (item 4) is live: `GET /map`, `GET /beliefs/:id`, `PATCH /beliefs/:id` (also accepts `label`, one to four words), `POST /beliefs/:id/notme`, `POST /beliefs/:id/restore` (works after Not me and after Delete), `DELETE /beliefs/:id`, `GET /outside`, `PATCH /outside/:id`. `GET /map` lists perspectives that are not set aside; `GET /outside` lists all. `connected.same_area` = up to eight other confirmed beliefs in the area not already linked. `GET /map` marks the visit (`new_since_last_visit` empties on the next read).
  - Bridge, the $0 half (item 5 start) is live: people, invites, threads, drafts, `POST /bridges`, `PATCH /bridges/:id`, withdraw, open, `DELETE /bridges/:id`, letstalk, `PATCH /plans/:id`, `PATCH /links/:person`, remove/block/unblock/report, `GET /people/:person/map`. Thread rows also carry `joined_at` and `status` (link status); `GET /people` rows carry `joined_at`. `receiver_tz` is `null` until profiles carry a zone. The engine endpoints (`/bridge/insight`, `/bridge/run`, `/bridge/reword-part`, `/bridge/why-it-matters`) follow with engine items 6–8.
  - Bridge engine endpoints (items 6–8) are live. `POST /bridge/insight`: one Haiku call (analyse) → `spans` (friction with the fixed note per kind; belief with `belief_id` and `label`, placed on the words that touch it), `tone`, `points` (v1.36: capped at 3), plus `touches` (the beliefs touched, with their gentle statements; v1.36: capped at 2, each confirmed and confidence 0.7+). The body accepts only `person_id` and `text` (v1.36: any other key is `400 invalid`). `POST /bridge/run`: Sonnet, analyse → plan → rewrite → verify; `changes[]` carry `start`/`end` in the bridged text and `original_start`/`original_end` in the original (null when a span is not found), `kind` and `why` (the fixed line per friction kind); `points[].kept`; `tone.bridged` is the rewrite's own reading; a sender-risk message answers `outcome: "could_not_bridge"` with `safety: "risk"`, the safety line and `resources`; `could_not_bridge` carries a `ref`. `points_line` reads "Keeps your point" for one point, "Keeps all N of your points" for more, `null` for none. `POST /bridge/reword-part` takes `start`/`end` (UTF-16 offsets) and an optional `friction_kind`; on failure `replaced` is `null` with a `line` and `ref`. `POST /bridge/why-it-matters` answers `line: null` with a `ref` when no line passed the checks. The relationship label comes from `PATCH /links/:person` (`friend` when unset); the voice sample is the sender's last three bridges to that person.
  - `PATCH /outside/:id` with `partly`/`very` creates the mirror belief with type `how I tend to react` and area `relationships` until the Mirror synthesis (item 6) supplies type and area; its Belief carries `outside: {people, moments, summary}` and no receipt rows (law 12: never raw).
- v1 (2026-10-27): first version.

## 0. Transport

| | |
|---|---|
| Hosted base | `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/api` |
| Mac fallback base | `http://<mac-ip>:8821` (same code, same database, reloads itself on code changes; About › Server row in test builds). 8820 is the stale pre-Map build and stays up; do not use it. |
| Headers, every call | `Authorization: Bearer <access_token>` (the Supabase session JWT); `apikey: <anon key>` (the gateway needs it; harmless on the Mac); `Content-Type: application/json`; `X-Presence-Client: ios/0.9+<build>`; optional `X-Presence-TZ: Asia/Tehran` (IANA zone, used for grouping dates and "Tonight"); optional `X-Client-Ref: 7F3K` (a Ref the phone made when Presence never answered; kept in `errors` with source `client`) |
| Reply header | `X-Presence-Contract: 1` |
| Bodies | JSON, UTF-8. Times are ISO 8601 in UTC with `Z` and milliseconds (`2026-10-27T09:14:22.060Z`); `muted_until` may be `"infinity"`. IDs are UUID strings. Money is integer cents. |
| Paths | Relative to the base; `:id`, `:person` are UUIDs; `:code` is an invite code. |

Only `POST /preview/login` runs without a bearer token. Everything else answers `401 {error:"unauthorized", ref}` without one.

### Error reply, always this shape

```json
{ "error": "daily_limit", "ref": "7F3K", "message": "Talk opens again at 12:00 AM.", "opens_at": "2026-10-28T00:00:00Z" }
```

- `error`: one of the codes below. `ref`: 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), matching one row in the `errors` table, so a screenshot is enough to find the failure. `message`: a plain line the app may show; the app's own copy wins when the design has one.
- Extra fields are named per code.

| HTTP | `error` | When | App state |
|---|---|---|---|
| 400 | `invalid` | malformed body, unknown enum value, text over 4,000 characters (`field` names the field) | inline, no screen |
| 401 | `unauthorized` | no or expired session | sign-in |
| 403 | `forbidden` | not your row, link removed or blocked, preview endpoint on a real account (`preview_only`), bridge already opened (`too_late`) | the row's own copy |
| 403 | `sealed` | receiver opens a bridge before `deliver_at`; carries `deliver_at` | B10 |
| 404 | `not_found` | | the row's own copy |
| 409 | `conflict` | a second active conversation, an invite already accepted, a plan already answered | T12 or the row's copy |
| 429 | `daily_limit` | the ledger refused the reserve; carries `opens_at` and `scope: "talk"\|"bridge"` | S06 (Map and Bridge keep working; Bridge it has its own small allowance) |
| 502 | `engine_failed` | reserved for non-Talk engine routes that cannot make a safe product answer | S02 with Try again |
| 503 | `unreachable` | database or service unreachable; Talk model transport failures use the v1.17 safe fallback | S05 |
| 500 | `internal` | anything else | S02/S05 |

Every error reply is also a row in `errors` (ref, person, where, detail, source `api`). A Ref the phone made itself (S05) reaches the same table through `X-Client-Ref` with source `client`. Nothing in a user-facing path raises without this shape.

### Timing the app may rely on

| Call | Typical | App shows |
|---|---|---|
| `POST /talk/turn`, `/talk/edit`, `/talk/consent` | 3–8 s (Sonnet 5.5) | scribble under 1 s; S01 at 6 s; S02 at 30 s (client timeout 30 s, then `GET /conversations/:id` finds the reply if it landed) |
| `POST /talk/finish` | 3–10 s | T09 → T11 |
| `POST /bridge/insight` | 1–3 s (Haiku 5.5) | underlines refresh; debounced 1 s after typing stops |
| `POST /bridge/run` | 4–12 s | S16, then B05 |
| everything else | under 1 s | |

### `GET /health` (no bearer)

```json
GET /health
← 200 { "ok": true, "contract": 1, "at": "2026-11-03T09:14:22.060Z" }
```

Registered without the router's bearer check (`next/api/index.ts:291`). It reads no table and carries nothing private: `ok` is always `true`, `contract` is the literal `1`, `at` is the server's current time. Used by `next/api/check.ts:21`. It does not check the database or the model providers, so a `200` means only that the function answered.

**Region (speed, 12 Nov, hosted only).** Supabase runs the function in the region nearest the caller; the database sits in one region. A client may send `x-region: <db region>` to run the function next to the database (hosted: `eu-west-1`). When the function secret `PRESENCE_DB_REGION` is set, a request that arrives elsewhere without `x-region` is forwarded once to that region (`next/api/lib/region.ts`); if the forward fails it is served where it landed. Every hosted reply carries `x-presence-region` (where it was served) and, when forwarded, `x-presence-forwarded-from`. No body, status or route changes.

## 1. Shared values

### 1.1 `feeling` (Talk turn reading) and `tone` (Bridge reading): one enum

```
neutral | confused | sad | lonely | angry | happy | excited
```

The app maps `neutral` to the sculpture's Listening form. Thinking and Understanding are app states, never returned. Each Talk turn returns the feeling read from the person's words on that turn; the app blends 35% per reading. Bridge insight returns the draft's tone; Bridge run returns the tone of the original and of the bridged version. Nothing ever returns a tone for a sealed bridge.

### 1.2 Belief type → kind

The five plain types are the only values of `type` (the app's Type pill). `kind` is derived, never set by the app.

| `type` (the person's pill) | `kind` | engine level | map height | patch size weight |
|---|---|---|---|---|
| `something I believe is true` | `foundation` | L0 | crown | 1.5 |
| `a rule I live by` | `rule` | L1 | middle | 1.0 |
| `something I do to cope` | `rule` | L2 | middle | 1.0 |
| `a view or taste` | `everyday` | L3 | lower edge | 0.6 |
| `how I tend to react` | `everyday` | L4 | lower edge | 0.6 |

`PATCH /beliefs/:id {type}` with one of the five strings re-derives `kind`. The area weights in `GET /map` use the same numbers.

### 1.3 `area` (the eight areas of life) and direction

| `area` | direction (degrees) | from engine domain(s) |
|---|---|---|
| `relationships` | 90 | `close_relationships` |
| `work` | 12 | `work` |
| `body` | 300 | `body_health` |
| `money` | 242 | `money` |
| `meaning` | 200 | `meaning` |
| `family` | 150 | `family` |
| `politics` | 285 | `politics`, `society` |
| `morality` | 175 | `morality` |

The map has exactly these eight areas; there is no ninth area "Self" (the owner's decision, 2026-10-27 14:54 Tehran, A53). The engine also reads a `self` domain (worth, competence, control); it folds: a belief whose domains are `self` plus another takes the other's area, and a belief that is only `self` takes `meaning`. The raw engine `domains` list is returned beside `area` so nothing is lost.

### 1.4 Belief fields

```
status:  guess | confirmed | set_aside | deleted
rating:  null | not | partly | very       (not  ⇒ status set_aside; partly|very ⇒ confirmed)
kind:    foundation | rule | everyday
source:  talk | mirror | import | own      (own: typed by the person, v1.66)
birth_mood: a feeling value (the turn it took shape in); never null
tone:    float from -1 (heavy) to 1 (light); 0 until its setter is confirmed
```

### 1.5 Consent (asking before a new area)

```
answer: sure | not_now | never
```

`never` stores the topic label under Y06 and the engine never raises that area again (Y06 › Allow again removes it).

### 1.6 Bridge values

```
outcome:   ok | nothing_to_change | could_not_bridge | wont_carry
used:      bridged | mine | edited
bridge status: draft | scheduled | withdrawn        (delivered and opened are derived: now() >= deliver_at; opened_at not null)
plan status:   planned | talked | cancelled
relationship (private, sets tone): partner | friend | family | coworker | null
span kind: friction | belief
friction_kind: absolute | character | mind_reading | sarcasm | contempt | demand | blame_stack | vague_ask | heat | you_blame   (heat, you_blame: v1.42)
point kind: complaint | request | feeling | fact | question
```

### 1.7 The bridge receiver rule

A receiver never reads the `bridges` table; they read through one database function the API calls on their behalf.

- Before `deliver_at`, the receiver gets only `{ "id", "sealed": true, "deliver_at", "from": person }`, and only if the sender left `heads_up` on. No text, no tone, no length, no word count, no `used`, no `show_original`. Without `heads_up` the bridge is absent from every receiver reply until `deliver_at`.
- From `deliver_at` until the receiver opens it: `{ "id", "sealed": false, "ready": true, "deliver_at", "from" }`. Still no text and no tone.
- `POST /bridges/:id/open` at or after `deliver_at` returns the text (and the original only when `show_original` is on), the bridged tone, and sets `opened_at`. Before `deliver_at` it answers `403 sealed` even if called by hand.
- A withdrawn bridge is gone from the receiver's thread; if they had seen the sealed bubble, a `thread_events` row `withdrew` replaces it ("Nami withdrew a bridge").
- A blocked sender's scheduled bridges are dropped, silently.
- The sculpture stays neutral on the receiver's side while a bridge is sealed: no field exists that could leak the tone early.

## 2. Objects

### Person (yourself or someone linked)

```json
{ "id": "…", "name": "Lea", "initial": "L", "color": "#7D6BC9", "photo_url": null, "is_example": true, "practice": true, "deleted": false, "tz": "Europe/Berlin" }
```

`practice` (v1.39) is `true` for the owner's own practice cast (Lea, Mom, Sam, Ari, Dara) and `false` for everyone else, including Jo (the QA pair's other half: `is_example` like the rest of the cast, but never linked to the owner and so never `practice`). It is a separate signal from `is_example`, which keeps its existing, broader meaning (see §7's `DELETE /map` and `DELETE /account` refusals).

`deleted` is `true` for a person who deleted their account (name "Deleted account"); their opened bridges stay in your thread. `tz` is the person's IANA zone (`null` until known; v1.7): the app shows "8:00 PM for Lea" under the time pill, and "late at night for Lea" when the time lands between 11 PM and 7 AM for them; the receiver only ever sees their own time.

### Conversation

```json
{ "id": "…", "title": "Dinner plans", "status": "active", "mode": "voice",
  "started_at": "2026-10-27T15:02:11Z", "last_active_at": "2026-10-27T15:09:40Z", "paused_at": null, "finished_at": null,
  "beliefs_added": 1, "group": "today", "turns": 6, "unrated": 1, "source": "talk" }
```

`status`: `active | paused | finished`. `group`: `today | yesterday | previous_7_days | earlier` in the `X-Presence-TZ` zone. A paused conversation is finished by the server at the first read 24 h after `paused_at` (its unrated guesses go to To confirm).

### Message

```json
{ "id": "…", "conversation_id": "…", "role": "me", "turn": 3, "text": "Dinner moved again, third time this month.",
  "created_at": "…", "edited_at": null, "superseded": false, "feeling": "lonely", "reply": null }
```

A `presence` row has `role: "presence"`, `text` = reflection + question joined for read-aloud, `feeling: null`, and `reply` = the Reply object below. `superseded: true` rows are the replies replaced by an edit; lists omit them unless `?include_superseded=true`.

### Reply (what Presence says on one turn)

```json
{ "state": "turn",
  "reflection": "Dinner moving twice in a month stays with you.",
  "question": "What did you do the second time it moved?",
  "move": { "kind": "deepen" },
  "consent": null,
  "cards": [ Card ],
  "early_guess": null,
  "feeling": "lonely",
  "safety": null,
  "ref": null }
```

- `state`: `turn | consent | safety`.
- `move.kind`: `follow | deepen | contrast | clarify | bridge | ask_permission | close` (trace only; the app does not branch on it).
- `consent` (when `state` is `consent`): `{ "area": "body", "label": "your health", "domain": "body_health" }`. The app shows Sure, Not now and Never chips under the question (T08) until `POST /talk/consent` or the person's next turn.
- `cards`: beliefs that reached the 0.7 threshold on this turn, in the order to show (one at a time; the app queues the rest). Usually zero or one.
- `early_guess` (S03, from turn 3 when no card is confident): `Card` with `confidence` under 0.7, or `null`. The app shows the light "Is this you?" chip.
- `safety` (when `state` is `safety`): `{ "message": "It sounds like you may need immediate support from a person.", "resources": [ { "label": "Find a helpline", "url": "https://findahelpline.com" } ] }`. Mapping is paused for the rest of the conversation: no cards, nothing extracted from that turn or later ones. Cards rated earlier are kept. Keep talking continues with `POST /talk/turn` (replies, no cards); Finish makes no consolidation call (v1.1).
- `feeling`: the reading of the person's turn (never the reply's).
- `ref`: a Ref only when the turn fell back to the thread line after a failed check ("I lost my thread for a moment…"), so a screenshot finds the trace.

### Card (a belief taking shape, T04)

```json
{ "belief_id": "…", "label": "Afterthought",
  "statement": "You may feel you are an afterthought when plans move without you.",
  "type": "something I believe is true", "kind": "foundation", "area": "relationships", "domains": ["self", "close_relationships"],
  "birth_mood": "lonely", "confidence": 0.78, "tone": 0,
  "receipts": [ { "message_id": "…", "quote": "third time this month and nobody asked me", "conversation_id": "…", "said_at": "…" } ],
  "import_receipt": null,
  "rests_on": { "belief_id": "…", "label": "Not counting" },
  "rating": null, "status": "guess" }
```

`own_wording` and `offered_wording` (v1.66) are on every Card: `own_wording` is the person's confirmed first-person line or `null`; `offered_wording` is Talk's first-person offer, non-null only on a guess, shown only on the Y5 card. `label` is one to four words. `receipts[].quote` is an exact substring of that message's current text. "2 moments in your words" = `receipts.length`. `import_receipt` is `null` except on an imported belief, where it is `{ "kind": "import", "line": "From your AI · YYYY-MM-DD", "date": "YYYY-MM-DD" }`; it is source metadata, never a quote or a Talk receipt.

### Belief (map and list)

The Card fields plus:

```json
{ "source": "talk", "rated_at": "…", "confirmed_at": "…", "set_aside_at": null, "seen_by_others": false,
  "links": [ { "belief_id": "…", "label": "Not counting", "kind": "rests_on" } ],
  "patch": { "kind": "foundation", "area": "relationships", "direction_deg": 90, "height": "crown", "size": 1.5,
             "mood": "lonely", "pale": false, "sheen": false },
  "outside": null }
```

- `links[].kind`: `rests_on | holds_up | tension | same_area`.
- `patch`: everything `MapSculpture` needs. `pale` = rated partly; `sheen` = seen by others. Only `status: confirmed` beliefs are drawn; `GET /map` still lists guesses and set-aside beliefs for the M07 sections.
- `outside`: `{ "people": 4, "moments": 6, "summary": "…" }` when Mirror has something for this belief, else `null`.

### Bridge (as the sender sees it)

```json
{ "id": "…", "from": Person, "to": Person, "reply_to": null,
  "status": "scheduled", "delivered": false, "opened_at": null,
  "deliver_at": "2026-10-27T16:30:00Z", "tz": "Asia/Tehran", "receiver_tz": "Europe/Berlin",
  "original": "You always change plans last minute…", "bridged": "…", "final": "…", "used": "bridged", "bridged_mark": true,
  "outcome": "ok", "tone_original": "angry", "tone_bridged": "sad",
  "changes": [ Change ], "points": [ Point ],
  "show_original": false, "heads_up": true,
  "created_at": "…", "updated_at": "…", "plan": null, "ref": null }
```

As the receiver sees it (through the function, §1.7):

```json
{ "id": "…", "from": Person, "sealed": true,  "ready": false, "deliver_at": "…", "heads_up": true, "opened_at": null }
{ "id": "…", "from": Person, "sealed": false, "ready": true,  "deliver_at": "…", "opened_at": null, "remind_at": null }
{ "id": "…", "from": Person, "sealed": false, "ready": false, "deliver_at": "…", "opened_at": "…",
  "final": "…", "used": "bridged", "bridged_mark": true, "original": null, "tone": "sad", "reply_to": null, "plan": Plan|null }
```

`original` is present after opening only when the sender set `show_original`. `bridged_mark` is `false` when nothing changed (`outcome: nothing_to_change`) or the sender sent their own words (v1.7). `remind_at` on the ready view is the receiver's own Remind me later (v1.7). On the sender's shape, `opened_at` is `null` while read receipts are off on either side (v1.12).

### Change and Point

```json
{ "start": 4, "end": 10, "original": "always", "to": "the last three times", "kind": "absolute",
  "why": "Absolutes tend to land as a verdict on the person, not the moment." }
{ "kind": "complaint", "quote": "change plans last minute", "kept": true }
```

Offsets are UTF-16 code-unit offsets into the text named (`changes` index the bridged text; `original` is the span of the sender's text that was changed). `start` and `end` are `null` when `to` is not found in the bridged text (a whole-text `vague_ask` note, for one), and `original_start`/`original_end` are `null` when `original` is not found in the sender's text (v1.13, A-Q17); `original`, `to`, `kind` and `why` are always strings. Decode the four offsets as optional.

### Plan (Let's talk)

```json
{ "id": "…", "bridge_id": "…", "proposed_by": "…", "when": "2026-10-28T16:30:00Z", "soon": false,
  "status": "planned", "talked_at": null, "created_at": "…" }
```

`when` is `null` with `soon: true`.

### Thread item

One of, by `kind`:

```json
{ "kind": "bridge", "bridge": Bridge }
{ "kind": "plan", "plan": Plan }
{ "kind": "event", "event": { "id": "…", "type": "talked|withdrew|removed|blocked", "by": "…", "at": "…" } }
```

## 3. Authentication, preview and session

### `POST /auth/apple` (no bearer; real accounts)

```json
→ { "identity_token": "eyJ…", "nonce": "raw-random-nonce", "name": "Ava Stone", "adult_confirmed": true,
    "authorization_code": "c1234…" }
← { "access_token": "…", "refresh_token": "…", "expires_at": "2026-10-29T18:00:00.000Z",
    "created": true, "me": Me }
```

- `identity_token` is the UTF-8 value from `ASAuthorizationAppleIDCredential.identityToken` (string, required, at most 16,384 characters). `nonce` is the original random nonce used for the Apple request (string, required, at most 512 characters), not its SHA-256 value. The backend passes both to Supabase Auth's Apple ID-token verifier. It does not decode claims as proof on its own.
- `authorization_code` (SD6b, v1.38) is `ASAuthorizationAppleIDCredential.authorizationCode`, a string or omitted/`null` (at most 2,048 characters). When present, the backend exchanges it with Apple for a refresh token and stores it application-layer-encrypted against the profile, so a later `DELETE /account` can revoke it at Apple (§7). The exchange is a no-op — nothing stored, sign-in unaffected — until Nami's Apple key exists on the server; it never appears in the reply or any log.
- `name` is a string or `null`. Apple normally supplies the full name only on the first authorization; the app passes it then and keeps it through a retry. The backend collapses whitespace and keeps at most 40 characters. A missing first name becomes `"You"`, which the person can change with `PATCH /me`. A later Apple sign-in never overwrites the stored name.
- `adult_confirmed` must be the literal boolean `true`, matching O02's “confirm you are 18 or older” action. Creation stores its time and Terms version. It is not returned to linked people.
- `created` is `true` only when this exchange made the Presence profile. It is `false` when Supabase linked the verified Apple identity to an existing Auth user or when the same Apple identity signed in again. In either case the returned `me.person.id` is the stable Presence account id.
- Refresh through Supabase Auth with `refresh_token`; every normal API route uses `Authorization: Bearer <access_token>`. The identity token and nonce are verification inputs only: they are not persisted in `profiles`, `errors`, traces or logs, and are not returned.
- Hosted Auth authorizes only the native audiences `com.namidavoodzadeh.presence` and `com.namidavoodzadeh.presence.qa` (`next/scripts/configure_apple_auth.py`). Debug/QA and TestFlight use the same endpoint; Apple and Supabase validate the audience. This is native-only: no web Services ID or Apple OAuth secret is configured.
- Errors: `400 {error:"invalid", ref, field:"identity_token"|"nonce"|"name"|"adult_confirmed"}`; `401 {error:"unauthorized", ref, message:"Apple couldn't verify this sign-in."}` for an invalid, expired, wrong-audience or wrong-nonce credential; ordinary `500 internal` only if profile provisioning fails after verification. No error echoes a credential.

Account deletion is the existing authenticated `DELETE /account` in §7. It withdraws unopened sent bridges, ends links, deletes the person's private rows, model traces, devices and pending pushes, anonymises the bridge tombstone, and hard-deletes the Supabase Auth user (provider identity, sessions and refresh tokens) without breaking already-opened bridge history. The API's `auth.getUser` check rejects an outstanding access JWT after the Auth row is gone. A later Apple authorization may create a fresh account; it does not recover deleted content. (SD6b, v1.38) Before any of that, a stored Apple refresh token is decrypted and revoked at Apple; a missing token, an unconfigured Apple key, or Apple's own call failing is logged as a Ref and never blocks the deletion.

### `POST /auth/google` (no bearer; real accounts; v1.74, STAGING ONLY)

```
→ { "id_token": "<Google ID token>", "nonce": "<raw nonce>", "adult_confirmed": true, "server_auth_code": "<optional>" }
← 200 { "access_token": "…", "refresh_token": "…", "expires_at": "…", "created": true, "me": { … } }
```
Only the email is kept (Google's name and photo are scrubbed after each sign-in; fail closed). Unverified email: `401 unauthorized`. See v1.74 above.

### `POST /preview/login` (no bearer)

```json
→ { "persona": "lea" }
← { "access_token": "…", "refresh_token": "…", "expires_at": "2026-10-27T16:00:00Z", "me": Me }
```

`persona`: `lea | mom | sam | ari | dara | jo | kai | noor` — never `nami` (2026-11-06 P0: his account carries his own real talks, not a cast; `persona: "nami"` answers `403 forbidden` unconditionally, hosted or Mac). `lea`, `mom`, `sam` and `ari`/`dara` are `is_example` people; `jo` (v1.13) is the QA pair's other half, linked to `sam` only; `kai` and `noor` (v1.23) are Nami's hand-test pair, normal (not `is_example`) people linked only to each other as partners with empty maps, never to any example person. On the hosted runtime (never the Mac), this answers `401 preview_secret_required` unless the request carries `X-Presence-Preview-Secret` matching the server's `PRESENCE_PREVIEW_DEVICE_SECRET`, a value set only in the hosted project's own secrets and provisioned by hand onto a tester's device — never compiled into the app bundle, never the same value as any password the server already holds. A release build never calls this (`PRESENCE_RELEASE=true` answers `404 not_found`). Settings › Account › Switch account (preview) calls it with another persona. Refresh through the Supabase Auth refresh endpoint with `refresh_token`. On a real (non-preview) account this answers `403 preview_only`.

### `GET /preview/spend`

```json
← { "today_cents": 912, "owner_preview_cents": 88, "total_cents": 7473, "daily_cap_cents": 3000, "owner_preview_extra_cents": 500, "total_cap_cents": 20000, "utc_day": "2026-10-27" }
```

### `POST /preview/mirror-sample`

The five example people describe moments about the signed-in preview account's owner (ten in all, from `next/api/mirror_sample.ts`: two themes that converge from four and three people, one moment that stands alone, one label with no moment), through the same pipeline a real contribution takes; the gate runs after each. Turns the owner's link on if it was off. An earlier sample that the owner has not rated is replaced; what he rated stays. Every model call is tagged owner-preview and traced.

```json
→ { "cap_cents": 15 }                       // optional; default 15, at most 50; processing stops at the cap
← { "contributions": 10,
    "processed": { "contributions": 10, "moments": 8, "asked_for_moment": 1, "concern": 0, "dropped": 1, "held": 1 },
    "surfaced": [ OutsidePerspective ], "seen_by_others": [ { "belief_id": "b1", "people": 2, "moments": 2 } ],
    "spent_cents": 7, "stopped": null, "mirror": Mirror, "ref": null }
```

## 4. Talk

### `POST /talk/turn`

A new conversation may carry `source: "bridge_refused"` (S15b Talk it through: the refused words are its first turn; v1.7).

```json
→ { "conversation_id": null, "text": "Dinner moved again, third time this month.", "mode": "voice", "starter": false, "belief_id": null }
← { "conversation": Conversation, "message": Message, "reply": Reply, "latency_ms": 4120 }
```

- `conversation_id: null` starts a conversation (409 `conflict` if one is `active` or `paused`; the body carries `active: Conversation` so the app can offer "Finish 'Dinner plans' and start new, or Keep talking there", T12). Finish the other first or pass its id to continue.
- `mode`: `voice | text`, the mode of this turn; the conversation's `mode` becomes the mode used last.
- `starter: true` marks a starter chip (T01). It is stored as `Message.answer_kind: "chip"`; its receipt is `{kind: "choice", quote: "you chose: <chip>"}`, never a plain quote. A chip alone may support only a reaction-level card (L4); a deeper card also needs a told receipt. `belief_id` marks "Talk about this" from a belief card (M03): the engine opens on that belief.
- The engine call is reserved in the ledger first; a refused reserve answers `429 daily_limit` and nothing is stored but the person's words (`saved: true`).
- `message` is the person's row (with its `feeling`). Two rows are stored per turn, the `me` row and the `presence` row; `reply` is the Presence row's content and carries that row's id as `message_id`:

```json
"reply": { "message_id": "…", "turn": 3, "state": "turn", "reflection": "…", "question": "…", "move": {"kind": "deepen"},
           "consent": null, "cards": [], "early_guess": null, "feeling": "lonely", "safety": null, "ref": null }
```

Example, a card turn (T04):

```json
← { "conversation": { "id": "c1", "title": "Dinner plans", "status": "active", "mode": "voice", "turns": 3, "unrated": 1, "beliefs_added": 0, "group": "today", "started_at": "…", "last_active_at": "…", "paused_at": null, "finished_at": null },
    "message": { "id": "m5", "conversation_id": "c1", "role": "me", "turn": 3, "text": "…nobody asked me, I just got the new time.", "created_at": "…", "edited_at": null, "superseded": false, "feeling": "lonely", "reply": null },
    "reply": { "message_id": "m6", "turn": 3, "state": "turn",
               "reflection": "You got the new time, and nobody asked you first.",
               "question": "What do you usually do when that happens?",
               "move": { "kind": "deepen" }, "consent": null,
               "cards": [ { "belief_id": "b1", "label": "Afterthought", "statement": "You may feel you are an afterthought when plans move without you.", "type": "something I believe is true", "kind": "foundation", "area": "relationships", "domains": ["self", "close_relationships"], "birth_mood": "lonely", "confidence": 0.78, "receipts": [ { "message_id": "m5", "quote": "nobody asked me, I just got the new time", "conversation_id": "c1", "said_at": "…" }, { "message_id": "m3", "quote": "third time this month", "conversation_id": "c1", "said_at": "…" } ], "rests_on": null, "rating": null, "status": "guess" } ],
               "early_guess": null, "feeling": "lonely", "safety": null, "ref": null },
    "latency_ms": 5210 }
```

Example, a consent turn (T08): `reply.state = "consent"`, `reply.consent = { "area": "body", "label": "your health" }`, `reply.question` is the ask ("Can I ask about your health, or would you rather not?"), `cards: []`.

Example, a safety stop (S07): `reply.state = "safety"`, `reply.safety = { message, resources }`, `reflection` and `question` are `""`, `cards: []`.

#### Streaming (`?stream=1`, v1.19)

The request body, authentication, error replies, retry/idempotency rule and spend caps are the same as above. When the feature flag is off, `?stream=1` answers `404 not_found` with `feature: "live_voice_phase1"`; the non-stream route remains available.

```text
event: accepted
data: {"conversation_id":"c1","message_id":"m5"}

event: speech
data: {"seq":0,"text":"You got the new time, and nobody asked you first.","kind":"reflection"}

event: speech
data: {"seq":1,"text":"What do you usually do when that happens?","kind":"question"}

event: forming
data: {"id":"h1","area":"relationships","area_confidence":0.5,"confidence":0.78,"state":"card_up"}

event: reply
data: {"conversation":Conversation,"message":Message,"reply":Reply,"latency_ms":1840}

event: done
data: {"first_token_ms":410,"first_sentence_ms":760,"latency_ms":1840,"cancelled":false}
```

- `accepted` means the person's `Message` is stored. It is always first.
- Each `speech` is one complete sentence, never a token delta. `seq` starts at zero. `kind` is `reflection | question`. The first reflection may arrive before the full JSON only when it passes the independent guards above; the question is emitted only after the full reply passes the ordinary engine path.
- **`forming` (v1.25), one event per hypothesis kept after checks** (shown or still below 0.7), drives the Talk spheres animation (CDO "Spheres behind the curtain") without a label, statement or receipt leaving the server: `{ id, area: Area | null, area_confidence, confidence, state: "forming" | "card_up", conviction?, existing_belief_id? }`. `state` is `"card_up"` at 0.7 confidence or more (law 9: the matching card appears in `reply.cards` the same turn), else `"forming"`. `existing_belief_id` and `conviction` (the map belief's current `confidence`) appear only when the hypothesis resolved to a belief already on the map (same belief, new receipt); a brand-new hypothesis has neither. `area_confidence` is the share of the hypothesis's `domains` that agree with the chosen `area` (CONTRACT §1.3's folding rule); 0 when nothing agrees (the area shown is only the default fallback). Sent before `reply`; none at all for a risk stop (law 8: nothing is extracted from that message).
- For S07 the stream is `accepted`, `safety {"reply":Reply}`, `reply`, `done`, with no `speech` or `forming`. A provider/parser failure after retry is `accepted`, `fallback {"reply":Reply}`, `reply`, `done`; the fallback is stored as in v1.17.
- `first_token_ms` is provider first-text latency measured inside the function; it reveals no token. `first_sentence_ms` is the function's first guarded `speech` enqueue. Either is `null` when no such event occurred. Client mouth-to-ear measurement still adds end-of-turn detection and local TTS startup.
- **`error`.** When the turn throws after the stream has started, and the client has not closed the response, the server sends one `event: error` whose `data` is the §0 error body and closes the stream. The event preserves the real code, message and public extras: for example a saved turn refused by the ledger carries `{"error":"daily_limit","ref":"7F3K","message":"…","opens_at":"…","scope":"talk","saved":true,"message_id":"m5"}`. The row stored against the Ref has the same code; private diagnostic `detail` never leaves the server. No `reply` or `done` follows. It can arrive after `accepted` and after any `speech` or `forming` already sent; the HTTP status is already `200`. When the client has closed the response (barge-in), nothing is sent and no `errors` row is written. If the `errors` insert itself fails, `ref` is a local 4-character Ref that matches no row (`next/api/lib/errors.ts:31-36`).
- Closing the response is the barge-in signal. The server aborts work still in flight; a client never sends an SSE event upstream.

### `POST /talk/consent`

```json
→ { "conversation_id": "c1", "area": "body", "label": "your health", "answer": "never", "domain": "body_health" }
← { "conversation": Conversation, "message": Message, "reply": Reply, "never_id": "n1", "latency_ms": 3800 }
```

Stores the answer, then the engine answers again (one call): with `sure` it continues into the area; with `not_now` or `never` it steps away. `never_id` is the Y06 row (else `null`). The `message` row is the chosen chip as the person's turn ("Never"), so the transcript stays honest. A spoken or typed answer may instead go through `POST /talk/turn`; the engine reads it.

### `POST /talk/edit`

```json
→ { "message_id": "m5", "text": "…nobody asked me, I just got the new time by text." }
← { "conversation": Conversation, "message": Message, "reply": Reply, "superseded": ["m6", "m7", "m8"],
    "receipts_updated": 1, "beliefs_removed": [], "latency_ms": 4400 }
```

The message's text is replaced (`edited_at` set); every Presence reply from that turn on is marked `superseded` and the person's later turns stay as history but are not re-answered (as in ChatGPT, the branch restarts here). Receipts from that message now quote the new words when the quote survives; a receipt whose words are gone is removed, and a belief with no receipts left is removed (`beliefs_removed`, law 2). Only `me` rows can be edited.

### `DELETE /talk/messages/:id`

```json
← { "deleted": "m5", "receipts_removed": 1, "beliefs_removed": ["b1"], "superseded": ["m6"] }
```

Alert copy (app): "Delete message? It's also removed from your map." The Presence reply to that turn is superseded with it.

### `POST /talk/finish`

```json
→ { "conversation_id": "c1", "ratings": [ { "belief_id": "b1", "rating": "very" } ], "not_now": ["b2"] }
← { "conversation": Conversation, "added": 1, "to_confirm": 1, "beliefs": [ Belief ],
    "summary": "You talked about dinner moving and being told rather than asked.", "ref": null, "latency_ms": 6100 }
```

Runs the summary once (v1.79: a first failure leaves the conversation open and answers `still_working: true`, the same request again is the one retry; 409 `conflict` if already finished; continuing a finished conversation goes through `/talk/turn` with its id and reopens it). `ratings` may be empty. Unrated guesses (`not_now` and any others) keep `status: guess` and appear under To confirm (M07). `added` = this conversation's beliefs now `confirmed`; the toast reads "1 belief added to your map". `to_confirm` = its guesses. `beliefs` lists both. With nothing unrated the app calls this straight from Done. After a risk stop, or when the summary call fails, `summary` is `null` (v1.1).

### `GET /conversations`

```json
← { "conversations": [ Conversation ], "active": Conversation|null, "pending_reply": { "conversation_id": "c1", "message_id": "m9", "since": "…" } | null }
```

Sorted by `last_active_at` desc, grouped by `group` in the app. `active` is the one `active` or `paused` conversation (T12's Continue bar). `pending_reply` names a `me` row that has no reply yet (the app left mid-wait; S10 polls `GET /conversations/:id` until the reply is there or 30 s passed).

### `GET /conversations/:id`

```json
← { "conversation": Conversation, "messages": [ Message ], "pending_reply": { "message_id": "m9", "since": "…" } | null, "unrated": [ Card ] }
```

Messages in turn order, superseded rows omitted unless `?include_superseded=true`. `unrated` are this conversation's guesses not yet rated (T09, the "1 to confirm" chip).

### `PATCH /conversations/:id`

```json
→ { "title": "Dinner, again" }            ← { "conversation": Conversation }
→ { "status": "paused" }                  ← { "conversation": Conversation }    (stepping away, T12)
```

### `GET /conversations/:id/delete-preview`

```json
← { "beliefs_only_here": [ { "belief_id": "b1", "label": "Afterthought" } ], "count": 2,
    "line": "2 beliefs came only from this conversation and will leave your map." }
```

With `count: 0` the line is `"Delete this conversation?"`.

### `DELETE /conversations/:id`

```json
← { "deleted": "c1", "beliefs_removed": ["b1", "b4"], "undo_until": "2026-10-27T15:12:40Z" }
```

Soft delete (`deleted_at`) for 5 s; `POST /conversations/:id/restore` before `undo_until` brings it and its beliefs back; after that the server purges it.

## 4A. Import from your AI (hosted owner-only)

These routes exist behind server switch `PRESENCE_IMPORT_FROM_AI`; it is on for the single configured owner account and remains closed to every other account by id allowlist. Presence receives only text the person explicitly pastes or shares. It never connects to another AI account or history.

`POST /imports/ai { text, source: "chatgpt|claude|gemini|other", imported_at: "ISO-8601 time", provider_disclosure: { provider: "anthropic", disclosed_at: "ISO-8601 time" } }` runs three stages in this exact order: safety screen, identifying-detail scrub, then listener. The disclosure is shown once before the first cloud import and names Anthropic; Talk is offered instead. Each request carries the saved disclosure record, not a new per-use consent. A missing or malformed `disclosed_at`, or a provider other than the named current provider, is refused with `403 forbidden`, `reason: "import_provider_disclosure_required"`, `provider: "anthropic"`, before a model client or ledger call. A risk result returns `{ state: "safety", guesses: [], resources, import_id: null }` and runs neither later stage. A refusal/no-access/no-memory answer is rejected before any provider call. `KNOWS ME: a little` with no completed interview evidence, or an answer with no surviving grounded guess after whole-answer extraction, returns `{ state: "thin", import_id: null, created_at: null, guesses: [], score_eligible: false }`; an inline interview followed by grounded sections is processed, and missing or reordered labels do not make an answer thin. Long answers have no input-length or word cap: the server processes every bounded context chunk and merges distinct guesses. `WITH PEOPLE` is parsed with the other evidence sections, and parts separated by `MORE TO COME` are reassembled as one import. Otherwise it returns `{ state: "ready", import_id, created_at, source, imported_at, guesses: [{ guess_id, label, statement, type, area, note }], score_eligible: false }`. The first review round contains up to 7 highest-ranked waiting guesses; later requests continue until none remain. Every round ranks depth, then evidence, then area spread (maximum two items per area), then distinct-source agreement. There is no per-import or lifetime round cap. Raw text and raw stage traces are deleted after the request; only canonical source metadata, de-identified guesses, and structured moments remain. Each moment and its optional `Your words` field is marked `from_your_ai`; it is shown as **Your AI's note**, never as the person's quote, and it needs a later exact Talk quote for full evidence weight. The receipt line is `From your AI · <imported_at date>`.

`POST /imports/ai/:id/feel { "answer": "yes|partly|not_really|skipped" }` stores the private finish-question answer once and returns `{ "saved": true }`. A second call for the same owned import returns `409 conflict`, `reason: "already_answered"`; an import the caller does not own is `404 not_found`. This answer is never returned to another person or included in shared map, belief, receipt, Mirror, or Bridge reads.

`POST /imports/ai/:id/answers` takes:

```json
{ "answers": [ { "guess_id": "uuid", "rating": "not|partly|very" | null, "wording": "optional owner wording" } ], "clear_rest": false }
```

This rating call is named `RateImportGuess`: `{ guess_id, rating: not|partly|very|null, wording? }`. `null` means Not sure and puts that guess off the map. Guesses have status `waiting|rated|retired`; a rated guess remains traceable. Quiet waiting guesses retire only after 90 days, never after 14. Merge keys reconcile the same proposal across imports. `partly` and `very` become confirmed; `not` becomes set aside. Saved beliefs have `source: "import"`, the display-only receipt `From your AI · <date>`, and no Talk receipt rows. An imported core guess waits at reaction level until a later exact Talk quote adds the first Talk receipt and promotes it; import wording and notes are excluded from every engine map/planner context. After a round, a repeat-import prompt names only areas where the map is thin.

`POST /imports/local` persists an import the phone already processed on-device. It does not run a provider call:

```json
→ { "assistant": "Claude", "imported_at": "2026-11-04T08:30:00Z", "knows_me": "a lot|some|a little",
    "guesses": [{ "guess_id": "uuid", "label": "Keeps peace", "statement": "Part of you keeps the peace before asking for room.",
      "type": "something I do to cope", "area": "relationships", "about": null, "merge_key": "relationships:keeps-peace",
      "rating": "not|partly|very" | null, "wording": "optional owner wording" }] }
← { "import_id": "uuid", "beliefs": [Belief] }
```

Only the listed top-level and guess fields are accepted. In particular, raw answer fields (`text`, `raw_text`, `answer`, `answers`, `content`, `source_text`) and AI note fields (`note`, `ai_note`, `notes`) are rejected with `400 invalid`. `assistant` is a display source name, `imported_at` supplies the receipt date, and `knows_me` is stored with the import. Each non-null rating produces or reconciles one belief by `merge_key`; matching waiting server guesses are resolved with it. `wording`, when present, is the person's edit. `null` retires the structured guess off-map. The only import receipt exposed on a resulting belief is `{ "kind": "import", "line": "From your AI · 2026-11-04", "date": "2026-11-04" }`; it is metadata, not a quote, and no `receipts` table row is created.

`GET /imports/ai/round` is the public review route across all of the person's imports:

```json
← { "items": [
      { "item_id": "g1", "kind": "ordinary", "guess_ids": ["g1"], "sources": [{ "guess_id": "g1", "import_id": "i1", "assistant": "Claude", "date": "2026-11-04", "note": "server-held note" }], "reading": { "label": "…", "statement": "…", "type": "…", "area": "…", "about": null, "merge_key": "…" } },
      { "item_id": "g2", "kind": "merged", "guess_ids": ["g2", "g3"], "sources": [{ "guess_id": "g2", "import_id": "i1", "assistant": "Claude", "date": "2026-11-04", "note": "…" }, { "guess_id": "g3", "import_id": "i2", "assistant": "ChatGPT", "date": "2026-10-20", "note": "…" }], "reading": { "label": "…", "statement": "…", "type": "…", "area": "…", "about": null, "merge_key": "…" } },
      { "item_id": "g4", "kind": "disagreement", "guess_ids": ["g4", "g5"], "sources": [{ "guess_id": "g4", "import_id": "i1", "assistant": "Claude", "date": "2026-11-04", "note": "…" }, { "guess_id": "g5", "import_id": "i2", "assistant": "ChatGPT", "date": "2026-10-20", "note": "…" }], "readings": [{ "label": "…", "statement": "…", "type": "…", "area": "…", "about": null, "merge_key": "…" }, { "label": "…", "statement": "…", "type": "…", "area": "…", "about": null, "merge_key": "…" }] }
    ], "has_waiting": true, "score_eligible": false }
```

The first round (no rated guess yet anywhere for the person) returns 5 to 7 items: the top-ranked item from each distinct area first, at most two items per area, at least one me-lens and one others-lens item when one is available, then filled by rank. Every later round returns at most three items, preferring areas with no confirmed belief, and Keep going may request rounds until none remain. Ranking is depth, evidence, area spread (at most two items per area), then distinct-source agreement. `has_waiting` is only a boolean and never reveals a count. `score_eligible` is `true` once at least three generic-check-surviving guesses have been rated `not`, `partly`, or `very`; `not_sure` and `skip` do not count. `note` is present only for a guess held server-side; locally processed imports never send or store it. Guesses with the same `merge_key` and reading form `merged`; two or more distinct canonical sources add `agreement: { sources, line }` and a bounded confidence increase, while repeats from the same source count once. Two different readings under one `merge_key` form a `disagreement` and carry exactly two `readings`. The earlier per-import `/:id/round` GET is folded into this route and is not a public compatibility route.

`POST /imports/ai/round/answers` applies one person-wide review transaction:

```json
{ "answers": [
    { "guess_id": "g1", "rating": "not|partly|very|not_sure|skip", "wording": "optional owner wording" }
  ],
  "resolutions": [
    { "item_id": "g4", "choice": "first|second|both|neither" }
  ]
}
← { "beliefs": [Belief], "saved": 1, "has_waiting": true, "score_eligible": true }
```

Both arrays are required and may be empty, but the same guess cannot be named twice or also belong to a submitted resolution. `not_sure` retires the guess off-map; `skip` makes no change and ignores `wording`. For a two-reading disagreement, `first` rates the first reading Very me and the second Not me; `second` does the inverse; `both` rates both Very me and creates a `tension` link between their beliefs (shown as pulling against each other); `neither` rates both Not me. A resolution applies only to the exact current disagreement identified by `item_id`. Every referenced guess must still be waiting and owned by the caller. If any guess is absent, already resolved, or belongs to someone else, the route returns `404 not_found` and the transaction writes nothing. The Import feature switch guards this route, as it guards the other Import routes.

`POST /imports/ai/clear-rest` takes no body and returns `{ "cleared": true, "has_waiting": false }`. It retires every waiting import guess owned by the person across every import, then marks each affected import cleared when none of its guesses remain waiting.

## 5. Map

### `GET /map`

```json
← { "counts": { "confirmed": 12, "to_confirm": 1, "set_aside": 2, "outside_new": 1 },
    "beliefs": [ Belief ],
    "links": [ { "from": "b1", "to": "b2", "kind": "rests_on" } ],
    "area_weights": { "relationships": 3.5, "work": 1.0, "body": 0, "money": 0, "meaning": 0.6, "family": 1.5, "politics": 0, "morality": 0 },
    "areas_with_beliefs": ["relationships", "work", "family", "meaning"],
    "outside": [ OutsidePerspective ],
    "new_since_last_visit": ["b7"],
    "as_of": "…",
    "deleting": null }
```

- `deleting` is `{ "undo_until": "…" }` for the 5 seconds after "Delete my map" (the reply is then the empty map: nothing drawn, nothing removed yet; `POST /map/undo` brings it back), `null` otherwise. See §7 Data.
- `beliefs` holds every non-deleted belief (`confirmed`, `guess`, `set_aside`); the sculpture draws only `confirmed`; M07 lists all, with To confirm and Set aside sections by `status`.
- `area_weights` is the bulge input (1.5 / 1 / 0.6 per confirmed belief by kind). `new_since_last_visit` marks the diff since the previous `GET /map` (M09's check).
- Receipts are included per belief (M03/M04) with `conversation_id` and `message_id` so a tap opens the line.

### `GET /kennings` (v1.59, V3 You)

```json
← { "groups": [ { "topic": "relationships", "items": [ { "belief_id": "…", "label": "…", "wording": "Part of you …", "kind": "foundation", "area": "relationships",
                    "dated_at": "…", "status": "confirmed", "seen_by": [ { "person_id": "…", "name": "Jan", "initial": "J", "since": "…" } ] } ] } ],
    "suggested": [ same item shape, "status": "guess", "seen_by": [] ] }
```

A kenning is a belief the owner confirmed (Very me, Partly or edited; never "Not me"; same test as sharing). `groups` holds only topics that have a kenning; the topic with the newest kenning comes first, and inside a topic the newest first (`dated_at` = `confirmed_at`, else `created_at`). `seen_by` is the owner's own per-item grants (v1.52) to people still linked and active, A–Z; an empty list means no one, and a grant to a removed or blocked link is not listed. It does not list Mirror contributors (never who wrote), and `GET /map`'s `seen_by_others` stays where it is. `suggested` is guesses not yet confirmed, apart and dim (V3 rule 9), seen by no one. No receipts and no quotes here: they stay on `GET /beliefs/:id`. To change who sees an item, the existing `PUT /links/:person/share/items/:belief_id`. Read-only; marks no visit (unlike `GET /map`).

### Kenning map (v1.67, V3 You Map; migration 0060; additive; STAGING ONLY until Nami's yes)

Spec: "Kenember map and share cards: build spec" sections 2-3. Every mark is something the person said or confirmed; the engine adds no size, direction or conflict.

- `GET /kennings/map?seen_by=<person_id>` (the query is optional) → `{ layout, stations, links, set_aside, seen_by }`. `stations[]`: `belief_id, words` (own_wording else statement), `strength` ("that's me" | "partly"), `lines` (1 or 2 topics: the nine topics incl. `me`; default the belief's area), `central` (person-set only), `said_in` (months) + `said_dates`, `changed`, `earlier_wording`, `new` (confirmed under a week ago and not yet viewed), `ask_central` (Core level L0, not central, not asked: the one question), `emphasis` (1, or 0.22 for stations `seen_by` does not hold) and `show_label`. Only confirmed kennings; hidden ones (`hidden_from_map`) stay out; retired ones are in `set_aside`. `links[]`: only the person's two confirmed kinds, `both_true` (dashed) and `comes_from` ("for me, `a` comes from `b`"); with `seen_by` only links between two granted stations.
- `layout`: deterministic (same data, same picture). `lines[]` = up to 6 topics with stations, ordered so lines sharing interchanges are neighbours; `more_lines` the rest; each line has `y`, `station_ids` (max 5), `overflow_ids` (open from a tap on the line's end; the app never shows a count) and `path` (horizontal and 45-degree segments only). `stations[]` positions `{id, line, x, y, interchange}` (x at least 96 apart, 44 pt minimum). Interchanges only between adjacent lines when the station's place is consistent on both; otherwise it sits on its upper line and still lists both lines. Order on a line: the person's stored order, else engine level (L0 broad to L4 specific), then date.
- `PATCH /kennings/:id/map` `{lines?, central?, hidden?, central_asked?, seen?}`: person-set fields. `lines` 1 or 2 distinct topics (clears stored order); `central: true` also marks the question asked; `seen: true` clears `new`. Only a confirmed kenning (law 3). `PUT /kennings/order` `{line, ids}`: the dragged order on one line; always wins.
- `PUT /kennings/links` `{a, b, kind, note?}` (note 1-300 chars, for 'When is each one true?'), `DELETE /kennings/links/:id`. Both kennings must be confirmed. There is no route that creates a link from a heard 'because'; the app asks first and then calls this.
- `POST /kennings/route-card` `{belief_ids}` (1-3, confirmed): a fresh layout from only those kennings, with no links and no count. Body, politics and morality are picked by hand in the app, never preselected.
- Not built here: the 'changed' and 'earlier wording' write on `PATCH /beliefs/:id` (waits for 0060 on hosted), Instagram Ask-me link and web page (wait for Nami's law-12 answer).

### `GET /beliefs/:id`

```json
← { "belief": Belief, "connected": { "rests_on": [BeliefBrief], "holds_up": [BeliefBrief], "tension": [BeliefBrief], "same_area": [BeliefBrief] },
    "receipts": [ { "message_id": "…", "quote": "…", "conversation_id": "…", "conversation_title": "Dinner plans", "said_at": "…" } ] }
```

`BeliefBrief` = `{ belief_id, label, kind, area, birth_mood, status }`.

### `PATCH /beliefs/:id`

```json
→ { "rating": "partly" }                                  ← { "belief": Belief }
→ { "statement": "I feel like an afterthought when plans move." }   ← { "belief": Belief }
→ { "type": "a rule I live by" }                          ← { "belief": Belief }   (kind re-derived)
```

`rating: "not"` is the same as `POST /beliefs/:id/notme`. Editing the wording keeps the receipts as they were. A wording edit is the person's words: `statement` is stored as given.

v1.66: `→ { "own_wording": "I go quiet when I'm thinking." }` is 'Edit the words' (first person, 1 to 400 characters; `null` clears); it never rewrites `statement`. `→ { "rating": "very", "own_wording": "<the offered text the Y5 card showed>" }` confirms that exact text. A rating alone leaves `own_wording` as it is (null for a belief confirmed from its statement).

### `POST /beliefs` (v1.66, own kenning, F4b)

```json
→ { "statement": "Quiet means I'm thinking.", "relationship": "friend" }
← 201 { "belief": Belief, "state": "created" }
← 200 { "belief": null, "state": "safety", "resources": { "message": "…", "resources": [ … ] } }
```

The person's own typed line becomes a confirmed kenning: `status: confirmed`, `rating: very`, `source: own`, `statement` = `own_wording` = the line exactly as typed (whitespace folded), `label` "In my words", `type` "something I believe is true" (kind `foundation`), `area` from `relationship` (`family` → family, `coworker` → work, `partner`, `friend` or none → relationships). No model call; the words are never reworded or shown as an inference. One receipt row quotes the line with today's date (law 2; no conversation or message). Law 8: the keyword floor runs first; a line showing risk stores nothing and answers `200` with `state: "safety"` and resources. Empty or over 400 characters is `400 invalid` `field: "statement"`; an unknown `relationship` is `field: "relationship"`. Delete and export treat it as any belief. To show it to one person, the existing `PUT /links/:person/share/items/:belief_id`.

### `POST /beliefs/:id/notme`

```json
← { "belief": Belief, "undo_until": "…" }         (status set_aside, rating not; S13 toast with Undo)
```

### `POST /beliefs/:id/restore`

```json
← { "belief": Belief }                             (back to its previous status and rating)
```

### `DELETE /beliefs/:id`

```json
← { "deleted": "b1", "undo_until": "…" }           (gone from map and Set aside; conversations stay; restore before undo_until)
```

### `GET /outside`

```json
← { "perspectives": [ OutsidePerspective ] }
```

```json
OutsidePerspective = { "id": "o1", "label": "Keeps the peace", "statement": "People who know you describe you smoothing things over before anyone asks.",
  "summary": "People who know you describe the same shape: a room gets tense, and you are the one who finds the lighter word before anyone has to ask.",
  "people": 4, "moments": 6, "line": "From 4 people who know you, across 6 moments", "note": null,
  "variant": "new", "type": "something I do to cope", "kind": "rule", "area": "relationships", "about_belief_id": null,
  "status": "new", "rating": null, "belief_id": null, "created_at": "…" }
```

`status`: `new | rated | not_now | set_aside`. `variant`: `new` (a belief from outside) or `tension` (a different view of the belief in `about_belief_id`; `note` carries the line for the card). Rating `partly` or `very` creates a `source: mirror` belief (`belief_id` set, `seen_by_others: true`, type/kind/area/domains from the synthesis, no receipt rows); a `tension` perspective also links it to `about_belief_id` with kind `tension`. Quiet support (two or more people describing a belief already on the map) never becomes a card: the belief gets `seen_by_others` and `outside`.

### `PATCH /outside/:id`

```json
→ { "rating": "partly" }   |   { "not_now": true }        ← { "perspective": OutsidePerspective, "belief": Belief|null }
```

## 6. Bridge

### People and invites

`GET /people`

```json
← { "people": [ { "person": Person, "relationship": "partner", "shares_map": true, "i_share": { "on": false, "areas": [], "quotes": false },
                  "pinned": false, "muted_until": null, "archived": false, "status": "active" } ],
    "archived_count": 0 }
```

`status`: `active | removed | blocked`. A–Z by name for Y04.

`POST /invites`

```json
→ { }
← { "code": "K7PM3Q", "link": "https://kenember.com/i/K7PM3Q", "qr_payload": "presence://i/K7PM3Q", "expires_at": "…" }
```

A code links one person and expires 7 days after it is made (v1.62, migration 0054; 30 days before).

`GET /invites/:code` (v1.54, signed in; what the joiner sees before accepting)

```json
← { "inviter": { "name": "Lea", "initial": "L" }, "expires_at": "…" }      (404 not_found if revoked, expired, already used (v1.62), unknown or malformed; 400 invalid for your own code)
```

Read-only: it never accepts, never notifies the inviter, never marks anything, and returns nothing else about the inviter (no map, no link state). The code is case-insensitive. Migration 0051 adds the read-only function `peek_invite` (additive; the `invites` table stays owner-only). Fixture `fixtures/invites_onboarding.json`; tests `next/tests/invites_onboarding_test.ts`.

`POST /invites/:code/accept`

```json
← { "person": Person, "link_id": "…" }         (409 conflict if already linked, including a repeat accept by the person who used the code; 404 if revoked, expired or already used by someone else (v1.62))
```

The inviter's notification "Lea joined. You can bridge now." is the app's local notification on the next `GET /threads` that shows a new `active` link (`joined_at` within the last day).

### Home order (v1.58)

`GET /home`

```json
← { "order": "least_urgent_first",
    "people": [ { "person": Person, "reasons": ["unread", "invite", "checkin_soon", "open_items", "draft"],
                  "unread": 1, "open_items": 2, "checkin_at": "2026-11-12T19:00:00.000Z" | null,
                  "invite_check_in_id": "…" | null, "draft": false, "pinned": false, "muted": false,
                  "activity_at": "…" | null } ] }
```

Active links only (archived people and removed or blocked links are left out). `people` is already in stack order: **least urgent first, most urgent LAST** (nearest the thumb); the app draws it as given. A person's urgency is the highest of their `reasons`: `unread` (a ready, unopened bridge or today's plan; same number as `/threads` `badge`, or Mark unread) > `invite` (they started a check-in with you and you have not accepted) > `checkin_soon` (an accepted check-in, either direction, within 24 hours) > `open_items` (notes you parked for them, a number only) > `draft` (you have unsent words) > none. Inside an urgency: pinned people later, then later `activity_at`, then name. A muted person ranks as none, with their reasons still listed. `reasons` is empty for a quiet person. With `PRESENCE_CHECK_IN` off the check-in reasons are simply absent (this route never answers `feature_off`). Read-only: it marks nothing as seen, stores nothing, sends no push. Nothing from the other person's map or notes is read.

### Threads

`GET /threads`

```json
← { "threads": [ { "person": Person, "pinned": false, "unread": true, "archived": false, "muted_until": null,
                   "last": { "kind": "scheduled", "at": "2026-10-27T16:30:00.000Z", "text": null, "bridge_id": "…" },
                   "badge": 0, "activity_at": "2026-10-27T09:14:22.060Z", "joined_at": "…", "status": "active" } ],
    "archived": [ … same shape … ],
    "bridge_tab_dot": true }
```

`last.kind` → B01 line: `scheduled` ("Opens tonight, 8:00 PM" from `at`), `sealed` ("New bridge · opens tomorrow, 8:00 PM"), `ready` ("New bridge · ready"), `plan` ("Wants to talk about it · Sat, 11:00 AM"), `draft` (`text` = your first words), `opened` (`text` = the last opened words, from either side), `none`. `text` is `null` for every kind but `draft` and `opened`. Pick order (v1.12): your draft; else a ready bridge; else what is pending (a scheduled or sealed bridge, a planned talk: the soonest coming time first); else the latest thing that happened (opened words, a delivered bridge, by time). `activity_at` is the row's time: the latest thing that happened (sent, delivered, opened, a plan, an event, the draft), never a coming time. Sorted pinned first, then by `activity_at` desc. `badge` counts the receiver's ready, unopened bridges and today's plans; `bridge_tab_dot` is their sum over threads. `unread` is `badge > 0` or the viewer's own Mark unread.

`POST /threads/:person/mark-unread` `← { "person_id": "…", "unread": true }` (B01 swipe right). Opening `GET /threads/:person` clears it.

`DELETE /threads/:person` `← { "deleted": true, "person_id": "…", "withdrawn": ["bridge id", …], "removed": 3, "cleared_at": "…" }` (B01 More → Delete). Removes your copy only: your undelivered bridges to them are withdrawn (they see "withdrew" only if they saw the sealed bubble), and everything in the thread up to now, plus your draft, leaves your view. The link and the other person's copy stay; `last.kind` becomes `none`. No undo on the server; the alert ("removes your copy only and withdraws your undelivered bridges") is the confirmation.

`GET /threads/:person`

```json
← { "person": Person, "link": { "status": "active", "relationship": "partner", "read_receipts": true },
    "items": [ ThreadItem ], "activity_at": "…", "draft": { "text": "…", "reply_to": null, "updated_at": "…" } | null }
```

Items in time order. Bridges you sent appear as the sender sees them; bridges to you as the receiver sees them (§1.7). Opened-at under your bubble shows only when `read_receipts` is on for both: the sender's `opened_at` is `null` while either side has it off, and the row's `last` never reads `opened` for that bridge (v1.12). Reading the thread clears your Mark unread.

### Drafts

`PUT /drafts/:person` `→ { "text": "…", "reply_to": null }` `← { "draft": {…} }`; `GET /drafts/:person` `← { "draft": {…} | null }`; `DELETE /drafts/:person` `← { "deleted": true }`.

### Writing

`POST /bridge/insight` (Haiku 5.5, one call: spans and tone)

```json
→ { "person_id": "…", "text": "You always change plans last minute, so thanks for that.", "reply_to": null }
← { "state": "insight", "tone": "angry",
    "spans": [
      { "kind": "friction", "start": 4, "end": 10, "friction_kind": "absolute", "note": "Absolutes tend to land as a verdict on the person, not the moment.", "belief_id": null, "label": null },
      { "kind": "friction", "start": 38, "end": 56, "friction_kind": "sarcasm", "note": "Sarcasm reads as contempt on the other side, even when it isn't meant that way.", "belief_id": null, "label": null },
      { "kind": "belief", "start": 11, "end": 36, "friction_kind": null, "note": "This touches Afterthought on your map.", "belief_id": "b1", "label": "Afterthought" } ],
    "points": [ Point ], "line": null, "resources": null, "ref": null }
```

`state`: `insight | risk | declined`. `risk` carries `line` and `resources` (the safety sheet); `declined` (threat or abuse) carries `line: "I won't rewrite this one."`, `spans` (`kind: threat | abuse`, the parts to underline), `headline` (v1.7) and `counts: {threat, abuse}` (v1.9). Ember dots under `friction` spans, violet under `belief` spans. Text under 12 characters answers `state: "insight"` with no spans and no call.

`POST /bridge/run` (Sonnet 5.5: analyse → plan → rewrite → verify)

```json
→ { "person_id": "…", "text": "You always change plans last minute, so thanks for that.", "reply_to": null }
← { "outcome": "ok",
    "bridged": "The plan changed last minute three times this month, and I'm left feeling like an afterthought.",
    "changes": [ Change ],
    "points": [ { "kind": "complaint", "quote": "change plans last minute", "kept": true } ],
    "points_line": "Keeps your point",
    "tone": { "original": "angry", "bridged": "sad" },
    "context_note": null, "line": null, "resources": null,
    "ask_unresolved": false, "next_step": null, "ref": null, "latency_ms": 6900 }
```

- `nothing_to_change`: `bridged` = `text`, `changes: []`, `line: "This already reads clearly."`; or, when the one planned friction was an ask the words do not state, `ask_unresolved: true`, `next_step: "add_ask"`, and `line` = the vague_ask note ("This says something has to change; it does not yet say what you want them to do."). The review offers “Add what you'd like”; the app reopens the original draft with the cursor at the end. Every other outcome carries `next_step: null`. `ok` always carries a text that differs from `text` (v1.5).
- `could_not_bridge`: `bridged: null`, `line: "Couldn't bridge this one."`; the app offers Edit it myself or Send as written (S15).
- `wont_carry` (threats and abuse only; insults are bridged): `bridged: null`, `line: "I won't rewrite this one."`, `spans: [{ "start": 23, "end": 39, "kind": "threat" }]`, `headline: "One part reads as threatening."`, `counts: { "threat": 1, "abuse": 0 }` (v1.9: the app picks the headline from the counts); nothing stored server-side but the ledger and trace; `POST /bridges` with that text answers `403 forbidden` (`reason: "wont_carry"`, with `spans`, `headline` and `counts`). The words stay on the sender's phone; Talk it through (a Talk conversation with `source: "bridge_refused"`) and Edit it myself are the ways on; there is no Send as written for this outcome.
- v1.42 (E27, not on hosted): `highlights[]`, `summary` and `words_changed` on every reply that read the draft; see Changed. The rewrite itself still gets no receiver text.
- Receiver-aware rewriting is off: the run never reads the receiver's map. `points[].kept` is true for every point the critic found kept; a point with `kept: false` means `outcome` is `could_not_bridge`.
- Eval only, never the phone (E27 golden gate): `POST /eval/bridge/run` takes `{ text, relationship, sender: { name, beliefs }, receiver: { name, beliefs: [{ …, shared }] } }` (fictional maps from `next/evals/bridge_golden.json`) and answers exactly what `POST /bridge/run` answers, plus `eval: { cents, cap_cents }`. It answers `404 not_found` unless the server is not hosted (or is the staging project, the only one carrying the function secret `PRESENCE_STAGING=true`), `PRESENCE_BRIDGE_EVAL=true`, and the request's `x-presence-eval-token` equals `PRESENCE_BRIDGE_EVAL_TOKEN` (16+ characters). No auth, nothing stored, 40¢ cap per call.

`POST /bridge/reword-part`

```json
→ { "person_id": "…", "text": "You always change plans last minute…", "start": 4, "end": 10 }
← { "text": "You changed plans last minute three times this month…", "replaced": { "start": 4, "end": 11, "original": "always", "to": "changed" }, "tone": "angry", "ref": null }
```

`POST /bridge/why-it-matters`

```json
→ { "person_id": "…", "text": "…", "belief_id": "b1" }
← { "line": "Being told rather than asked lands hard for me; it makes me feel like an afterthought.", "belief_id": "b1" }
```

One line in the sender's own voice from the touched belief and its receipts; the app appends it.

### Sending

`POST /bridges`

```json
→ { "person_id": "…", "original": "…", "bridged": "…", "final": "…", "used": "bridged",
    "outcome": "ok", "changes": [ Change ], "points": [ Point ], "tone_original": "angry", "tone_bridged": "sad",
    "show_original": false, "heads_up": true, "deliver_at": "2026-10-27T16:30:00Z", "tz": "Asia/Tehran", "reply_to": null }
← { "bridge": Bridge }
```

`deliver_at: "now"` sends at once (delivered immediately, still needs opening). `final` is what the receiver will read: `bridged` when `used` is `bridged`, the original when `mine`, the sender's edit when `edited`. The server re-checks `final` with the safety floor; a threat answers `403 forbidden` with `reason: "wont_carry"`. The first schedule is when the app asks for notification permission.

`PATCH /bridges/:id` (sender, only while `opened_at` is null and not withdrawn)

```json
→ { "deliver_at": "now" }  |  { "deliver_at": "…" }  |  { "final": "…", "used": "edited" }  |  { "heads_up": false }  |  { "show_original": true }
← { "bridge": Bridge }
```

Text edits are allowed only before `deliver_at` (after delivery: `403 forbidden`, `reason: "delivered"`); time changes and send now until opened.

`POST /bridges/:id/withdraw` (sender, until opened)

```json
← { "bridge": Bridge, "receiver_sees": "withdrawn" | "nothing" }
```

`POST /bridges/:id/open` (receiver, at or after `deliver_at`)

```json
← { "bridge": { …receiver view with text… }, "opened_at": "…" }     (403 sealed with deliver_at before its time)
```

`POST /bridges/:id/remind` (receiver, on a ready bridge; B10c Remind me later)

```json
→ { "remind_at": "2026-10-27T18:30:00.000Z" }  |  { "remind_at": null }
← { "bridge": { …receiver view, ready, "remind_at": "…" }, "remind_at": "2026-10-27T18:30:00.000Z" }
```

Per viewer; the sender is told nothing. `400 invalid` for a past time, `403 sealed` before `deliver_at`, `409 conflict` once opened.

`DELETE /bridges/:id` removes your own copy only (sender after opened; receiver any time after delivery): `← { "deleted": "…" }`. Sender before it was opened: `403 forbidden` (`reason: not_opened`). Receiver before `deliver_at`: `403 sealed` with `deliver_at`, nothing changes (v1.13, A-Q16). A bridge that is not yours: `404 not_found`.

### After opening

`POST /bridges/:id/letstalk` (receiver)

```json
→ { "when": "soon" }  |  { "when": "2026-10-28T16:30:00Z" }
← { "plan": Plan }
```

`PATCH /plans/:id` (either side)

```json
→ { "when": "…" }  |  { "cancel": true }  |  { "talked": true }
← { "plan": Plan, "event": { "type": "talked", … } | null }
```

### Link settings and profile actions

`PATCH /links/:person`

```json
→ { "relationship": "partner" }  |  { "mute": "8h" | "1w" | "always" | null }  |  { "archived": true }  |  { "pinned": true }
  |  { "share": { "on": true, "areas": ["relationships", "family"], "quotes": false } }  |  { "read_receipts": false }
← { "link": { "person": Person, "relationship": "partner", "muted_until": "…", "archived": false, "pinned": false, "share": {…}, "read_receipts": true, "status": "active" } }
```

### Per-item sharing (v1.52)

`GET /links/:person/share` → `{ "person_id": "…", "items": [ { "belief_id": "…", "area": "relationships", "label": "…", "wording": "<the belief as the owner words it>", "shared": false, "shared_wording": null, "shared_at": null } ], "shared_count": 0 }`. Every belief the owner may offer (confirmed, not "Not me"), whether or not it is shared; `shared_wording` is the text this person sees. Active link required.

`PUT /links/:person/share/items/:belief_id` `→ { "shared": true, "wording": "optional, 1 to 400 characters" }` `← { "item": { "belief_id": "…", "shared": true, "shared_wording": "…" } }`. Without `wording` the belief's own text is used the first time and the earlier approved wording afterwards. `{ "shared": false }` revokes (idempotent, `shared_wording: null`). `403 forbidden`, `reason: "not_confirmed"` for a guess or a "Not me" belief; `404 not_found`, `where: "belief"` for a belief that is not the caller's; `400 invalid` for empty or over-long wording.

`GET /links/:person/share/preview` → `{ "person_id": "…", "items": [ { "item_id": "…", "area": "…", "wording": "…", "shared_at": "…" } ], "receipts": false }`: exactly what that person can read now, from the same function `GET /people/:person/map` and the Bridge read call.

`GET /links/:person/reading` → `{ "person_id": "…", "help_read": false }` (v1.57; plus `confirmed_at` when on): my switch for that person, default off. `PUT /links/:person/reading` `→ { "help_read": true }` ← the same shape; on (or 'Keep on') restarts the 30-day clock, off tells no one.

`POST /bridges/:id/reading` → `{ "available": true, "meanings": [ { "meaning": "…", "item": "<the writer's granted wording>" } ] }` (2 or 3), `{ "available": false }` for every other case, or `{ "available": false, "flagged": true, "resources": { … } }` when the safety screen flags the message. Receiver of an opened message only. Nothing is stored.

`POST /links/:person/remove` → `{ "status": "removed", "dropped": n }` (no new bridges either way; thread stays read-only for both; a `removed` event; v1.92, QA-B402: every bridge between the pair still `scheduled` and not opened is withdrawn silently, both directions, as block does; `dropped` counts them; delivered and opened rows stay; additive field, no migration, NOT deployed).

v1.93 (QA-B403, CEO GAP-1; migration 0074; NOT deployed): the `removed` event is the remover's own, written `visible_to_b = false`. The removed person's `GET /threads/:person` has no `removed` item, so no `by` and no `at` of the removal, and the thread's `activity_at` and `GET /threads` order are not bumped by it; they read only `link.status: "removed"` / thread `status: "removed"`, which is the plain not-connected state (the app stops offering Send and shows "You and [Name] aren't connected on Kenember now."). The remover still sees their own `removed` event. A removal made by account deletion keeps its visible event ("Deleted account"). Migration 0074 flips existing person-made `removed` rows to invisible. QA-B404: `DELETE /account` (delete_account, 0074) also withdraws, silently, bridges others scheduled to the deleted account that have not come due; the reply is unchanged (`withdrawn` stays the deleted person's own bridges). No new fields.
v1.94 (QA-B404, COO 17 Nov ruling (a); no migration; additive, read only; staging first): a bridge that had already come due before its receiver deleted the account is not withdrawn (it arrived). On the SENDER's rows (the thread read, `GET /threads/:person`, and the bridge lists that reuse it) whose receiver is a deleted account (`to.deleted: true`), a row that is scheduled and past `deliver_at` reads `status: "delivered"` instead of `"scheduled"`; `delivered: true` as before. Rows to live accounts are unchanged: `status` stays `"scheduled"` with the derived `delivered: true`. No stored row is rewritten. App: treat `"delivered"` as delivered on a row to a deleted person (the app already derives this for the practice partner).

v1.95 (QA-B413, P0; no migration; server behaviour only, `dropped` counts both directions): `POST /links/:person/block` now withdraws, silently, every scheduled and not-yet-opened bridge between the pair in BOTH directions, so the blocker's own sealed message to the blocked person no longer comes due or opens. Rows already delivered or opened stay as they were (the B404 ruling). The response shape is unchanged.
`POST /links/:person/block` → `{ "status": "blocked", "dropped": 2 }` (scheduled, unopened bridges between you, both ways, are withdrawn; they are not told; delivered and opened rows stay).
`POST /links/:person/report` `→ { "bridge_ids": ["…"], "reason": "…" }` → `{ "report_id": "…" }`.
`POST /links/:person/unblock` → `{ "status": "active" }`.

### `GET /people/:person/map`

```json
← { "person": Person, "areas": ["relationships", "family"], "beliefs": [ Belief ], "links": [ … ], "area_weights": {…}, "quotes": false }
```

Only the areas they share with you; `receipts` are present only when they switched "Include my own words" on; read-only. `403 forbidden` when nothing is shared.

### Practice partner (owner account only, support for app AR(2))

These two routes exist behind server switch `PRESENCE_PRACTICE_PARTNER` (default off) and an id allowlist (`PRESENCE_PRACTICE_PARTNER_OWNER_ID`, the same owner as Import from your AI by default); every other account is `403 forbidden`, `reason: "owner_only"`, and never acquires the link or sees the fixed practice-partner profile through `GET /people` or `GET /threads`. The reply text is one of six fixed fixtures per sender (never a model call, never shaped by what the owner wrote) and is sent through the ordinary `bridges` table, so it shows in the owner's thread like a real reply.

`POST /practice-partner/start { }` → `{ "person": Person }`. Idempotent: creates the one fixed practice-partner profile and an active `links` row to the owner on first call, reuses them after.

`POST /practice-partner/bridges/:id/reply { }` — the bridge must be the caller's own and not already replied to, sent either to the fixed practice partner or to one of the caller's own fictional linked people (`profiles.is_example`, e.g. the seeded Lea/Mom/Sam/Ari/Dara, already shared with the owner through `link_prefs`):

```json
← { "opened_at": "…", "reply": { "id": "…", "from": "Practice partner", "final": "Thanks for sending this. I read it and I'm glad you told me.", "reply_to": "…", "created_at": "…" } }
```

Marks the sent bridge opened, then sends back exactly one canned reply, from the practice partner's six fixtures or (for an example person) from one of six fixtures keyed by that link's `link_prefs.relationship` (partner, family, friend, coworker; any other or missing relationship falls back to the friend set). `from` names whoever actually replied. A bridge not the caller's own, sent to neither the practice partner nor one of the caller's own example people, is `404 not_found`; a second reply attempt on the same bridge is `409 conflict`, `reason: "already_replied"`.

## 6A. Check-in (E25; `PRESENCE_CHECK_IN`, default off)

Park it, the week's list, done and reschedule — the first slice of the weekly check-in app's A-Q62/A-Q68 screens (P1a–P1c) already wait on, per the CEO's 2026-11-06 priority ("Bridge is the most important thing"). The weekly slot and the shared session queue (A-Q62's fuller `Slot`/`Session` shapes) are a later item, not this one; this slice is the writer-only parked note TQ3 already built the safety and storage half of (`engine/checkin/park.ts`, `0020_parked_notes.sql`).

The feature switch is checked first on every route below: off answers `403 forbidden`, `reason: "feature_off"`. `person_id` must be an `active` link (`404 not_found`, `where: "link"` when no link exists; `403 forbidden` with the link's own status otherwise — same as Bridge). Every route only ever reads or writes the caller's own notes (`writer = me`); there is deliberately no way for the other side of the link to read them (law 10) — a parked note is private until a shared check-in session exists, which is not part of this slice.

### Objects

```json
Note { "id": "…", "person_id": "…", "text": "…", "state": "parked" | "later" | "talked", "created_at": "…", "updated_at": "…" }
```

### `POST /checkin/:person_id/notes` (Park it)

```json
→ { "text": "…" }
← { "state": "parked", "note": Note, "line": null, "resources": null }
  | { "state": "risk", "note": null, "line": "…", "resources": Resources }   (a risk sign, or a partner-harm note per TQ3/law 8; only the writer sees this; nothing is stored)
  | { "state": "declined", "note": null, "line": null, "resources": null }   (the writer's own outbound threat or abuse; nothing is stored)
```

Runs the same safety floor as Bridge (`floorSafety`) on `text` first; when that clears, the same model-based safety read Bridge's own analysis makes (`engine/bridge/analyse.ts`'s `analyse`, read only for its `safety` field — the keyword floor alone cannot read a third-person description like "my partner threatened me"). `decidePark` (`engine/checkin/park.ts`) is the single source of truth for which of the three states comes back from that safety reading, reused unchanged from TQ3: `risk` (self-risk or a partner-harm note) answers `risk`, `threat_or_abuse` (the writer's own words aimed outward) answers `declined`. `text` empty or over 4,000 characters is `400 invalid`, `field: "text"`.

### `GET /checkin/:person_id` (the week's list)

```json
← { "notes": [ Note ] }
```

Only the caller's own notes for that link: `parked` first (oldest first, so the longest-waiting note surfaces first), then `later`, then `talked` (most recent first, so a short recent history survives the swipe).

### `PATCH /checkin/notes/:id` (done and reschedule)

```json
→ { "state": "talked" }   |   { "state": "later" }
← { "note": Note }
```

Writer's own note only (`404 not_found` otherwise, same for a note that doesn't exist); any other `state` value, including `"parked"` (that only happens at creation), is `400 invalid`, `field: "state"`. "Done" marks `talked`; "reschedule" (keep for a later week) marks `later`. There is no session or queue yet to close a note from (that is the later item), so this is a direct state change on the writer's own list. v1.65: marking a parked bridge's note `talked` also closes its card at the check-in (see Changed, v1.65). v1.68: only for a note the writer brought into the open session; a note not brought changes only the writer's own list (see Changed, v1.68). v1.73: `{ "text" }` rewords it (see Changed, v1.73).

### Shared check-in session (v1.53)

```json
POST /checkin/:person_id/session                 → { "session": Session }      // idempotent; 409 conflict reason "no_check_in" if no accepted check-in
GET  /checkin/:person_id/session                 → { "session": Session | null }
PUT  /checkin/session/:id/appreciation           { "text": "…" } → { "state": "ok"|"risk"|"declined", "session": Session|null, "line": …, "resources": … }
PUT  /checkin/session/:id/said                   (no body) → { "session": Session }   // v1.63, the text-free 'said' mark
PUT  /checkin/session/:id/items/:note_id         { "bring": true|false } → { "session": Session }
PUT  /checkin/session/:id/done_bringing          (no body) → { "session": Session }   // v1.64, the text-free "Nothing else" mark
POST /checkin/session/:id/close                  → { "closed": true }          // either person; deletes every row
Session = { id, person_id, phase: "appreciations"|"items", opened_by_me, first /* v1.63 user id */, expires_at,
            mine:   { appreciation, said /* v1.63 */, brought: [{note_id, text, state /* v1.67 */}], eligible: [{note_id, text}], can_bring_more, done_bringing /* v1.64 */ },
            theirs: { appreciation, said /* v1.63 */, brought: [{text, state /* v1.67 */}], done_bringing /* v1.64 */ } }
```

Errors: `409 conflict` with `reason` `already_given` (second appreciation or mark), `not_your_turn` (v1.63: a 'said' mark before the first speaker's), `appreciation_first` (bringing before both are in), `limit` (third item, `max: 2`), `done_bringing` (v1.64: bringing after "Nothing else"), `no_check_in`; `404 not_found` for a session or note that is not yours, expired or gone (never says which); `400 invalid` `field: text` (empty or over 600 characters) or `bring`. `eligible` is only my own notes in state `later`, empty until phase `items`. `theirs.appreciation` and `theirs.brought` stay empty until phase `items`, and `brought` only lists notes still kept (a Let go or a re-park removes it at once). Fixture: `fixtures/checkin_session.json`.

### `DELETE /checkin/notes/:id` (Let go, v1.50)

```json
← { "deleted": true }
```

See v1.50 in Changed. Fixture: `fixtures/checkin_notes_letgo.json`.

### Schedule (E32; migration 0035)

One weekly check-in per owner and person (a second `PUT` replaces the first; several per person is an open app question). It holds no message text.

```json
PUT /checkin/:person_id/schedule
→ { "day": "thursday", "time": "19:00", "repeats": "weekly", "tz": "Asia/Tehran", "remind_other": true }   (repeats, tz, remind_other optional: weekly, the caller's zone, true)
← { "schedule": { "id", "person_id", "repeats", "day", "time", "tz", "remind_other", "next_at": "<ISO>" } }
DELETE /checkin/:person_id/schedule   ← { "deleted": true, "drafts": [ { "id", "person_id", "origin", "text", "created_at" } ] }   (E39: the writer's parked items come back as drafts; the other person's row leaves their list)
DELETE /checkin/dated/:id                ← { "deleted": true }       (E36: take one dated check-in off; only its owner can)
GET /checkin                          ← { "check_ins": [ { "check_in_id", "person_id", "remind_other", "day", "time", "tz", "next_at", "next_in_days", "parked", "status", "accepted_at", "moved_at", "moved_by" } ], "dated": […], "incoming": [ … ] }   (E40; soonest first; numbers only, no text: the Bridge home row "Thursdays, 7 pm · next in 3 days · 2 things parked")
GET /checkin/:person_id               ← adds "schedule": {…} | null and "parked": n beside "notes"
```

Bad `day`, `time` (`HH:MM`, 24 hour), `repeats`, `tz` (a named zone) or `remind_other` is `400 invalid` with that `field`. `next_in_days` counts calendar days in the schedule's zone (0 = today). Only the owner can read or delete a schedule; the other person has no read route.

**Where a parked item came from.** `POST /checkin/:person_id/notes` also takes `origin` (`note` default, `bridged`, `topic`) and `origin_ref` (a uuid, e.g. the bridge id; a reference, never a copy of the words). Notes echo `origin`. Anything else is `400 invalid`, `field: "origin"` / `"origin_ref"`, before the safety read.

**Next check-in as a send time.** `POST /bridges` accepts `deliver_at: "next_checkin"`; the server resolves it from the sender's own schedule with that person. No schedule is `400 invalid`, `field: "deliver_at"`, `reason: "no_check_in"`. The app may instead send the `next_at` from `GET /checkin`.

**Remind <person> too.** With `remind_other` on, within the hour before a check-in the other person's devices get one content-free push, kind `checkin_reminder` (`loc-key: PUSH_CHECKIN_REMINDER`, `category: CHECKIN_REMINDER`, `route: "checkin"`, `target_id` = the owner), once per occurrence, honouring their `notify.talk_reminders` and an active link. It carries no note text, no count and no schedule (laws 10, 11). `POST /internal/checkin/remind` (same `x-presence-push-secret` as the drain; `404` without it) queues them and is meant to be called every 10 minutes by the scheduler (not yet wired; hosted step needs Nami's yes).

### Invite and parking (E33; migration 0036)

`PUT /checkin/:person_id/schedule` now starts an **invite** (`status: "invited"`); a re-PUT of an accepted check-in keeps it `"active"`. The invited person has no reminder, count or preview until they accept (laws 10, 11).

```json
GET  /checkin/invites               ← { "invites": [ { "check_in_id", "person_id": "<who invited me>", "day", "time", "tz", "next_at" } ] }   (day and time only; no note text or count)
POST /checkin/:person_id/accept     ← { "check_in": { "check_in_id", "person_id", "status": "active", "day", "time", "tz", "next_at", "next_in_days", "parked": 0 } }   (404 not_found unless that person invited me; idempotent)
POST /checkin/:person_id/decline    ← { "declined": true }       (removes the invite; the inviter's parked notes stay)
```

**Next check-in on a bridge.** `PATCH /bridges/:id` with `deliver_at: "next_checkin"` (and `POST /bridges` with the same) sets the delivery to the sender's next check-in time with that person, sets `heads_up` to false, and parks the bridge's final words on the sender's own check-in list once (`origin: "bridged"`, `origin_ref` = the bridge id). The receiver is shown nothing and sent nothing until that time. Reply: `{ "bridge": {...}, "parked_on_check_in": true }`. Errors: `400 invalid`, `field: "deliver_at"`, `reason: "no_check_in"` (none) or `"not_accepted"` (invited, not accepted yet); `403 forbidden`, `reason: "delivered"` for a bridge already delivered. A later PATCH to any other `deliver_at`, or a withdraw, removes the parked note if it is still `parked` (notes marked talked or later stay). `heads_up` stays false after moving off the check-in unless the app sets it.

### Cards (v1.41; migration 0038)

A person's page is cards. Each message sent between two people is one card; both people see the same `state`, `state_by` ("me" | "them" from the viewer's side, `null` while never set) and `state_at`. Either person can set it: `open` (default), `kept`, `talked` ("We talked about it"), `resolved`. `talked` and `resolved` are closed; closed cards leave the main list and come back as `closed`. Not behind a flag.

```json
GET   /cards/:person       ← { "person_id", "check_in_id": "…"|null, "cards": [Card], "closed": [Card] }
PATCH /cards/:bridge_id    → { "state": "kept", "at_check_in": true /* optional, v1.63 */ }        ← { "card": Card }
Card = { "bridge_id", "direction": "sent"|"received", "text": "…"|null, "delivered": true, "opened_at": "…"|null,
         "deliver_at", "created_at", "state", "state_by", "state_at", "check_in_id": "…"|null,
         "closed_in_check_in": false /* v1.63 */, "shown": true }
```

`cards` is open and kept cards, latest first (by `created_at`); `closed` is latest closed first (by `state_at`). `shown` is the main view: the latest open or kept card and every kept one; the rest sit behind "earlier". Withdrawn or deleted messages are never cards. The sender always has their own words. The receiver has no card until the message is delivered (a message parked on a check-in or scheduled for later is not there), and `text` is `null` until they open it. A receiver cannot set the state of a card still sealed (`403 forbidden`, `reason: "sealed"`); a bridge that is not yours or does not exist is `404 not_found`; a bad `state` is `400 invalid`, `field: "state"`; no link is `404`, a blocked link `403`. `check_in_id` is the active check-in between the two people (either one started it; an invite does not count), so cards sent for a check-in belong to it; `null` with none. Fixture: `fixtures/bridge_cards.json`.

## 7. You

### `GET /me` and `PATCH /me`

```json
← { "me": { "person": Person, "preview": true, "example": false, "created_at": "…",
            "settings": {
              "voice_turns": "send_on_pause",            // send_on_pause | review_first
              "read_aloud": true,
              "start_in": "voice",                       // voice | text
              "bridge_tonight": "20:00",
              "bridge_tomorrow": "20:00",
              "heads_up_default": true,
              "show_original_default": false,
              "read_receipts": true,
              "keep_archived": false,
              "frost": true,
              "frost_after_seconds": 30,
              "notify": { "bridges_ready": true, "talk_reminders": true, "mirror": true, "talk_replies": true, "previews": false },
              "server": "hosted"                         // hosted | mac (app-side only; stored for convenience)
            } },
    "plan": { "active": true, "source": "partner", "partner_name": "Lea" },
    "ai_consent": { "required_version": "2027-01", "providers": ["anthropic"],
                    "given": { "version": "2027-01", "providers": ["anthropic"], "at": "…" } | null } }   // GET only (v1.98)
→ { "name": "Nami" }  |  { "settings": { "frost": false } }  |  { "photo": "<base64 jpeg ≤ 200 KB>" }     ← { "me": Me }
```

`PATCH` merges `settings` shallowly (send only the keys that change). `PATCH /me { "tz": "Asia/Tehran" }` sets the person's zone (v1.7; `null` clears it; a name the runtime does not know, or a bare offset, is `400 invalid`, `field: "tz"`). The zone is also learned from `X-Presence-TZ` on login and `GET /me` while the profile has none.

### AI consent (v1.98; migration 0084; built from §11.4 L6, App Store 5.1.2(i))

The person agrees, by version, that their words go to the named AI provider before any is sent. The provider list is `["anthropic"]` (voice is on-device); a change of the list or of the consent wording moves `required_version` on.

- `GET /me` carries `ai_consent` (above). `given` is the current record: the latest one not withdrawn, and only when its version is `required_version`; otherwise `null` (none, withdrawn, or behind: the app shows the consent screen again).
- `POST /consent/ai { "version": "2027-01", "providers": ["anthropic"] }` → `{ "ai_consent": … }`. Adds a row to `ai_consent (owner, version, providers, at, withdrawn_at, client_ref)` unless that exact consent is already current (a repeat adds nothing). A `version` the server does not know is `400 invalid`, `field: "version"`; a provider list other than `["anthropic"]` is `400 invalid`, `field: "providers"`. Nothing is stored on a 400.
- `DELETE /consent/ai` → `{ "ai_consent": { …, "given": null } }`: sets `withdrawn_at` on the open record; nothing else is deleted. Rows are never changed in place otherwise, so the history of what was agreed and when stays whole. `DELETE /account` removes them with everything else.
- **The gate**, always on in release; elsewhere behind `PRESENCE_REQUIRE_AI_CONSENT=true` (off in preview). Every route that can send the person's words to a model checks before its first model call and before the ledger reserve: `POST /talk/turn`, `POST /talk/finish`, `POST /bridge/insight`, `POST /bridge/run`, `POST /bridge/reword-part`, `POST /bridge/why-it-matters`, `POST /preview/mirror-sample`, `POST /comm/talk/turn` (with `text`; the opener makes no call) and `POST /comm/items` (only when the semantic safety reading is on, the one model call it makes). The list is `MODEL_ROUTES` in `next/api/lib/ai_consent.ts`; `next/tests/ai_consent_gate_test.ts` drives every entry. The Talk turns of `POST /talk/consent` and `POST /talk/edit` pass the same check.
- Without a current consent: `403 forbidden`, `reason: "ai_consent_required"`, `required_version`, and no model call. `POST /talk/turn` and `POST /comm/talk/turn` keep the person's words (`saved: true`, `message_id`, as `429 daily_limit` does), so the same text sent again once consent exists is answered once (the v1.1 retry rule; on `/comm/talk/turn` send the returned `conversation_id`). `POST /talk/finish` keeps the ratings it was sent (`saved: true`). `POST /bridge/insight` still answers a risk its local floor finds with resources (law 8), with no call. A kept `/comm/talk/turn` answer is only pending: on the consented retry the safety gate reads it first, and a stop or held reading deletes it. The gate is always on in a release deployment (`PRESENCE_RELEASE=true`); `PRESENCE_REQUIRE_AI_CONSENT` cannot turn it off there and only turns it on elsewhere (`"true"`). The database stamps a record's time and withdrawal time itself, requires `anthropic` among its providers, and keeps one open record per person and version; a record that is future-dated or does not name every current provider is not consent.
- With the switch off nothing is gated; the routes still work and store, so a preview account can give and withdraw consent to test the screens. Mirror contributors' consent (§11.4 "Mirror") is not built yet.

### Mirror (Y01, Y02, M08; thesis v3 "Mirror")

**The owner's link.** `GET /mirror`

```json
← { "mirror": { "on": true, "slug": "cber97ta67", "link": "https://kenember.com/m/cber97ta67", "who": "anyone", "paused": false,
                "approvals": [ { "id": "a1", "name": "Dara", "how_known": "friend", "since": "…" } ], "waiting": 1 } }
```

`PATCH /mirror` `→ { "on": true }` | `{ "on": false }` | `{ "who": "anyone"|"approved" }` | `{ "paused": true|false }` | `{ "question": "…" | null }` (v1.60) → `{ "mirror": Mirror }`; `Mirror.question` is the owner's question or `null`. The first `on: true` makes the slug (ten characters from `abcdefghjkmnpqrstuvwxyz23456789`); `on: true` also unpauses. Switching `who` to `anyone` processes the moments that were waiting for approval.
`POST /mirror/rotate` → a new slug; the old link answers `not_found`. `DELETE /mirror` → the link and everything pending (contributions, approvals) are deleted; perspectives that already reached the owner stay.
`POST /mirror/approvals/:id` `→ { "approve": true|false }` → `{ "mirror": Mirror }`: approve processes that person's waiting moments; decline deletes them.
`waiting` counts perspectives past the gate not yet rated ("1 outside perspective is waiting"). `approvals` is the only place a contributor's name ever appears, and never beside a moment. There is never a count of contributions, anywhere.

**Blocked perspectives (B-Q10; the privacy-safe owner list from §11.2).**

```json
GET /mirror/blocked
← { "blocked": [{ "id": "outside-perspective-uuid", "label": "Keeps an exit" }] }

DELETE /mirror/blocked/:id
← { "unblocked": "outside-perspective-uuid" }
```

The list is A–Z by the card's de-identified label. It never carries a contributor name, opaque contributor key, moment, or a count of people or contributions. `:id` is the outside perspective id; delete removes every blocked key behind that card without returning how many. A row the caller does not own is indistinguishable from a missing row (`404 not_found`). These two endpoints are built in v1.15; creating a Mirror block remains part of the §11 launch proposal.

**The contributor page (web, no app).** `GET /m/:slug` (no bearer; the HTML page when `Accept: text/html`, else this JSON)

```json
← { "open": true, "reason": null, "owner_name": "Nami", "who": "anyone",
    "prompts": ["What was happening?", "What did Nami do or say?", "What seemed to matter to Nami there?"],
    "how_known": ["partner", "friend", "family", "coworker", "other"], "how_long": ["under_a_year", "one_to_five_years", "over_five_years"],
    "preview": true, "test_friends": [{ "persona": "lea", "name": "Lea" }],
    "line": "Nami will never see your words or who you are. What several people describe may become an outside perspective on their map, which they choose to accept or not." }
```

`open: false` with `reason` `off | paused | not_found` (always `200`; the page shows one calm line). `POST /m/:slug/contributions` (bearer: the contributor's own signed-in account, one voice per account per link; in preview, `test_friend` with no bearer, the example people only)

```json
→ { "how_known": "partner", "how_long": "over_five_years", "happening": "We had friends coming and one couple cancelled an hour before.", "did": "Nami went quiet, kept cooking, and said it was fine.", "mattered": "", "name": "Lea", "test_friend": "lea" }
← { "accepted": true, "state": "done", "line": "Nami will never see your words or who you are. …", "resources": null, "ref": null, "contribution_id": "…" }
```

`moment` (one text) is still accepted in place of the three fields. `DELETE /m/:slug/contributions/:id` (same identity) → `{ "deleted": true }` (W06 Delete my answer).

`state`: `done` (used or dropped silently; the contributor is never told which); `waiting_approval` (`who` is `approved` and the owner has not approved this person yet; `name` is what the approvals list shows); `ask_moment` (`accepted: false`: the text was a label or unclear, `line` asks once for a moment; the page sends the moment as a new contribution); `concern` (`accepted: false`: the moment suggests the owner may be at risk; it is not mapped, `line` and `resources` show the contributor how to reach out themselves). Errors: `400 invalid` (`moment` under 12 or over 2,000 characters), `403 forbidden` `reason: "own_link"` (the owner on their own link) or `"closed"` (off or paused), `404 not_found` (no such slug).

**What happens inside (never shown).** Each moment goes through one Haiku call (listener, screen, mapper): it becomes a de-identified observation (situation, what the owner did or said, what followed, the contributor's guess kept separate), a theme (an open theme's key or a new one), and a match to the owner's confirmed beliefs (supports or contradicts). The raw text is deleted the moment it is processed, whatever the outcome. Names, handles, places and dates are stripped by the model and again by code. Insults, threats, sexual content and text about someone else are dropped silently; a concern for the owner's safety is not mapped (the floor runs before any call). Then the gate runs over the link's held observations: **3 / 0.7 / 2 / 3** = a new belief from outside needs three distinct people on one theme with a weighted mean confidence of 0.7 or more; quiet support for a belief already on the map needs two distinct people; a different view of a confirmed belief needs three. Near-identical submissions from one person count once; `how_known: other` weighs 0.8. Only when a decision clears the gate does one Sonnet call write the card (label of one to four words, a gentle second-person statement, type, domains, a paraphrased summary); a guard refuses a quote (a run of seven or more words from an observation), a name, a relationship word, a count, a clinical or evaluative word, advice; one repair, then the theme is held unseen until another moment arrives. Every call is an `engine_calls` row (`mirror_observe`, `mirror_observe_repair`, `mirror_synthesise`, `mirror_synthesise_repair`) on the owner's ledger line.

**What the owner sees.** A new belief from outside: an `OutsidePerspective` with `status: new` (`GET /map` `counts.outside_new`, the M08 pill, `waiting`). A different view: the same card with `variant: tension` and `note`. Quiet support: no card and no alert; the belief carries `seen_by_others: true` and `outside: {people, moments, summary}` (M04 "Seen by others"). Later moments on a theme that already surfaced only raise its counts. Mirror input never feeds Bridge.

### Never topics

`GET /never` → `{ "topics": [ { "id": "n1", "area": "body", "label": "your health", "since": "…" } ] }`
`DELETE /never/:id` → `{ "deleted": "n1" }` (Allow again).

### Data

`GET /export` → `200 application/json` attachment (`Content-Disposition: attachment; filename="presence-YYYY-MM-DD.json"`): `{ exported_at, me, conversations (with messages, summary, next_time), beliefs (with receipts, links, patch, outside), links (belief links: from, to, kind), people (person, status, relationship, sharing, since), bridges_sent, bridges_received (opened only), plans, mirror ({link, perspectives}), never, settings }`. Never engine_calls, never other people's maps, never a Mirror contribution.
`DELETE /map` → `{ "undo_until": "2026-10-27T14:00:05.000Z", "beliefs_removed": 14, "conversations_removed": 9, "outside_removed": 1 }`: a soft delete. For 5 seconds the map reads as empty (`GET /map` carries `deleting.undo_until`) and nothing is removed; the counts say what will go. A second tap inside the window keeps the first `undo_until`. The purge runs on the first request after the window, whatever the route: beliefs with receipts and links, conversations with messages (soft-deleted ones too), the outside cards and the Talk traces go; Bridge threads, the Mirror link and Never topics stay. Refused on `is_example` accounts: `403 forbidden`, `reason: "example_account"` (the seeded maps are reset by script).
`POST /map/undo` → `{ "restored": true }` inside the window (the map is whole again, nothing was lost); `{ "restored": false, "reason": "window_closed" }` when the window had closed (the map is gone; the app shows the empty map); `{ "restored": false, "reason": "nothing_pending" }` when nothing was pending. Never an error reply for a late tap.
`DELETE /account` → `{ "deleted": true, "withdrawn": ["…"], "links_ended": 2 }` (map, conversations and Mirror go; unopened bridges withdrawn; opened bridges stay with their receivers under "Deleted account"; links end; the old bearer answers `401` from then on). Refused on `is_example` accounts and on preview accounts: `403 forbidden`, `reason: "preview_account"`, so the owner cannot lose his test data by a tap; a supervisor resets it by script.

### Diagnostics

```json
POST /diagnostics
→ { "ref": "7F3K", "kind": "crash" | "hang", "release": "0.9 (55)", "report": { "crashDiagnostics"?, "hangDiagnostics"?, "timeStampBegin"?, "timeStampEnd"? } }
← { "ok": true, "ref": "<row ref>" }
```

One `errors` row (`source: "client"`, `code: "client_crash"` or `"client_hang"`, `where_: "metrickit"`), with `release` and `report` (jsonb). `ref` is 4 characters of the Ref alphabet (lowercase is read as upper), made on the phone; it is the row's Ref when free, else the row takes a new Ref and keeps the phone's in `client_ref`. Idempotent on `ref` + person + kind: a resend returns the same `ref` and writes nothing. A report over 200,000 characters of JSON is kept as `{ "truncated": true, "original_chars": n, "head": "…" }`, never refused. Bad fields are `400 invalid` with `field` (`ref`, `kind`, `release`, `report`). Signed-in bearer only; no call stack or report is ever shown to anyone but the owner's error lookup.

### Communication items (v1.96; behind `PRESENCE_COMM_ITEMS`, owner-only, migrations 0069 then 0075; staging first)

- `GET /comm/items`: the owner's items, This week on top, then the kinds in the You order; see the v1.85 note at the top for the rules.
- `POST /comm/items`: add one item the person typed or said in Talk, with one receipt; never from inference.
- `PATCH /comm/items/:id`: re-word, re-scope, set aside, or confirm "still true"; every rule is re-checked.
- `DELETE /comm/items/:id`: delete one item.
- `GET /comm/map`: confirmed live communication items as kind lines and the equal List stations; never a topic/subway map.
- `PATCH /comm/items/:id/map`: store only the owner's Map display fields `{hidden?,show_separately?}`.
- `GET /comm/items/:id/visibility`: live per-linked-person audience through pair context.
- `GET /comm/card-items`: eligible local card-maker items; no card, selection, or share record is stored.
- `GET /comm/eligible-items?surface=card|ask`: the canonical eligibility projection for card surfaces and Ask me presets; Ask reply includes the fixed moment question and adults-only marker.
- `GET /comm/suggestions`: the next three carry-over suggestions for old kennings (v1.86; migration 0071 first), words and kind only.
- `POST /comm/suggestions/:id`: accept ("That's me") or dismiss one suggestion; sharing never widens.
- `POST /comm/talk/turn`: one Talk turn on the question bank (v1.87): the opener without text, an answer with it; one checked model call; at most one item offered, never stored here.

## 8. Notifications (app-scheduled, from these replies)

| Event | From | Schedule |
|---|---|---|
| A bridge reaches its time (receiver) | `GET /threads` items with `sealed: true` or `ready` and `deliver_at` | local notification at `deliver_at`: "A bridge from Nami is ready" |
| Remind me later (receiver) | the ready view's `remind_at` (set by `POST /bridges/:id/remind`) | the same notification again at `remind_at`; cancelled when the bridge is opened |
| Someone wants to talk (sender) | `GET /threads/:person` plan with `proposed_by` ≠ me, seen first time | at once |
| A talk time arrives (both) | `plan.when` | at `when` |
| Your reply is ready | `pending_reply` resolved while the app was closed | at once, only if closed |
| An outside perspective passed the gate | `GET /map` `counts.outside_new` > 0 | at once |
| An invite is accepted | `GET /threads` new active link | at once |

Today all six rows are app-scheduled local notifications. Proposed §12 moves only bridge ready, Remind me later and Your reply is ready to APNs when a registered token is available; it adds no seventh event and keeps the local schedule as the offline fallback.

## 9. Ledger and trace

- Every engine call reserves in `usage_ledger` first (worst case), then settles the measured cost. Caps: 3,000¢ a day for everyone together; the owner's preview account may run 500¢ past it; 20,000¢ in total including everything spent before this API existed. A refused reserve is `429 daily_limit` with `opens_at` = the next 00:00 UTC, never a crash; a feature switched off (v1.42) is `503 ai_off`. Each settled row records `model` and `release` (git sha@date of the deploy).
- Every engine call is one row in `engine_calls`: person, purpose (`turn | repair | finish | insight | analyse | rewrite | verify | reword | why | mirror_observe | mirror_observe_repair | mirror_synthesise | mirror_synthesise_repair`), model, the package sent, the raw reply, tokens, cents, latency, Ref. The app never shows it. The `mirror_observe` and `mirror_observe_repair` rows carry the package with the moment as written replaced by its length and hash (v1.8); no raw contribution text survives processing anywhere.
- Models: Talk turn and Finish on `claude-sonnet-5-5`; Bridge run on `claude-sonnet-5-5`; insight on `claude-haiku-5-5`; Mirror observe on `claude-haiku-5-5`, Mirror synthesis on `claude-sonnet-5-5`.

## 10. Open questions (in `outputs/engine/QUESTIONS.md`)

- Q61: the reading of the gate "3 / 0.7 / 2 / 3" (new: three people at 0.7; support: two; different view: three) and the contributor sign-in in preview (any signed-in account, one voice per account per link).
- Q66: three readings in the §11 launch proposal (a reported Mirror card set aside at once; a Mirror block by hashed contributor key, kept across rotate and delete; the L6 gate holding moments about an owner without consent).

Answered (in `outputs/engine/ANSWERS.md`): Q63 → COO 17:30 (both readings right; `DELETE /map` soft-deletes with a 5-second undo, v1.10); Q64 → COO 17:30 (the Mirror page from 8821 in preview, real hosting later); Q65 → COO 17:30 (the 38 rows scrubbed in place); Q53 → A53 (eight areas, the fold in §1.3, the owner's decision); Q54 → A54 (Nami starts with no seeded beliefs; the example people carry cast maps); Q55 → A55 (ledger day UTC; `opens_at` shown in local time); Q56 → A56 (every preview account tags `owner_preview`); Q59 → A59 (one Postgres ledger); Q60 → A60 (length bound 1.8 under 30 words).

## 11. Proposed for launch (except the v1.15 blocked-perspective list/unblock; COO 21:50 10-27, item 8; CEO directive d-coo-mirror-launch)

**Status: proposal, except where a Changed line says built.** Read with `docs/LAUNCH-REQUIREMENTS.md` (root checkout). These are launch requirements for the App Store submission (late January 2027), not prototype gates: the preview build keeps working without them, every flag below is off in preview. Each item lands with its own Changed line and migration; the shapes below are what the app lane can plan against. v1.15 built only the privacy-safe blocked-perspective list and unblock routes needed by Y02; creating a block is still proposed. L1 (the owner's 18+ gate in onboarding), L4 (the published address) and L7 (the AI disclosure line and S07) are the app's; where the API can carry a value for them it is noted in one line. Order: Bridge on both sides first (COO 17:40), then L6 and L2, then L3, then L5 at the release build.

### 11.1 L2 — the contributor's 18+ attestation (Mirror web)

The W01 line already says 18+; the attestation becomes a stored fact, per contributor per link, carrying no identity (the hashed contributor key, a version and a time: thesis, contributor privacy).

- `GET /m/:slug` JSON gains `attestation: { "version": "2027-01", "line": "I confirm I am 18 or older." }` (the copy is the CDO's; the version is bumped only when the wording changes in substance).
- `POST /m/:slug/contributions` takes `adult: true` and `attestation_version: "2027-01"`. Stored on the row as `adult_attested_at` and `attestation_version` (migration: two columns on `mirror_contributions`; the service-side `mirror_attestations (link_id, contributor_key, version, at)` row lets the page skip the gate on a return visit through `GET /m/:slug` → `attested: true` when the bearer or test friend already attested on this link).
- Missing or `false` once the item is built: `403 forbidden`, `reason: "adult_attestation"`, nothing stored, no model call. The preview test-friend path sends `adult: true` from the page like any contributor, so the preview keeps working.
- Never surfaced: the owner's `approvals` list and every card stay as they are; an attestation is never shown and never counted anywhere the owner can read.
- L1, the owner's own gate, is the app's screen; if the app wants the fact stored, `PATCH /me { "adult": true }` → `profiles.adult_attested_at` (one column), and `Me` carries `adult_attested: true | false`. With the L6 flag on, the model-call gate (11.4) also requires it.

### 11.2 L3 — Report and Block, one shape for Bridge, Mirror and the person

Today: `POST /links/:person/report` (bridges) and `POST /links/:person/block` (§6, built). They stay as they are; the two general endpoints below sit beside them, and the link ones become aliases once built.

`POST /report`

```json
→ { "kind": "bridge" | "person" | "outside",
    "person_id": "…",                  // bridge, person
    "bridge_ids": ["…"],               // bridge (optional, the ones they mean)
    "perspective_id": "…",             // outside: the card on the owner's map
    "reason": "threat" | "abuse" | "harassment" | "impersonation" | "underage" | "sexual" | "other",
    "note": "…" }                      // optional, 500 characters at most
← { "report_id": "…", "ref": "7F3K" }
```

- Stored in `reports` (existing table, widened: `kind`, `perspective_id`, `reason_code`, `note`, `status: open | reviewed | closed`, `client_ref`). `kind: outside` keeps the perspective id and, service-side only, the contribution rows behind it; the contributors' names are never on the row (the owner never learned them: law 12) and never leave the service role.
- What happens at once, before any review: a reported outside card is set aside (`status: set_aside`, `set_aside_reason: reported`; it leaves `GET /map` and `counts.outside_new`, `GET /outside` still lists it) and its theme is frozen: new moments on that theme are accepted on the page as always (the contributor is never told) and held, never surfaced, until a person reviews the report. A reported bridge or person changes nothing by itself; Block is the action with teeth.
- The reporter's own list: `GET /reports` → `{ "reports": [{ "id", "kind", "reason", "status", "created_at" }] }` (no names, no text), so the app can show "Reported" on the card or thread.
- Review is out of the app: a service-only view (`reports` joined to the trace) and a daily digest of open reports to the published safety address (L4). No moderator endpoint in the API; a person works from the dashboard with the service role. Every row carries a `ref` (`errors` row, source `report`), so a screenshot's Ref can be looked up as with `X-Client-Ref` (v1.3).

`POST /block`

```json
→ { "person_id": "…" }                       // a linked person: as /links/:person/block today (their scheduled bridges to you are dropped; they are not told)
  | { "perspective_id": "…" }                // a Mirror card: the contributors behind it are blocked from this link, without naming them
← { "status": "blocked", "dropped": 1 }      // person
  | { "status": "blocked", "held": 2 }        // perspective: the moments behind it that were still counting are set aside
```

- A Mirror block works on the hashed contributor keys behind the card (`mirror_blocks (owner, perspective_id, contributor_key, created_at)`, service-only; the table is built in v1.15): their later submissions on this link are accepted on the page and dropped (`dropped_reason: blocked`; the page shows `state: done` as for any other outcome), their held moments leave the gate, and the card itself is set aside as under Report. Rotating the link (`POST /mirror/rotate`) keeps the blocks (the keys are per owner, not per slug); `DELETE /mirror` keeps them too, so a re-made link does not readmit them. The owner is never shown how many people a block covers.
- `POST /unblock { "person_id" }` for a person, as `/links/:person/unblock` today. A Mirror block is lifted only from Settings › Mirror › Blocked perspectives: v1.15 builds `GET /mirror/blocked` and `DELETE /mirror/blocked/:id` as specified in §7. The list shows only the card id and label, never a name or a count of people.
- `DELETE /account` deletes the person's reports and blocks as it deletes everything else of theirs (v1.4); a report filed against a deleted account stays for review with the reported side anonymised.

### 11.3 L5 — never a fake or teaser message; the release build has no Example data

The engine rules already hold and are restated here as the release contract; the new part is the release switch.

- **Rules that hold today, kept as law.** No card is written before the gate (3 / 0.7 / 2 / 3), so no "someone said…" can exist without several people behind it. No reply carries a count of contributions anywhere (`waiting` counts perspectives past the gate; `approvals` is a list of people who asked, never a count of moments). The only Mirror notification the app schedules is "An outside perspective passed the gate" from `counts.outside_new` (§8), with no content and never from a single contribution; `POST /m/:slug/contributions` never changes anything the owner can read before the gate. The hosted and Mac bases run the same code; neither has a route that writes a card without the gate except `POST /preview/mirror-sample`, which is preview-only (`403 preview_only` on a real account) and runs the same gate over the example people's moments.
- **The release switch.** A function setting `PRESENCE_RELEASE=true` on the release deployment (off in preview, never set on 8821): `POST /preview/login`, `GET /preview/spend` and `POST /preview/mirror-sample` answer `404 not_found`; `GET /m/:slug` answers `preview: false` and `test_friends: []` whatever the owner's profile; `test_friend` on a contribution is `401`; `is_example` and `is_preview` profiles are excluded from every listing (`/people`, `/threads`, invites, `GET /people/:person/map`, receiver lookups) and from every seed; `Me` carries `environment: "release"` (`"preview"` today) so the app hides Switch account and the DEV row. Recommended beside the switch: the release build points at its own Supabase project, seeded by the migrations alone with no example rows and no preview password, so there is nothing to strip; the switch is belt and braces for the day a preview URL reaches a release phone.
- **Teaser text.** No reply in §2–§7 is allowed to carry text meant for a notification before the gate, and none does; the §8 table is the whole list of app-scheduled notifications and every row names the reply field it comes from. A new notification needs a new row there and a Changed line.

### 11.4 L6 — consent naming the AI providers, stored with a version, and the model-call gate

Built in v1.98 as §7 "AI consent", except the Mirror contributor's part below.

Apple 5.1.2(i): a user is told which third parties receive their data and agrees before anything is sent. Today the API sends user text only to Anthropic (`claude-sonnet-5-5`, `claude-haiku-5-5`, §9). Voice is on-device (the app uses Apple speech; the web page uses the browser's own speech recognition); no audio or transcript goes to OpenAI or any other provider, so the provider list is `["anthropic"]` until that changes, and a change bumps the version. The existing `consent` table is the per-area Talk consent (§1.5) and is not reused.

- `GET /me` gains `ai_consent: { "required_version": "2027-01", "providers": ["anthropic"], "given": { "version": "2027-01", "providers": ["anthropic"], "at": "…" } | null }`. `given` is the current record; `null` when none, or when the record's version is behind `required_version` (then the app shows the screen again).
- `POST /consent/ai { "version": "2027-01", "providers": ["anthropic"] }` → `{ "ai_consent": … }`. Stored in `ai_consent (owner, version, providers text[], at, withdrawn_at, client_ref)`; a new version adds a row and the old one stays as history (never updated in place, so the record of what was agreed and when is whole). A `version` the server does not know is `400 invalid`.
- `DELETE /consent/ai` → `{ "ai_consent": { …, "given": null } }`: sets `withdrawn_at`; from then on the gate refuses model calls until a new consent is given. Nothing else is deleted (the map stays; Data in §7 is how the person leaves).
- **The gate, always on in release; elsewhere behind `PRESENCE_REQUIRE_AI_CONSENT=true` (off in preview).** One check in the engine funnel, before the ledger reserve, on every route that sends the person's words to a model: `POST /talk/turn`, `POST /talk/finish`, `POST /bridge/insight`, `POST /bridge/run`, `POST /bridge/reword-part`, `POST /bridge/why-it-matters`, and `POST /preview/mirror-sample`. Without a current consent: `403 forbidden`, `reason: "ai_consent_required"`, `required_version`, and no model call; on `/talk/turn` the person's row is still saved (`saved: true`, `message_id`, as `429 daily_limit` does), so the text is not lost and the same text with the same `conversation_id` is answered once consent exists (the v1.1 retry rule). Never a crash, never a silent drop.
- **Mirror.** A contributor's words go to a model too, so the web page shows the same consent before the first submission (L6, "Mirror contributor before first submission"): `GET /m/:slug` gains `ai_consent: { "required_version", "providers" }`, `POST /m/:slug/contributions` takes `ai_consent_version` (stored on the row beside the attestation; with the flag on, missing or behind → `403 forbidden`, `reason: "ai_consent_required"`, nothing stored). The owner's side is covered by their own record: with the flag on, moments about an owner whose consent is missing or withdrawn are held (`status: pending`, nothing processed, the page still says `done`) until the owner consents, then processed; the owner turning Mirror on is already behind onboarding, so in practice the record exists.
- With the flag off (preview) nothing changes: the endpoints work and store, the gate is not applied, and the owner's preview account can give and withdraw consent to test the screens.

### 11.5 Not in this proposal

- L1 beyond the one stored column; L4 beyond `GET /m/:slug` and `GET /me` carrying `support_address` (one string, from a function setting) if the app wants it from the server rather than its own copy; L7 entirely (the disclosure line and its cadence are the app's; S07 is built).
- A moderator API, an appeals channel, automated takedowns: a person reviews from the dashboard; the API only records, sets aside and holds.
- Real sign-in on the web page (Apple and Google) and the page's real host (COO ask coo-ask-2026-10-27-mirrorhost): outside this lane until decided.

## 12. APNs push sender (v1.16; Apple paid-team A4)

**Status: v1.16 ready.** Migration 0011, device routes, the protected drain, token-based signer and fake-APNs tests are built. The `.p8` is installed only as a hosted function secret by `next/scripts/set_function_secrets.py`; it is never printed or committed. No real APNs request is made until the app registers a device.

The goal is delivery, not new product behaviour. The six events and their routes in §8 remain the whole notification list. APNs carries three of them when possible:

```
bridge_ready | bridge_reminder | talk_reply_ready
```

The other three §8 events stay local in v1.16. For these three events, local notifications remain the fallback when remote-notification permission or device registration is unavailable. Once registration succeeds, APNs owns those events and the app does not schedule a duplicate local alert; APNs stores and retries while the phone is offline.

### 12.1 Register and remove an APNs device

`installation_id` is a random UUID made once per app installation and kept in the Keychain. A token change, account switch or reinstall calls the same idempotent route. TestFlight uses `production`; a development-signed build uses `sandbox`.

`PUT /devices/apns`

```json
→ { "installation_id": "8b2a5d6b-8c7e-46fa-92da-82027669fcb2",
    "token": "<64-or-more lowercase hexadecimal characters>",
    "environment": "production",
    "bundle_id": "com.namidavoodzadeh.presence",
    "locale": "en-US" }
← { "device": {
      "id": "cfe669d7-0dc4-4a07-b4a8-e5fd8fbe2af7",
      "installation_id": "8b2a5d6b-8c7e-46fa-92da-82027669fcb2",
      "environment": "production",
      "bundle_id": "com.namidavoodzadeh.presence",
      "locale": "en-US",
      "enabled": true,
      "registered_at": "2026-10-28T08:30:00.000Z",
      "last_seen_at": "2026-10-28T08:30:00.000Z"
    } }
```

- `token` is the bytes from `didRegisterForRemoteNotificationsWithDeviceToken`, encoded as lowercase hex with no spaces or brackets. It is write-only: no API reply, export, log, trace or Ref detail contains it.
- The upsert key is `(owner, installation_id)`. In the same transaction, any other row with the same `(environment, bundle_id, token_hash)` is disabled before this row is enabled. This prevents a token left by a preview-account switch from receiving the new account's pushes.
- `locale` is a BCP 47 tag, used only to choose an APNs localization key. v1.16 supports `en-US`; an unknown but well-formed locale stores as given and falls back to `en-US`.
- Errors: `400 invalid` with `field: "token" | "installation_id" | "environment" | "bundle_id" | "locale"`; `401 unauthorized` as in §0. Registration never makes an APNs request, so APNs being down cannot make this route fail.

`DELETE /devices/apns/:installation_id`

```json
← { "removed": true, "installation_id": "8b2a5d6b-8c7e-46fa-92da-82027669fcb2" }
```

The route is idempotent (`removed: true` even when already absent) and cancels unsent events for that installation. The app calls it before sign-out or preview-account switch while the old bearer still works. `DELETE /account` removes every device and pending push event for the account. A 410 `Unregistered` reply from APNs disables the matching row without deleting audit timestamps.

### 12.2 Tables and RLS

`device_tokens` is additive:

```
id uuid primary key
owner uuid not null references profiles(id) on delete cascade
installation_id uuid not null
token text not null
token_hash text not null
environment text not null check (environment in ('sandbox','production'))
bundle_id text not null check (bundle_id in ('com.namidavoodzadeh.presence','com.namidavoodzadeh.presence.qa'))
locale text not null default 'en-US'
enabled boolean not null default true
registered_at timestamptz not null default now()
last_seen_at timestamptz not null default now()
invalidated_at timestamptz null
created_at timestamptz not null default now()
unique (owner, installation_id)
unique (environment, bundle_id, token_hash)
```

`push_events` is the service-side outbox:

```
id uuid primary key
owner uuid not null references profiles(id) on delete cascade
device_id uuid not null references device_tokens(id) on delete cascade
kind text not null check (kind in ('bridge_ready','bridge_reminder','talk_reply_ready'))
subject_id uuid not null
route_target_id uuid not null
due_at timestamptz not null
state text not null check (state in ('pending','sending','sent','cancelled','retry','failed'))
attempts integer not null default 0
next_attempt_at timestamptz not null
apns_id uuid null
last_status integer null
last_reason text null
sent_at timestamptz null
cancelled_at timestamptz null
created_at timestamptz not null default now()
unique (owner, kind, subject_id, device_id)
```

Both tables have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. They have no `anon` or `authenticated` policies: the raw token, queue and APNs result are service-only. The authenticated person acts only through the owner-scoped routes in §12.1; the Edge function validates the bearer before using its service role. The migration grants no table privileges to `anon` or `authenticated`. The service role may select only the columns the sender needs. Neither table appears in `GET /export`, `engine_calls`, Mirror, a linked person's reads, or any receiver function.

The token is a transport address, not notification content. It is stored only because APNs requires it; Postgres encryption at rest, RLS and service-only access protect it. Logs use `token_hash` (SHA-256) at most, never `token`.

### 12.3 When events are queued, cancelled and deduplicated

The database rows that already define product state remain authoritative. A push is only a wake-up hint; opening it always fetches the route and accepts that the item may have changed.

| Kind | Queue | Cancel | Preference and route |
|---|---|---|---|
| `bridge_ready` | In the same transaction as `POST /bridges`/`PATCH /bridges/:id`, one event per enabled receiver device, `due_at = deliver_at` | withdraw, block, account deletion, or the receiver opening before the event is claimed | `notify.bridges_ready`; opens the sender's thread with the bridge ready (B11) |
| `bridge_reminder` | `POST /bridges/:id/remind` upserts one event per enabled receiver device, `due_at = remind_at` | `remind_at: null`, a changed reminder replaces the old due time, open, withdraw, block or account deletion | `notify.talk_reminders`; opens the same ready bridge |
| `talk_reply_ready` | In the same transaction that stores a Presence reply, one event per enabled owner device, `due_at = now()` | deleting the conversation/account before claim; otherwise it may send | `notify.talk_replies`; opens the conversation |

If the relevant preference is false, no event is queued. Turning it off cancels matching pending/retry rows. Registering a device does not backfill old events. A new token receives only events created after registration.

`talk_reply_ready` is queued even when the request connection is still open: iOS suppresses it in the foreground, and presents it only when the app is closed or backgrounded, matching §8. The unique key makes a retried turn or reply write produce no second push. Ready and reminder use the same APNs collapse id (`bridge:<bridge id>`), so a reminder replaces a stale ready alert instead of stacking. Talk uses `talk:<conversation id>`.

### 12.4 Exact APNs payloads

All visible words are fixed strings in the app's `Localizable.strings`; APNs receives localization keys, not rendered copy. `previews: false` and `previews: true` use the same content-free payload in v1.16. The app fetches current names and state after the tap. No payload contains a sender or receiver name, Bridge or Talk text, original or bridged words, a quote, tone, feeling, length, word count, `used`, `show_original`, belief/card/receipt data, Mirror data, or model output.

Bridge ready:

```json
{ "aps": {
    "alert": { "title-loc-key": "PRESENCE_TITLE", "loc-key": "PUSH_BRIDGE_READY" },
    "sound": "arrived.caf", "category": "BRIDGE_READY", "thread-id": "presence.bridge"
  },
  "presence": { "v": 1, "event": "bridge_ready", "event_id": "…",
                "route": "bridge_thread", "target_id": "<linked-person uuid>" } }
```

Receiver reminder:

```json
{ "aps": {
    "alert": { "title-loc-key": "PRESENCE_TITLE", "loc-key": "PUSH_BRIDGE_REMINDER" },
    "sound": "default", "category": "BRIDGE_READY", "thread-id": "presence.bridge"
  },
  "presence": { "v": 1, "event": "bridge_reminder", "event_id": "…",
                "route": "bridge_thread", "target_id": "<linked-person uuid>" } }
```

Talk reply ready:

```json
{ "aps": {
    "alert": { "title-loc-key": "PRESENCE_TITLE", "loc-key": "PUSH_TALK_REPLY_READY" },
    "sound": "default", "category": "TALK_REPLY_READY", "thread-id": "presence.talk"
  },
  "presence": { "v": 1, "event": "talk_reply_ready", "event_id": "…",
                "route": "conversation", "target_id": "<conversation uuid>" } }
```

The English app strings are `Presence`, `A bridge is ready`, `A bridge reminder`, and `Your reply is ready`. This deliberately omits the linked person's name from the design package's local preview copy: A4's no-content rule wins for remote payloads. Once the app fetches the route it shows the normal B11/thread copy. The two `target_id` values are opaque UUIDs used only to route after unlock; they disclose no words. App icon badge is omitted from the payload because the app computes it from ready bridges (§8).

`aps.sound` names `arrived.caf` only for `bridge_ready` (CDO craft pass v1, "Sounds": arrived plays only for a Bridge-ready push). Every other kind — the receiver reminder and the Talk reply — keeps `"default"`; no other notification names a sound. The app ships `arrived.caf` in the bundle; the engine only writes the filename into the payload and does not generate or own the audio asset.

APNs headers are exact: `apns-topic` is the registered approved bundle id (`com.namidavoodzadeh.presence` or `.qa`), `apns-push-type: alert`, `apns-priority: 10`, `apns-collapse-id` as above, and `apns-expiration` = Unix time 24 hours after `due_at`. The sandbox host is `api.sandbox.push.apple.com`; production/TestFlight is `api.push.apple.com`.

### 12.5 Sender, scheduler and secret boundary

The `api` function is the only APNs client. A one-minute Supabase `pg_cron` job calls the service-only `POST /internal/push/drain` through `pg_net`; its URL, anon gateway key and drain credential are resolved from Vault at run time and do not appear in `cron.job`. The call is authenticated by a separate `PUSH_DRAIN_SECRET` also kept in function secrets; no user bearer can call it. It claims a bounded batch with `FOR UPDATE SKIP LOCKED`, marks rows `sending`, sends once per enabled device, then records only APNs id, status and reason. Product-state correctness does not depend on the job, and local notifications remain the fallback.

```json
POST /internal/push/drain
→ { "limit": 100 }
← { "claimed": 3, "sent": 2, "retried": 1, "disabled": 0, "failed": 0 }
```

This is the one service-only exception to §0's bearer rule. Without the drain secret it answers `404 not_found`, not an API Ref. As built (`next/api/push.ts:279-282`): when the `X-Presence-Push-Secret` header is missing or differs from `PUSH_DRAIN_SECRET`, or `PUSH_DRAIN_SECRET` is not set, the reply is `404` with the body exactly `{ "error": "not_found" }`, with no `ref` and no `message`, and the body is not read. The handler returns this reply instead of raising, so **no `errors` row is written and there is no ref**; this is an exception to §0's "always this shape" and "every error reply is also a row in `errors`". This slice adds only the due-event drain; it does not add a keep-warm or unrelated cron.

APNs provider authentication is an ES256 JWT with `kid = APNS_KEY_ID`, `iss = APNS_TEAM_ID`, and `iat` no more than 50 minutes old. The function caches the signed provider token for at most 45 minutes. Runtime secrets are `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, and `PUSH_DRAIN_SECRET`.

`supabase_env.py` reads `APNS_KEY_ID` from `~/Library/Application Support/PresenceHome/secrets/asc.env`, locates only the matching `AuthKey_<id>.p8`, and hands it in memory to `set_function_secrets.py`. The script posts it to function secrets without echoing it, putting it in an argument list, writing a repo file, or logging command tracing. The `.p8` is never sourced as a shell file and the sender never reads the secrets folder directly. `APNS_TEAM_ID` is fixed to `UK39PYVJ96`.

APNs `200` marks sent. `410 Unregistered` or `400 BadDeviceToken` disables the device and cancels its pending rows. `429`, `500` and `503` move the row to `retry` with bounded exponential backoff and jitter, never past `apns-expiration`; other permanent 4xx replies mark `failed`. Retries use the same event id and collapse id. A failure never changes Bridge/Talk state, never returns an error to the person, and never prevents the local fallback. `errors.detail` and function logs may carry event id, kind, status and APNs reason; they never carry the device token or payload.

### 12.6 Build and verification gate

Verification covers the additive migration and RLS assertions, device validation, queue/cancel/dedupe rules for all three events, payload snapshots proving content is absent, and fake-APNs signing/host/header behavior. A sandbox device registration and one push of each kind follow when the app registers its real token. Production/TestFlight APNs is not contacted until the app's production entitlement and bundle id are active. The trace report records event ids and APNs statuses only.

Laws kept by this design: law 8 state remains authoritative and no risk text is pushed; law 10 content and tokens remain owner-scoped and service-only; laws 11–12 get no new Mirror event or payload. The CDO's six-notification limit remains six.

## 13. Tester reports

`POST /feedback` (COO 12:30 10-31) takes a signed-in account's bearer, or, for a tester with no Presence account, the shared `X-Presence-Tester-Token` header (matched against function secret `PRESENCE_TESTER_TOKEN`); neither credential answers `401 unauthorized`. One of the two is required; the router does not apply its own bearer check on this route.

```json
→ { "report_id": "…", "body": { "note": "…", "screen": "…" }, "screenshot_base64": "…" }
← { "feedback": { "id": "…", "report_id": "…", "created_at": "2026-10-31T10:34:33.791Z" } }
```

`report_id` is the client's own idempotency key: resubmitting the same id replaces the row and the stored image (`on conflict (report_id)`), never duplicates it. `body` is any JSON object the tester form collects (note, screen, severity, app version, …): never a Talk, Bridge or Mirror quote. `screenshot_base64` (optional from v1.71; absent, null or empty means no screenshot) is a JPEG, base64-encoded, at most 2 MB decoded (the "feedback" storage bucket enforces the same cap and `image/jpeg` only); anything else answers `400 invalid` with `field: "screenshot_base64"`. The screenshot is stored at `<reporter id or "tester">/<report_id>.jpg` in the private `feedback` bucket; the row (`reporter` null for a tester-token submission) and the object are service-role only, never exposed through PostgREST or a public URL.

`next/scripts/pull_feedback.py` moves every unpulled row (`pulled_at is null`) into `outputs/qa/inbox/<the day it ran, UTC>/<report_id>.jpg` and `.json` (id, reporter, body, created_at; never the screenshot's bytes re-encoded or altered) for verify to triage into `outputs/qa/BUGS.md`, then marks each row pulled. Re-running pulls only what is still unpulled; nothing is deleted from `feedback` by the pull.

— Engine

## 14. Unreadable safety reading (PSY 16 Nov 2c-2f; additive, behind the same PRESENCE_SAFETY_SEMANTIC switch)

When no reading said stop, at least one could not answer (error, timeout, provider cap, global ceiling, unparseable reply) and the keyword floor was silent, the route stores, sends and maps nothing and answers with `state: "unavailable"` in its own shape (never `safety`, `flagged`, `concern` or an error card):

`{ state: "unavailable", line: "Couldn't read that just now. Nothing was sent or saved. Try again in a moment.", action: "Try again", help: "Need to talk to someone now?", resources: {...}, ...the route's own empty fields }`

`help` opens the same resources sheet (`resources` is in the body). `Try again` is a new request and a new read; the server never retries by itself. Routes: the import routes under `/import/` (guesses [], import_id null), `POST /bridges` and `PATCH /bridges/:id` (ApiError `unreachable` with `reason: "unread"` and the same fields), `POST /bridge/reword-part`, `POST /bridge/why-it-matters`, the check-in note route `/checkin/notes`, `PUT /checkin/session/:id/appreciation` (note/session null), the Reading route (`available: false`), `POST /beliefs` (`belief: null`), `PATCH /mirror` with a question. Mirror friend page `POST /m/:slug/contributions`: the words are read BEFORE anything is stored; unavailable = `{ accepted: false, state: "unavailable", line: "Couldn't send this just now. Try again in a moment.", contribution_id: null }`, nothing stored, nothing recorded as a concern. A floor stop, a stop reading, two classes named, a refusing reader, or one reading saying stop while the other is unavailable remain the usual stop with resources. **Talk (v1.7x, additive; the app shows the line):** `POST /talk/turn` (also with `?stream=1`) and `POST /talk/consent` answer `reply.state: "unavailable"` with `line`, `action`, `help`, `resources` (the `unreadBody` fields) and no cards, no early guess, no `forming` events. Nothing is stored: the person's `me` row is removed, a conversation that this turn opened goes with it (`conversation: null`, `message: null` then), earlier turns stay, `risk_turn` is NOT set and mapping is NOT paused (an outage is not a risk stop). The typed words stay in the app's field. The stream sends one `unavailable` event (`{ reply }`) instead of `safety`, then the usual `reply` and `done`. If the turn call's own risk field says stop while the safety reading is unavailable, the answer is the usual `safety` stop with resources. `POST /talk/edit` reads the new words ONCE, BEFORE changing anything, and that reading is the only reading: unavailable = the same `reply`, `message` = the unedited message, nothing edited, superseded or re-checked; a stop stands as the stop (no later reading can clear it) and answers the usual `safety` reply; a clear reading is not read again, so an outage cannot leave a half-done edit. **Bridge draft analysis (same version):** `POST /bridge/insight` (plain and `with_wording`) answers `state: "unavailable"` with the `unreadBody` fields plus the existing `error_code: "insight_unavailable"` (the app's Retry), `ref: null`, no spans, points or wording, never saved. `POST /bridge/run` answers `outcome: "unavailable"`, `safety: "unavailable"`, `bridged: null` and the same fields; no rewrite package is sent. If the analysis's own safety field says stop while the reading is unavailable, the answer is the usual stop (`risk` / `declined`). In a full provider outage (every call fails) `POST /bridge/insight` (plain and `with_wording`) and `POST /bridge/run` answer the same unavailable state with the help line, not an `unreachable` error (only the spend cap still throws). Every route that takes a person's words now has the unavailable state; nothing is left on the resources stop for an outage.
