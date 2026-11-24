# Package 01: states

Every screen that shows server data holds one `LoadState` (`loading`, `empty`, `failed`, `loaded`) and switches over all four with no `default` (AGENTS.md). `failed` carries a `LoadFailure` kind: `offline`, `server`, `notAllowed` or `unreadable`.

Shared look for each state, from the V3 flows page ("Waiting symbol"):
- **loading:** nothing for the first 300 ms; then the waiting envelope, centred where the content will appear, never over other content and never inside a button; kept at least 500 ms once shown. After 10 s the screen's unavailable line replaces it while the call continues.
- **failed:** the screen's unavailable line where the content would be, and Try again under it (`<screen>.retry`). No error codes and no Ref on screen. `notAllowed` (401) goes to sign-in instead of showing a line.
- **empty:** the screen's own empty content, below. Never a blank list with a title over it.
- **loaded:** as drawn.

Strings are in `copy.md` under each screen.

| Screen | Data | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- | --- |
| `talk` | the opener or the open conversation | envelope where the question goes; mic hidden | not used: when the opener fails, the fixed fallback opener shows as loaded (no person words are lost) | not used for the opener (see empty); a failed turn is a turn state, not a screen state: the words stay and `talk.turnFailed` shows under them with `talk.retry` | question at the top, mic, "Tap to talk · or type" |
| `talk` (a turn) | `POST /talk/turn` reply | the person's words stay on paper; envelope under them where the reply line goes; mic disabled | — | `talk.turnFailed` and `talk.retry`; or `talk.limited` (429) with no Try again | reflection and question; then cards if any |
| `you` | `GET /kennings` | envelope where the list goes; Talk shown | F5: `you.emptyLine` and Talk | `you.unavailable` and `you.retry`; Talk still shown | Suggestions row (if any), "Your kennings" heading, the kenning noun line, rows newest first, Talk |
| `suggestions` | `GET /kennings` `suggested` | envelope where the card goes | the sheet closes (there is nothing to confirm) | `suggestions.unavailable` and `suggestions.retry` | up to three cards, dots |
| `kenning` | `GET /beliefs/:id` | envelope where the words go | not possible (a 404 returns to You) | `kenning.unavailable` and `kenning.retry` | words, "You said" receipt, Done |
| `home` | `GET /home`, and `GET /kennings` for the F5 line | envelope in the card area; bar shown and usable | nothing above the bar (Q4); bar shown | `home.unavailable` and `home.retry`; bar usable | cards in server order; the F5 line only while You has no kenning; "Not sent" from the phone's own send state overrides a card's line |
| `invitePreview` | `GET /kennings` | envelope where the picked kenning goes; Send invite dimmed | F4b: the one empty line; Send invite dimmed until there are words | `invitePreview.unavailable` and `invitePreview.retry`; Send invite dimmed | picked kenning as Jan will see it; "Or give this one" (up to two) |
| `gift` | `GET /invites/:code` | envelope where the words go; Continue hidden | not used | `gift.unavailable` and `gift.retry`; dead or own link lines are loaded-with-a-line, with Continue | inviter's line and the words given; Continue |
| `person` | `GET /threads/:person` | envelope in the OPEN block; Write to [Name] usable | `person.empty` ("Nothing open"); Write to [Name] usable | `person.unavailable` and `person.retry`; Write to [Name] usable | OPEN rows |
| `card` | `POST /bridges/:id/open`, or the thread item when already opened | envelope where the words go; Keep and Reply hidden | not used | `card.unavailable` and `card.retry` | sender name and time, the words, Keep and Reply |
| `write` | `GET /drafts/:person` | the field is usable at once; a draft that arrives later fills the field only if the person has not typed yet | empty field, keyboard up | treated as empty (a draft that fails to load is not shown; nothing is overwritten on the server until Close) | the draft's words in the field |
| `write` (insight) | `POST /bridge/insight` | nothing shown (V3 rule 3: nothing appears while typing; no spinner for insight) | silence: no notes, "Ready to fold" | silence: no notes, "Ready to fold" | notes line and underlines, or the own card, or the refusal state |

Screens with no server data: `signIn` (its failure lines are flow states), `addPerson`, `safety` (shows what the triggering reply carried).
