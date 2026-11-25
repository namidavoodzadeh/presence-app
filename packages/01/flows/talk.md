# Flow: Talk

Views: `talk` (home), `scope`, `safety`. Routes: `GET /home` (for the greeting), `POST /comm/talk/turn`, `POST /comm/items`, `PATCH /beliefs/:id` (Partly, until `POST /comm/items` takes a strength), `GET /people`, `PUT /links/:person/share/items/:belief_id`.

The engine leads: it opens with one question from the question bank, asks one question per answer, offers at most one suggestion per answer in the person's own words, and ends on care after a few turns (communication spec, H3 first session). Nothing is stored unless the person says That's me or Partly (law 3 as amended 15 Nov).

Context the flow keeps: `conversationId` (null when none is open), `wayIn` (`own_download`, or `invited_by_partner` / `invited_by_friend` for an account made from an invite), `aboutName` (the inviter's first name, for an invited account), `turns` (this session's messages and replies, on the phone), `offered` (the item on the card).

## Opening and talking

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| entering, no `conversationId` | | opening | greeting from the time of day and `GET /home` (who left a card); `POST /comm/talk/turn {way_in, name}` with no `text` (no model call) |
| entering, `conversationId` set | | ready | the session's turns as they were |
| opening | 200 `state: "ask"` | ready | `reply.question` as the first reply, under the greeting; keep `conversation.id` |
| opening | 403 `feature_off` or `owner_only` | closedForAccount | the not-open line; the bar stays usable for People |
| opening | 5xx, offline, timeout | ready | the fixed first question (copy `talk.fallbackQuestion`); the first words start the conversation |
| ready | tap `bar.mic` (permission granted) | listening | on-device speech recognition; the amber lamp sweeps; the voice line moves |
| ready | tap `bar.mic`, permission not yet asked | askingPermission | iOS microphone and speech prompts |
| askingPermission | granted | listening | |
| askingPermission | denied | ready | the mic is hidden for this session; typing still works |
| listening | tap `bar.mic` again | ready | the words land in the bar for the person to check; nothing sends by itself |
| listening | recognizer fails | ready | words heard so far stay in the bar |
| ready | type | ready | the bar grows to 4 lines, then scrolls; the mic becomes the send |
| ready | tap `bar.send`, words not empty | sending | the message rises into the conversation; `POST /comm/talk/turn {text, conversation_id, way_in, name}` |
| sending | 200 `state: "ask"`, `item_state: "offered"` | suggesting | the reply (`reflection`, then `question`); then the suggestion card rises with `item.kind` and `item.wording` |
| sending | 200 `state: "ask"`, any other `item_state` | ready | the reply; no card |
| sending | 200 `state: "done"` | ready | the reply (`reflection`) with no question; `conversationId = null`; the next words start a new conversation |
| sending | 200 `state: "safety"` | safetyStop | `safety` at once, no transition; nothing was stored |
| sending | 429 `daily_limit` | limited | the words were kept (`saved: true`); the limit line under them |
| sending | 403 `feature_off` or `owner_only` | closedForAccount | the not-open line |
| sending | 5xx, offline, 30 s timeout | turnFailed | the message stays; the failed line and Try again under it |
| turnFailed | tap `talk.retry` | sending | the same words, the same call |
| limited | `opens_at` passes and the person sends | sending | |
| safetyStop | tap `safety.close` | ready | Talk goes on |
| safetyStop | tap a resource | safetyStop | opens in Safari |

## The suggestion and Who sees this

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| suggesting | swipe left or tap `talk.notNow` | ready | the card sinks; nothing is stored |
| suggesting | swipe right or tap `talk.thatsMe` | scoping (strength very) | `scope` rises; `GET /people` for the names |
| suggesting | tap `talk.partly` | scoping (strength partly) | as above |
| suggesting | the person sends new words instead | sending | the card sinks; nothing is stored |
| scoping | tap a scope word | scoping | that word is underlined; "Only with [Name]" limits Who sees this to that person or Only me |
| scoping | tap a person or `scope.onlyMe` | scoping | toggles; nothing is pre-ticked |
| scoping | tap `scope.done` | keeping | `POST /comm/items {kind, wording, source: "talk_said", scope}` |
| keeping | 201 `state: "created"`, strength very, nobody picked | kept | |
| keeping | 201, strength partly | markingPartly | `PATCH /beliefs/:id {rating: "partly"}` |
| markingPartly | 200 | kept or granting | |
| markingPartly | fails | kept or granting | kept as That's me; the line "Kept as That's me. Partly didn't save." |
| keeping | 201, people picked | granting | `PUT /links/:person/share/items/:id {shared: true}` for each, one at a time |
| granting | all 200 | kept | |
| granting | one fails | kept | the line "Not shared with [Name]. Try again from You." for each that failed |
| keeping | 200 `state: "safety"` | safetyStop | nothing was stored |
| keeping | 200 `state: "offer_request"`, `"offer_i_statement"` or `"not_kept"` | ready | the card shows the not-kept line, then sinks; nothing was stored |
| keeping | 403 `feature_off` or `owner_only` | closedForAccount | |
| keeping | 5xx, offline, timeout | scoping | the not-saved line above Done; the choices stay |
| scoping | pull down | suggesting | the card again, as it was |
| kept | | ready | `scope` and the card sink; "Kept for you" with an apricot dot under the reply, gone after 3.2 s |

Notes:
- `scope` values: With everyone → `{type: "everyone"}`; With my partner, With family, With friends, With coworkers → `{type: "type", value: "partner" | "family" | "friend" | "coworker"}`; Only with [Name] → `{type: "person", value: <person id>}`.
- Kinds that never reach another person (What lands hard, When it gets heated, Coming back after, This week, Other) show only "Only me" under Who sees this in package 01. Sharing them one person at a time with the warning (Y3) is deferred.
- In a first Talk nobody is linked yet, so Who sees this shows only "Only me". The scope still records who it is with.
- While a card or `scope` is up, nothing else rises; the reply above stays still (nothing moves while the person reads).
- Pulls to You and People work in every state; the conversation stays as it was.
