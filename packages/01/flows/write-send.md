# Flow: writing in a thread, Before it goes, and sending

Views: `thread` (the bar reads "Write to [Name]"), a note card above the bar, `pause`, `safety`. Routes: `GET /drafts/:person`, `PUT /drafts/:person`, `DELETE /drafts/:person`, `GET /people/:person/map`, `POST /bridge/insight`, `POST /bridges`.

Insight in package 01 comes from the words and from the sender's own kennings, and every note says what it is based on (greenhouse, "Insight for the sender"; PSY review Tier 1 and Tier 2). Receiver-grounded notes ("JAN SHARED … TRY") need the pair context and Write pipeline the PSY review describes; they are not in package 01. Silence is the default. Nothing appears while the person types (it waits for a pause), and nothing blocks sending.

Context: `person`, `replyTo` (a bridge id after Reply, else null), `original` (the words before any note was used), `seq`, `notes` (from the latest insight for the current words), `fromMe` (one of the sender's own items, or null), `answered` (notes already kept or used), `changed`, `theyShared` (true / false / unknown), `askLineShown` (per person, kept on the phone).

## Writing

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| entering the thread | | editing | `GET /drafts/:person` and `GET /people/:person/map` together; a draft fills the bar if the person has not typed yet; `theyShared` = false on 403, true on 200, unknown on any failure |
| editing | the words change | editing | underlines go; any insight call in flight is cancelled; `seq += 1` |
| editing | 1.5 s with no change, 12 characters or more | reading | `POST /bridge/insight {person_id, text, seq, with_wording: true, reply_to, from_me_skip}` |
| reading | the words change | editing | as above |
| reading | 200 `state: "insight"`, current `seq` | editing | `notes` = `highlights` with a `friction_kind` and `suggested` different from `original`; `fromMe` = `from_me`; underline each note's phrase in the bar |
| reading | 200 with an old `seq` | reading | dropped |
| reading | 200 `state: "risk"` | safetyStop | `safety` at once; no more insight for this draft |
| reading | 200 `state: "declined"` | refused | underline `spans`; the refusal line and `headline` above the bar; Send disabled |
| reading | `unavailable`, 403 `ai_consent_required`, 429, 5xx, offline, timeout | editing | nothing shown; with AI consent off no insight call is made at all |
| editing | tap an underlined phrase | noteUp | that note's card rises above the bar; a double soft pulse |
| noteUp | swipe right or tap `pause.useIt` | editing | replace the phrase with `suggested` when the words there still match; `changed = true`; the note is answered |
| noteUp | swipe left or tap `pause.keepMine` | editing | the note is answered |
| noteUp | tap outside | editing | the card sinks; the note is still open |
| refused | the words change | editing | the refusal line goes; insight resumes at the next pause |
| safetyStop | tap `safety.close` | editing | the words stay |
| editing | leaves the thread, words in the bar | savingDraft | `PUT /drafts/:person {text, reply_to}` |
| editing | leaves the thread, bar empty, a draft was loaded | closed | `DELETE /drafts/:person` |
| savingDraft | 200 | closed | |
| savingDraft | fails | closed | the words stay on the phone and fill the bar next time |

## Before it goes

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| editing | tap `bar.send`, unanswered notes or `fromMe` for the current words | pausing | `pause` rises: "Before it goes", the first card, dots for the rest |
| editing | tap `bar.send`, nothing unanswered (or insight not back yet) | folding | |
| pausing | swipe right or tap `pause.useIt` on a note | pausing or ended | as in noteUp; next card |
| pausing | swipe left or tap `pause.keepMine` | pausing or ended | next card |
| pausing | swipe right on the `fromMe` card | pausing or ended | add the item's words to the end of the message as their own sentence; `changed = true` |
| pausing | swipe left on the `fromMe` card | pausing or ended | add its id to `from_me_skip` for this draft |
| pausing | pull down | editing | the words as they are now |
| ended | `changed` | final | `pause.final`: the words exactly as [Name] will read them, and "Fold and send" |
| ended | not `changed` | folding | |
| final | tap `pause.send` | folding | |
| final | pull down | editing | |

When `theyShared` is false, the first card has the line "[Name] hasn't shared anything yet, so this is based only on you." and, once per person (`askLineShown`), the plain line "You could ask [Name] how they like hard things raised." shows under the cards. When `theyShared` is true or unknown, each note says it is general (copy `pause.basisGeneral`).

## Sending

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| folding | | sending | the card folds as it leaves, a firm haptic and the paper sound; your card appears on the right of the thread ("YOU · NOW") with the knot breathing; `POST /bridges {person_id, original, bridged: null, final, used: changed ? "edited" : "mine", show_original: false, heads_up: true, deliver_at: "now", tz, reply_to}` |
| sending | 200 | sent | the knot stops; "Helped by Kenember" under your card when `changed`; the draft is gone on the server |
| sending | 403 `forbidden`, `reason: "wont_carry"` | notSent (refused) | under your card: the refusal line and "Edit" |
| sending | 403, another reason | notSent (not connected) | under your card: the not-connected line |
| sending | 429, 5xx, offline, timeout | notSent (failed) | under your card: "Not sent." and Try again |
| notSent (failed) | tap `thread.retry` | sending | the same body |
| notSent (refused) | tap "Edit" | editing | the card goes; the words return to the bar |

Notes:
- `original` is the words before the first note was used. With nothing used, `original` equals `final` and `used` is `mine`.
- "Nothing reaches another person without showing exactly what they will see": without a change, the bar itself showed it; with a change, `pause.final` shows it before the fold.
- The When step (Now · Tomorrow morning · At the check-in) is deferred: package 01 sends now.
- `from_me` is returned only while the communication switch is on for the account and only for an item the sender already shares with this person (CONTRACT v1.92). In package 01 that is the invite's gift.
