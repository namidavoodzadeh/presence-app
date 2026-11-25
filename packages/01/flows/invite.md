# Flow: Someone new, and the invited person's first open

Views: `people`, `someoneNew`, the iOS share sheet, `safety`; on the invited person's phone `signIn`, then `thread` with the inviter. Routes: `GET /home`, `GET /comm/items`, `POST /comm/items` (typed line), `POST /invites` and `GET /invites/:code` (both need new fields, see `routes.md`), `POST /invites/:code/accept`.

The invite gives before it asks: the other person sees one thing the inviter chose, then decides (H2, X1). The link works once and ends in 7 days.

## People

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| (any view) | pull from the right, or tap `edge.right` | loading | People slides in from +120 pt; camera to −60 pt; `GET /home` |
| loading | 200 with people | loaded | one row per person, most urgent at the top (the reverse of `GET /home`'s array, which ends with the most urgent), then "Someone new" |
| loading | 200, nobody | empty | only "Someone new" |
| loading | fails | failed | the unavailable line, Try again, and "Someone new" |
| failed | tap `people.retry` | loading | |
| loaded | tap `people.row.N` | `thread` | rows slide 30 pt left and fade; see `read.md` |
| any | tap `people.new` | `someoneNew` | rises from the bottom |
| any | pull right | `talk` | |

## Someone new (inviter)

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| opening | | picking | `GET /comm/items` |
| picking | 200 with an eligible item | ready | the newest eligible item is the gift (Q3); "Change" shows when there is more than one |
| picking | 200, none eligible | writingOne | the bar's placeholder reads "One thing about you for [Name]" (Q3) |
| picking | fails | failed | the unavailable line and Try again; Share the link stays dimmed |
| failed | tap `someoneNew.retry` | picking | |
| ready | tap `someoneNew.change` | ready | the next eligible item, newest first, round to the first |
| any | tap a WHO word | same | that word is underlined; tapping it again clears it |
| any | type a first name | same | 40 characters at most; the line under it names them |
| ready | tap `someoneNew.share`, a name typed | creating | `POST /invites {relationship, gift: {item_id}}` |
| writingOne | tap `bar.send`, a name typed, words in the bar | savingOne | `POST /comm/items {kind: "how_i_mean", wording, source: "typed", scope: {type: "everyone"}}` |
| savingOne | 201 | creating | `POST /invites` with the new item |
| savingOne | 200 `state: "safety"` | safetyStop | nothing stored; the words stay in the bar |
| savingOne | 200 another refusal | writingOne | the not-kept line; the words stay |
| savingOne | fails | writingOne | the not-sent line; the words stay |
| safetyStop | tap `safety.close` | writingOne | |
| creating | 200 | sharing | the share sheet with the share text and `link` |
| creating | fails | ready or writingOne | the not-sent line |
| sharing | shared | closed | Someone new sinks; People shows the person once they accept |
| sharing | cancelled | ready | the same invite is reused on the next tap (no second code) |
| any | pull down or right | closed | nothing kept |

Eligible for the gift: the person's own active items of the kinds the invite may carry (How I mean things, What feels like care, How to bring something up with me; CPO X1 row), not scoped to one named person. "How to bring something up with me" comes first when there is one (PSY review, section 5).

## The invited person

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| opened by the link, signed out | | sign-in flow | `pendingInvite` kept |
| opened by the link, signed in | | peeking | `GET /invites/:code` |
| peeking | 200 | accepting | `POST /invites/:code/accept` (the person tapped a link meant for them; the gift is the first thing they see, Q4) |
| peeking | 404 | deadLink | `talk`, with the dead-link line as the first reply |
| peeking | 400 (own code) | ownLink | `talk`, with the own-link line as the first reply |
| peeking | fails | peekFailed | `talk`, with the unavailable line and Try again as the first reply |
| peekFailed | tap Try again | peeking | |
| accepting | 200 | arrived | clear `pendingInvite`; ask for notification permission (`read.md`); the inviter's `thread`, the gift as the first card (Q4) |
| accepting | 409 (already linked) | arrived | as above |
| accepting | 404 | deadLink | |
| accepting | fails | peekFailed | |
| arrived | pull right or down | `people` | Talk then opens with `wayIn` from the invite and `aboutName` = the inviter |

Notes:
- The inviter is asked for notification permission when the first person they invited joins (`read.md`).
- An invited person's first Talk uses `way_in` `invited_by_partner` or `invited_by_friend` from the invite, and the inviter's name in the question (communication spec, H3).
