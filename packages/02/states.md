# Package 02: states

Status: draft, 27 Nov 2026. Package 01's `LoadState` rule and shared look hold (`loading`, `empty`, `failed`, `loaded`; switch over all four, no `default`). Rows for the views package 02 adds or changes:

| View | Data | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- | --- |
| `thread` (talk cards) | `GET /prep/:person` | nothing extra; the thread's own loading covers it | no talk cards: nothing shown. A contact with no cards shows `thread.contactEmpty` | `talkCard.unavailable` and Try again in the cards' place; the bar still works | talk cards on your side, newest last, among the thread's cards by date |
| `thread` (a contact) | `GET /drafts/:person`, `GET /prep/:person` | the name; the knot in the card area; the bar usable at once | `thread.contactEmpty`; the bar | `thread.unavailable` and Try again; the bar still works | talk cards |
| `people` (contacts) | `GET /home` (contacts as rows) | as package 01 | as package 01: only "Someone new" | as package 01 | contacts among the rows, NOT ON KENEMBER on each |
| `talkCard` | the kept card, from the list | not used (the card opens from what the list returned) | not used | not used | words, kept notes, the live shared quote (null when [Name] withdrew it: that note shows without the quote), the ask line |
| `when` | none (local) | — | — | — | — |
| `helped` | none (local) | — | — | — | — |

Saving states (`saving` a contact, `saving` a talk card, `closing` a card) are flow states, in `flows/`. A talk card shows as kept only after the server answers 200 `state: "kept"` (saved means confirmed).
