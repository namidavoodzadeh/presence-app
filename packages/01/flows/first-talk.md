# Flow: Talk

Screen: `talk`, with `safety` over it when needed. Routes: `POST /talk/turn`, `POST /talk/consent`, `PATCH /beliefs/:id`, `POST /talk/finish`, `GET /conversations`, `GET /conversations/:id`.

The first Talk is led by the engine: it opens with one question and asks one question per turn. The person ends it with ✕ whenever they want (see Q2 for the engine choice). Talk opened later from You or from Home's line uses the same flow; it continues the open conversation if there is one.

Context the flow keeps: `conversationId` (null until the first words are sent), `source` (`onboarding`, or `invite` for an account made from an invite link), `mappingPaused` (true after a safety stop), `cardQueue`, `notNow` (belief ids the person passed).

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| entering | `GET /conversations` has `active` | loadingThread | `GET /conversations/:id` |
| entering | no `active` | opening | `POST /talk/turn {text: "", source}` (no model call) |
| entering | `GET /conversations` fails | opening | as above; a 409 later recovers the open conversation |
| loadingThread | 200 | ready | show the last Presence row's question; queue its `unrated` cards |
| loadingThread | fails | opening | as above |
| opening | 200 `opener: true` | ready | show `reply.question` in `talk.question` |
| opening | fails | ready | show the fixed fallback opener (copy `talk.fallbackOpener`); nothing is lost, the first words start the conversation |
| ready | tap `talk.mic`, speech permission granted | listening | start on-device speech recognition; live caption in `talk.words` |
| ready | tap `talk.mic`, permission not yet asked | askingPermission | iOS microphone and speech prompts |
| askingPermission | granted | listening | as above |
| askingPermission | denied | typing | keyboard up; `talk.mic` hidden for this session |
| ready | tap `talk.type` | typing | keyboard up, `talk.field` focused |
| listening | tap `talk.mic` (stop), words not empty | sending | `POST /talk/turn {conversation_id, text, mode: "voice"}` |
| listening | tap `talk.mic` (stop), nothing heard | ready | nothing sent |
| listening | recognizer fails | typing | keep any words heard in `talk.field` |
| typing | `talk.sendTyped`, words not empty | sending | `POST /talk/turn {conversation_id, text, mode: "text"}` |
| sending | 200, `reply.state: "turn"` | showingReply | set `conversationId`; show `reflection` then `question`; underline each card receipt's `quote` inside the person's words |
| sending | 200, `reply.state: "consent"` | consent | show the question and the three chips |
| sending | 200, `reply.state: "safety"` | safetyStop | `mappingPaused = true`; show `safety` at once, no transition |
| sending | 409 `conflict` with `active` | sending | set `conversationId = active.id`; send the same words again (once) |
| sending | 429 `daily_limit` | limited | the words are kept on the server (`saved: true`); show the limit line with `opens_at` |
| sending | timeout 30 s | checking | `GET /conversations/:id` (when `conversationId` is known) |
| sending | 5xx, 502, 503 or offline | turnFailed | words stay on screen; show the failed line |
| checking | the reply for these words is there | showingReply | as for 200 |
| checking | not there, or no `conversationId` | turnFailed | as above |
| turnFailed | tap `talk.retry` | sending | same words, same call |
| showingReply | `reply.cards` empty and `cardQueue` empty | ready | |
| showingReply | cards present, `mappingPaused` false | cardUp | add `reply.cards` to `cardQueue` (server order); show the first; dots for the rest |
| consent | tap a chip | sending | `POST /talk/consent {conversation_id, area, label, domain, answer}` (`sure`, `not_now`, `never`); answers like `/talk/turn` |
| consent | taps `talk.mic` or `talk.type` instead | listening or typing | the chips go; the spoken or typed answer goes through `/talk/turn` |
| cardUp | swipe right or tap `talk.cardThatsMe` | rating | `PATCH /beliefs/:id {rating: "very", own_wording: offered_wording}`; when `offered_wording` is null, `{rating: "very"}` |
| rating | 200 | cardUp or ready | light haptic and the paper sound; the card leaves in place; next card, else ready |
| rating | 404 (the belief left the map) | cardUp or ready | the card leaves quietly |
| rating | fails | cardUp | the card stays; show the not-saved line under it |
| cardUp | swipe left or tap `talk.cardNotNow` | cardUp or ready | no call; add the id to `notNow`; next card, else ready |
| safetyStop | tap `safety.close` | ready | Talk goes on; no cards appear for the rest of this conversation |
| safetyStop | tap a resource | safetyStop | open the link in Safari |
| limited | tap `talk.close` | finishing | as below |
| any state in Talk | tap `talk.close`, `conversationId` null | closed | no call; go to `you` |
| any state in Talk | tap `talk.close`, `conversationId` set | finishing | stop listening; `POST /talk/finish {conversation_id, ratings: [], not_now: notNow}` |
| finishing | 200 without `still_working` | closed | go to `you` |
| finishing | 200 with `still_working: true` | finishingRetry | the same request again, once |
| finishingRetry | any answer | closed | go to `you` |
| finishing | 409 `conflict` (already finished) | closed | go to `you` |
| finishing | 429, 5xx or offline | closed | go to `you`; the conversation stays open and the next Talk continues it |

Notes:
- Cards appear only when the person has stopped (the reply comes after they stop). While a card is up, the mic and "or type" are hidden; the person answers the card queue first or closes Talk (V3 rule 3: nothing appears while someone speaks).
- Unrated cards stay `guess` and appear later as Suggestions on You (law 3: nothing reaches You's kennings unless the person says That's me).
- Ratings are saved one at a time as they happen, so `ratings` in the finish call is empty; this keeps "saved means confirmed" true for each card.
- A risk turn extracts nothing (law 8); the server already sends no cards after it. `mappingPaused` is a second guard in the app.
