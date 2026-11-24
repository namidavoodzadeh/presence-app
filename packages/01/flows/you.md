# Flow: You, Suggestions, kenning detail

Screens: `you`, `suggestions`, `kenning`. Routes: `GET /kennings`, `PATCH /beliefs/:id`, `GET /beliefs/:id`.

"What I learned about you, shown simply": confirmed kennings in the person's own words, newest first, each opening to the words it came from (law 2). Suggestions stay apart, dashed, until the person says That's me (law 3, V3 rule 9).

## You

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | 200, no kennings and no suggestions | empty | F5: the one line and Talk |
| loading | 200, suggestions only | loaded | the Suggestions row; no kenning rows; the F5 line stays above Talk |
| loading | 200, kennings | loaded | `groups[].items` flattened, newest `dated_at` first; the Suggestions row when `suggested` is not empty |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `you.retry` | loading | `GET /kennings` |
| loaded | tap `you.suggestionsRow` | (act) `suggestions` | |
| loaded | tap `you.kenning.N` | (place) `kenning` | pass `belief_id` |
| empty or loaded | tap `you.talk` | (act) `talk` | see `first-talk.md` |
| any | tap `you.back` | `home` | |
| any | `suggestions` or `talk` closes | loading | `GET /kennings` again, so new kennings show |

## Suggestions

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | 200 with `suggested` | cardUp | the newest three by `dated_at`; dots for the rest of the three |
| loading | 200, `suggested` empty | empty | close the sheet; You no longer shows the row |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `suggestions.retry` | loading | |
| cardUp | swipe right or tap `suggestions.thatsMe` | rating | `PATCH /beliefs/:id {rating: "very", own_wording: offered_wording}`; `{rating: "very"}` when `offered_wording` is null |
| rating | 200 | cardUp or done | light haptic and the paper sound; next card |
| rating | 404 | cardUp or done | the card leaves quietly |
| rating | fails | cardUp | the card stays; the not-saved line under it |
| cardUp | swipe left or tap `suggestions.notNow` | cardUp or done | no call; it stays a suggestion, without a mark (V3 flows Y5) |
| done | | closed | the sheet closes; You reloads |
| any | tap `suggestions.close` | closed | You reloads |

## Kenning detail

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | 200 | loaded | words = `own_wording` else `statement`; the newest receipt |
| loading | 404 | gone | back to You, which reloads |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `kenning.retry` | loading | `GET /beliefs/:id` |
| loaded or failed | tap `kenning.back` or `kenning.done` | `you` | |
