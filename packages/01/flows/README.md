# Package 01: flows

One state table per flow. Each row is: state, event, next state, and what happens on the way (the call made or the screen shown). Every failure path is a row. A flow is built as one state machine in `app/Packages/Flows/` (no SwiftUI, no networking: calls are injected).

| File | Flow | Steps in SCOPE.md |
| --- | --- | --- |
| `sign-in.md` | Sign in and route to the first screen | 1 |
| `first-talk.md` | The first Talk, its suggestion cards, and finishing | 2, 3 |
| `you.md` | You, Suggestions and kenning detail | 3 |
| `invite.md` | Add a person, invite preview, and the invited person's first open | 4 (someone to write to) |
| `write-send.md` | Write with insight, and Send | 4, 5 |
| `read.md` | The other person sees and reads the card | 5 |

Shared rules for every flow:
- **Waiting.** A load shows the waiting envelope only after 300 ms, for at least 500 ms once shown; after 10 s the screen's unavailable line replaces it (V3 flows, "Waiting symbol"). The load itself keeps going until the client timeout.
- **401 on any call** ends the session: the flow goes to `signIn` and keeps any words the person typed on the phone.
- **429 `daily_limit`** is never a crash. Talk shows its own line; Write simply shows no notes (Send never depends on a model call).
- **Saved means confirmed.** A rating, a draft or a send shows as done only after the server answers 2xx.
