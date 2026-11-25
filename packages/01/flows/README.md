# Package 01: flows

One state table per flow. Each row is: state, event, next state, and what happens on the way (the call made or what appears). Every failure path is a row. A flow is built as one state machine in `app/Packages/Flows/` (no SwiftUI, no networking: calls are injected).

| File | Flow | Steps in SCOPE.md |
| --- | --- | --- |
| `sign-in.md` | Sign in with Apple or Google, and where the app opens | 1 |
| `talk.md` | Talk, its suggestions, and Who sees this | 2, 3 |
| `you.md` | You (the list by kind) and a kenning | 3 |
| `invite.md` | Someone new, and the invited person's first open | 4 (someone to write to) |
| `write-send.md` | Writing in a thread, Before it goes, and sending | 4, 5 |
| `read.md` | The push, the folded card, the first reading, Keep and Reply | 5 |
| `privacy.md` | AI consent, and Settings: download, log out, delete account | what the chain needs to stay inside the rules |

Shared rules:
- **Views.** Talk, You, People and Thread are views on one surface. Moving between them is a pull, never a pushed page. A flow that "goes to People" runs the same move as a pull, animated without a finger.
- **Waiting.** Nothing shows for the first 300 ms of a load; then the hand-drawn knot ("something on its way"), centred where the content will appear, for at least 500 ms; after 10 s the view's unavailable line replaces it while the call goes on.
- **401 on any call** ends the session: the app shows `signIn` and keeps any words in the bar on the phone.
- **429 `daily_limit`** never breaks a flow. Talk says when it opens again; writing simply shows no notes (sending never depends on a model call).
- **Saved means confirmed.** A kept kenning, a draft or a send shows as done only after the server answers 2xx.
