# Flow: You and a kenning

Views: `you` (pulled in from the left), `kenning` (a card above the talk bar). Routes: `GET /comm/items`, `GET /beliefs/:id`, `GET /comm/items/:id/visibility`.

"What I learned about you, shown simply": everything the person kept, in their own words, one group per kind in the spec's order, newest first inside a kind. Only kinds that hold something are drawn, so nothing reads as a gap in the person (CPO ruling 1). The subway map is deferred; package 01 shows the List.

## You

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| (any view) | pull from the left, or tap `edge.left` | loading | You slides in from −120 pt; the camera moves to +60 pt; `GET /comm/items` |
| loading | 200 with items | loaded | `groups` in the order given (the server already uses the You order); empty kinds absent; `this_week` is not shown in package 01 |
| loading | 200, no items | empty | the one line and "Talk" |
| loading | 403 `feature_off` or `owner_only` | failed (not open) | the not-open line |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `you.retry` | loading | |
| loaded | tap `you.item.N` | kenning `loading` | the card rises above the bar |
| empty | tap `you.talk` | `talk` | the same move as a pull |
| any | pull left | `talk` | the reverse move |
| any | send words from the bar | `talk` | the move to Talk, then the send as in `talk.md` |
| any | You appears again | loading | so a kenning kept in Talk shows |

## A kenning

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | | loading | the item's kind and words show at once from the list; `GET /beliefs/:id` and `GET /comm/items/:id/visibility` together; a soft tick |
| loading | both 200 | loaded | the receipt (`receipts[0]`: its quote and date) and Seen by (people with `sees: true`) |
| loading | the visibility call fails | loaded | Seen by is left out; the rest shows |
| loading | the receipt call fails | failed | the card keeps kind and words; the unavailable line and Try again where the receipt goes |
| loading | 404 | closed | the card sinks; You reloads |
| failed | tap `kenning.retry` | loading | |
| loaded, failed | tap outside the card | closed | the card sinks 16 pt and fades |
