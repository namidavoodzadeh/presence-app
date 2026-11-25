# Package 01: states

Every view that shows server data holds one `LoadState` (`loading`, `empty`, `failed`, `loaded`) and switches over all four with no `default` (AGENTS.md). `failed` carries a `LoadFailure` kind: `offline`, `server`, `notAllowed` or `unreadable`.

Shared look, on the greenhouse glass:
- **loading:** nothing for the first 300 ms; then the hand-drawn knot (the mark for "something on its way"), centred where the content will appear, never over other content and never inside the send; at least 500 ms once shown. After 10 s the view's unavailable line replaces it while the call goes on. The greenhouse, curtain and talk bar are always there and usable.
- **failed:** the view's unavailable line where the content would be, and "Try again" under it as a quiet word (`<view>.retry`). No codes and no Ref on screen. A 401 shows `signIn` instead. A 403 `feature_off` or `owner_only` from a communication route shows `notOpen` (copy) and no Try again.
- **empty:** the view's own empty content, below.
- **loaded:** as drawn.

| View | Data | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- | --- |
| `talk` (opening) | `POST /comm/talk/turn` opener; `GET /home` for the greeting | the greeting shows at once from the time of day and the name; the knot where the first question goes | not used: if the opener fails, the fixed first question shows as loaded | not used for the opener (see empty); the greeting's second line is left out when `GET /home` fails | greeting, the real line, the first question, the bar |
| `talk` (a turn) | `POST /comm/talk/turn` | your message in the conversation; the knot where the reply goes; the bar usable for the next words only after the reply | — | the failed line and Try again under your message; or the limit line (429, no Try again); or `notOpen` | the reply; the suggestion card when one is offered |
| `you` | `GET /comm/items` | the heading; the knot in the list area | the one line and "Talk" | `you.unavailable` and Try again | groups by kind, words newest first |
| `kenning` | `GET /beliefs/:id`, `GET /comm/items/:id/visibility` | kind and words at once (from the list); the knot where the receipt goes | not used (a 404 closes the card) | kind and words stay; `kenning.unavailable` and Try again in the receipt's place | kind, words, underline, receipt, With, Seen by, When |
| `people` | `GET /home` | the heading; the knot in the list area; "Someone new" shown | only "Someone new" | `people.unavailable`, Try again, and "Someone new" | rows, most urgent first, then "Someone new" |
| `someoneNew` | `GET /comm/items` (eligible gift) | chips and name usable; the knot where the gift goes; Share the link dimmed | the bar asks for one thing about you (Q3) | `someoneNew.unavailable` and Try again; Share the link dimmed | the gift card and, when more than one, "Change" |
| `thread` | `GET /threads/:person`, `GET /drafts/:person` | the name; the knot in the card area; the bar usable at once | `thread.empty`; the bar | `thread.unavailable` and Try again; the bar still works | cards, an unopened one first |
| `reading` | `POST /bridges/:id/open` | the folded card stays in place with the knot beside "Touch to open" | not used | the line under the folded card: "Didn't open. Touch to try again." | their words and their name, nothing else |
| writing (insight) | `POST /bridge/insight` | nothing shown (nothing appears while typing; no knot for insight) | silence: no underlines | silence: no underlines | underlines; the note card on a tap; the pause on Send |

| `settings` | `GET /me` (the AI row) | rows shown at once; the AI row reads its last known value | — | the AI row is left out when `GET /me` fails; the other rows work | all rows |

Views with no server data of their own: `aiConsent` (its version comes from routing),  `signIn` (its failure lines are flow states), `scope` (names come from `GET /people`; when that fails, only "Only me" shows), `pause` (it shows what the last insight returned), `safety` (it shows what the triggering reply carried).
