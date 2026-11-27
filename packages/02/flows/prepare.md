# Flow: get ready to talk (writing, When, the talk card)

Views: `thread`, `pause`, `when`, `talkCard`, `helped`, `safety`. Routes: package 01's writing routes, plus `POST /prep/:person`, `GET /prep/:person`, `PATCH /prep/:id`, `DELETE /prep/:id` (routes.md, all **not ready**).

Context: package 01's write-send context, plus `isContact` (from the person's `status`), `ending` (`now` | `talk` | null), `keptNotes` (the notes answered in this draft: used, or kept to look at; at most two), `askLine` (true when [Name] shared nothing or is a contact), `editing` (a talk card id when its words came back to the bar, else null).

## Writing (changes to package 01)

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| entering the thread | | editing | as package 01; also `GET /prep/:person` (the talk cards, newest first). For a contact, only `GET /drafts/:person` and `GET /prep/:person`: no threads call, no map call (`theyShared` = false) |
| editing | 1.5 s pause, 12 characters or more | reading | as package 01; the body adds `for: "talk"` when `isContact` |
| reading | 200 `state: "insight"` | editing | as package 01. For a contact, every note has `tier` 1 or 2; a Tier 3 note for a contact is a server fault and is dropped |

Everything else in writing (risk, declined, unavailable, the note card, drafts) is package 01's table.

## Before it goes, then When

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| editing | tap `bar.send`, unanswered notes or `fromMe` | pausing | package 01's pause. When `isContact`, the first card has the line `pause.basisContact` instead of `pause.basisNothing` |
| editing | tap `bar.send`, nothing unanswered | choosing | `when` rises above the bar |
| pausing | the last card answered | choosing | as package 01, except the final card no longer has its own send: `when` rises under it |
| choosing | `isContact` | choosing | only `when.talk` is shown, already chosen; the bar's send reads `when.keep` |
| choosing | not `isContact`, first time | choosing | `when.now` chosen; the bar's send reads `pause.send` ("Fold and send") |
| choosing | tap `when.talk` | choosing | `ending = talk`; the bar's send reads `when.keep` |
| choosing | tap `when.now` | choosing | `ending = now`; the bar's send reads `pause.send` |
| choosing | pull down | editing | the words as they are now |
| choosing | tap `bar.send`, `ending = now` | folding | package 01's sending table, unchanged |
| choosing | tap `bar.send`, `ending = talk` | keeping | `POST /prep/:person {text: final, notes: keptNotes, ask_line: askLine, replaces: editing}` |

`keptNotes` are the notes answered in this draft, as `{text, tier, item_id}`: `text` is the note's why line, with its TRY words when it was used. `item_id` is set only when the note quoted [Name]'s shared item (Tier 3), and the server renders that quote live on every read (law 10, CONTRACT v1.51 rule). At most two. A `fromMe` card that was used counts as a kept note with `tier: 2`.

## Keeping the talk card

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| keeping | | saving | the card settles on your side of the thread with the dashed edge and the knot breathing; the bar empties |
| saving | 200 `state: "kept"` | kept | the knot stops; label `talkCard.label`; the draft is gone on the server (`DELETE /drafts/:person` is done by the server in the same call) |
| saving | 200 `state: "risk"` | safetyStop | `safety` with the reply's resources; the card goes; the words return to the bar |
| saving | 200 `state: "declined"` | editing | the card goes; the words return to the bar with the refusal line (package 01 `thread.refused` and the headline) |
| saving | 429, 5xx, offline, timeout | notKept | under the card: `talkCard.notKept` and Try again |
| notKept | tap `thread.retry` | saving | the same body |
| safetyStop | tap `safety.close` | editing | the words stay in the bar |

## Using the talk card

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| kept | touch the card | open | `talkCard` rises: your words, the kept notes, the shared quote when one was used, the ask line when `askLine` |
| open | tap `talkCard.edit` | editing | the words fill the bar; `editing` = the card's id; the card stays until the new one is kept (`replaces`) |
| open | tap `thread.talked` | closing | `PATCH /prep/:id {state: "talked"}` |
| open | tap `thread.letGo` | closing | `PATCH /prep/:id {state: "let_go"}` |
| open | touch outside | kept | |
| closing | 200, `talked`, no follow-up asked today | asking | the card folds away; `helped` rises |
| closing | 200, `talked`, asked today already | closed | the card folds away |
| closing | 200, `let_go` | closed | the card fades |
| closing | fails | open | `talkCard.notSaved` under the card; nothing changed |
| asking | tap `helped.yes`, `.partly` or `.no` | closed | `PATCH /prep/:id {helped: "yes" \| "partly" \| "no"}`; a failure is dropped silently |
| asking | tap `helped.skip` or touch outside | closed | nothing recorded |
| kept, 14 days old | entering the thread | kept | under the card, once: `talkCard.stale` with Let go; nothing else changes and nothing is sent anywhere |

Notes:
- A closed card leaves the thread. Talked and let-go cards are kept for export, then deleted with the account. Nothing about them reaches [Name].
- "Asked today" is kept on the phone, per account, and is never sent.
- `GET /prep/:person` fails: the thread shows the rest of its cards. The talk cards' place shows `talkCard.unavailable` and Try again.
