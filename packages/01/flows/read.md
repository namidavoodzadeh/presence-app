# Flow: the push, the folded card, the first reading, Keep and Reply

Views: `thread`, `reading`. Routes: `PUT /devices/apns`, `GET /threads/:person`, `POST /bridges/:id/open`, `PATCH /cards/:bridge_id`.

A card arrives folded. The first reading has no app text at all: only the words and the sender's name (V3 rule 6, kept by the greenhouse). After it: Keep and Reply, the same size.

## Notifications (owner answer 6)

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| no permission asked | the person's first link becomes active (they accepted an invite, or People first shows someone who accepted theirs) | asking | the iOS notification prompt, once |
| asking | allowed | registering | `registerForRemoteNotifications`; `PUT /devices/apns {installation_id, token, environment, bundle_id, locale}` |
| asking | denied | off | nothing more is asked; cards still show in the thread and People |
| registering | 200 | on | |
| registering | fails | on | retried at the next app launch (the route is idempotent) |
| on | the device token changes | registering | the same call |
| on | push `bridge_ready` arrives | | the system shows it: no name, no words (APNs payload, CONTRACT §12.4) |
| on | the person taps the push | `thread` | for `target_id`, the folded card first |

## Thread

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | | loading | the name at the top; `GET /threads/:person` |
| loading | 200 with bridge items | loaded | cards rise one by one, 80 ms apart: theirs on the left, yours on the right; a ready, unopened card first (P1 is ordered by what is still open) |
| loading | 200, nothing yet | empty | the empty line; the bar reads "Write to [Name]" |
| loading | fails | failed | the unavailable line and Try again; the bar still works |
| failed | tap `thread.retry` | loading | |
| loaded | touch a folded card | opening | `POST /bridges/:id/open` |
| opening | 200 | reading | `reading`: the words and the name only |
| opening | 404 (withdrawn or deleted) | loading | the card is gone |
| opening | 403 `sealed` | loading | cannot happen for a card sent now; reload quietly |
| opening | fails | loaded | the line under that card: "Didn't open. Touch to try again." |
| reading | touch anywhere | afterReading | the card settles into the thread with "FROM [NAME] · [WHEN]", then Keep · Reply under it |
| afterReading | tap `thread.keep` | keeping | `PATCH /cards/:bridge_id {state: "kept"}` |
| keeping | 200 | loaded | the label reads "FROM [NAME] · KEPT"; Keep and Reply go |
| keeping | fails | afterReading | the not-saved line under the words |
| afterReading | tap `thread.reply` | `write-send.md` editing | the bar is focused; `replyTo` = this card |
| afterReading | pull right or down | `people` | Keep and Reply wait under the card next time |
| any | pull right or down | `people` | |
| any | a push for this person arrives while the thread is open | loading | |

Notes:
- Keep means the card stays kept in the thread for both people (owner answer 5). For a feedback card from Mirror (package 04), Keep will mean adding it to the person's kennings.
- A card you sent is not opened again in package 01; it shows its words, "YOU · [WHEN]", and "Helped by Kenember" when a note was used.
