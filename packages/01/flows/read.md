# Flow: the other person sees and reads the card

Screens: `home`, `person`, `card`. Routes: `GET /home`, `GET /threads/:person`, `POST /bridges/:id/open`.

The first reading has no app commentary (V3 rule 6): the words alone, the sender's name and the time.

## Home

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | 200, `people` empty | empty | nothing above the bar (Q4) |
| loading | 200, people | loaded | cards in the server's order, most urgent lowest; the F5 line when You has no kenning (from `GET /kennings`) |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `home.retry` | loading | |
| loaded | tap a card whose top reason is `unread` | (act) `card` | the oldest ready card from that person (from `GET /threads/:person`); closing it lands on `person` (V3 flows F3) |
| loaded | tap any other card | (place) `person` | |
| loaded | tap a card showing "Not sent" | (act) `write` | see `write-send.md` |
| any | tap `home.you` | (place) `you` | |
| loaded | tap `home.write` | (act) `write` | to the person on the lowest card |
| empty | tap `home.write` | (act) `addPerson` | nobody to write to yet |
| any | tap `home.add` | (act) `addPerson` | |
| loaded | tap `home.addAboutYou` | (act) `talk` | |
| any | Home appears again (from any screen or the app returning to the foreground) | loading | cards re-sort only now, never on screen |

## Person page

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| loading | 200 with bridge items | loaded | ready unopened cards to this person first, then the rest newest first |
| loading | 200, no bridge items | empty | "Nothing open" |
| loading | fails | failed | the unavailable line and Try again |
| failed | tap `person.retry` | loading | |
| loaded | tap a row for a ready, unopened card to you | (act) `card` | |
| loaded | tap a row for an opened card to you | (act) `card` | shows the words again (already opened; no call) |
| loaded | tap a row for a card you sent | loaded | nothing (sent cards are not opened again in package 01) |
| loaded, empty | tap `person.write` | (act) `write` | to this person |
| any | tap `person.back` or `person.backButton` | `home` | |
| any | `card` or `write` closes | loading | |

## Card

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| opening, not yet opened | | opening | the unfold (reverse of the fold, 320 ms); `POST /bridges/:id/open` |
| opening | 200 | reading | `final`, the sender's name and `deliver_at` in the receiver's own time |
| opening | 403 `sealed` | closed | cannot happen for `deliver_at: "now"`; close quietly and reload the person page |
| opening | 404 (withdrawn or deleted) | closed | reload the person page |
| opening | fails | failed | the unavailable line and Try again |
| failed | tap `card.retry` | opening | |
| opened before | | reading | the words from `GET /threads/:person`; no call |
| reading | tap `card.reply` | (act) `write` | to the sender, `replyTo` = this bridge id |
| reading | tap `card.keep` or `card.close` | closed | the card stays on the person page (Q5) |
| closed | | `person` | for the sender of this card |
