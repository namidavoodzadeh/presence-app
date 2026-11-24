# Flow: Write with insight, and Send

Screen: `write`, with `safety` over it when needed; then `home`. Routes: `GET /drafts/:person`, `PUT /drafts/:person`, `DELETE /drafts/:person`, `POST /bridge/insight` (with `with_wording: true`), `POST /bridge/why-it-matters`, `POST /bridges`.

Insight in package 01 comes from the words alone and from the sender's own kennings. It describes how words may land, never the receiver (V3 rules 4–5; PSY review Tier 1 and Tier 2). Silence is the default: when nothing passes, nothing is shown. Notes appear only at a pause, never while typing (V3 rule 3). Send never waits for insight.

Context: `person` (id, name), `replyTo` (a bridge id when opened from `card.reply`, else null), `original` (the words before any note was taken), `seq`, `ownOffered` (true once the "From what you said" card was shown in this draft), `changed` (true once a note's change was taken), `notes` (the current highlights), `theyShared` (whether [Name] has shared anything with the sender; it only picks the basis line).

Write opens from: `home.write` (to the person on the lowest card, the last row of `GET /home`), `person.write`, `card.reply`.

## Writing

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| opening | | loadingDraft | `GET /drafts/:person`; at the same time `GET /people/:person/map` sets `theyShared` (`403` → false; `200` → true; any failure → unknown, which shows `write.basisWordsOnly`, the line that is true either way) |
| loadingDraft | 200 with a draft | editing | put the draft's words in `write.field` |
| loadingDraft | 200 `draft: null`, or fails | editing | empty field, keyboard up |
| editing | the words change | editing | hide notes, own card and underlines (they no longer match); cancel any insight call in flight; `seq += 1` |
| editing | 1.5 s with no change, 12 characters or more | reading | `POST /bridge/insight {person_id, text, seq, with_wording: true, reply_to}` |
| editing | 1.5 s with no change, under 12 characters | editing | no call |
| reading | the words change | editing | as above |
| reading | 200 `state: "insight"`, `seq` is current | sorting | |
| reading | 200 with an old `seq` | reading | dropped |
| reading | 200 `state: "risk"` | safetyStop | `safety` at once with `line` and `resources`; live insight stops for this draft |
| reading | 200 `state: "declined"` | refused | underline the `spans`; the refusal line; Send disabled |
| reading | 200 `state: "unavailable"`, 429, 5xx, offline, timeout | editing | nothing shown (silence) |
| sorting | a `belief` span with `belief_id`, and `ownOffered` false | fetchingOwn | `POST /bridge/why-it-matters {person_id, text, belief_id}` |
| sorting | otherwise, `highlights` with `suggested` different from `original` | notesReady | underline those parts; show `write.notesLine` |
| sorting | otherwise | ready | "Ready to fold" under the words |
| fetchingOwn | 200 with a `line` | ownUp | the "From what you said" card, dim; `ownOffered = true` |
| fetchingOwn | fails or the words changed | sorting without the belief span | |
| ownUp | swipe right or tap `write.ownAdd` | after own | append the line to the words (a space or new line before it) and `changed = true` |
| ownUp | swipe left or tap `write.ownNotNow` | after own | nothing changes |
| after own | notes from the same reply still match the words | notesReady | as above |
| after own | otherwise | ready | (adding the line counts as a change: the next pause reads again) |
| notesReady | tap `write.notesLine` | noteUp | the first note card; dots for the rest |
| noteUp | swipe right or tap `write.noteChange` | noteUp or ready | replace `original`'s span with `suggested` when the words there still match; `changed = true`; next note |
| noteUp | swipe left or tap `write.noteKeep` | noteUp or ready | nothing changes; next note |
| noteUp | tap `write.skipNotes` | ready | the cards go; underlines stay until the words change |
| safetyStop | tap `safety.close` | editing | the words stay; no more insight calls for this draft |
| refused | tap `write.edit` | editing | the refusal line goes; insight resumes at the next pause |
| editing, notesReady, ready | tap `write.close` or `write.closeButton`, words not empty | savingDraft | `PUT /drafts/:person {text, reply_to}` |
| editing, notesReady, ready | tap close, words empty | closed | `DELETE /drafts/:person` if a draft was loaded |
| savingDraft | 200 | closed | |
| savingDraft | fails | closed | the words stay on the phone and fill the field next time Write opens to this person |

## Sending

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| editing, notesReady, ready | tap `write.send`, words not empty | folding | the fold (320 ms), firm haptic, paper sound; the sheet closes (260 ms) |
| folding | | sending | Home shows the breathing envelope on this person's card; `POST /bridges {person_id, original, bridged: null, final: words, used: changed ? "edited" : "mine", show_original: false, heads_up: true, deliver_at: "now", tz, reply_to}` |
| sending | 200 | sent | the envelope stops; the draft is gone on the server |
| sending | 403 `forbidden`, `reason: "wont_carry"` | notSent (refused) | Home card line "Not sent"; the words and the spans are kept on the phone |
| sending | 403 `forbidden`, any other reason (link removed or blocked) | notSent (not connected) | Home card line "Not sent" |
| sending | 429, 5xx, offline, timeout | notSent (failed) | Home card line "Not sent" |
| notSent | tap the person's Home card | (act) `write` | opens with the kept words and the reason: refused shows the refusal state; not connected shows the not-connected line with Send disabled; failed shows the not-sent line |

Notes:
- `original` is the words before the first note change or added line. When nothing was taken, `original` equals `final` and `used` is `mine`; the receiver sees no "helped" mark either way in package 01 (`bridged_mark` is false for `mine` and `edited`).
- "Nothing reaches another person without a screen showing exactly what they will see" (V3 rule 7): the words on paper in `write` are exactly what is sent.
- The "From what you said" card is offered at most once per draft and only from the sender's own confirmed kennings (Tier 2). Notes are fixed lines from the friction checks (Tier 1), shown with the honest line about where they come from: `write.basisNothing` when `theyShared` is false, else `write.basisWordsOnly`. The basis line shows under the own card and under each note card.
