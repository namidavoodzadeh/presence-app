# Package 02: get ready to talk

Status: **draft**, written by the explore partner on 27 Nov 2026 from `PROPOSAL-prepare.md`. Not frozen. The freeze waits until the owner has tested the package 01 build on his phone (owner, 27 Nov). Package 01 is not changed by anything here.

## What it is, in one line
Before a conversation you will have out loud, write what you want to say to that person. The same notes as Before it goes help you with it. Then keep it for when you talk instead of sending it.

## Recommendation: one act, two endings
Preparing and writing are one act. In a person's thread, you write your words, the notes come at the pause, and you choose how it ends:
- **Now:** the card folds and sends, as in package 01.
- **When we talk:** nothing is sent. Your words and the notes you kept become a card on your side of the thread that only you see, ready for when you talk.

The two endings are the greenhouse's own **When** step ("Then When: Now · Tomorrow morning · At the check-in"), which package 01 deferred. Package 02 builds that step with two choices, Now and When we talk. Tomorrow morning and At the check-in come with scheduled sends and check-ins.

### Why this beats a separate feature
| | One act, two endings (recommended) | Separate "Prepare" feature |
| --- | --- | --- |
| Engine | `POST /bridge/insight` as it is, plus one field (`for: "talk"`) and contacts | A new route, prompt, verifier and gold set that would drift from Before it goes |
| Laws and safety | Already enforced on this path: safety floor, AI consent gate, soften only, source rule, tiers | Every check rebuilt and re-reviewed |
| Screens | Thread, pause and note cards reused; new: the When row, the talk card, a contact | A new conversation surface and a new card type |
| What people learn | One habit: write it, look at the notes, choose the ending. Switching from speaking to texting is just the other ending. | Two places that look alike and behave differently |
| What it gives up | No free chat to "think it through"; the back-and-forth is editing your words at the pause | Freer chat, but that is where scripting and rumination creep in (PSYCHOLOGY.md) |
| Size | About 12 items | About 20 items |

### What is new either way
1. **People not on Kenember (contacts).** Most hard conversations are with people who will never install the app. A contact is a first name and a relationship, nothing else. Its thread holds only your own talk cards, and inviting them later turns the contact into a link and keeps the cards.
2. **Insight framed for speaking.** `for: "talk"` tells the engine the words will be said, not sent. It keeps the same checks and tiers and drops what only applies to text. For a contact there is never a receiver pack, so the notes are Tier 2 (your own items) or Tier 1 (general, labelled general).
3. **The talk card.** Your words, the notes you kept, and whatever the other person shared with you that a note quoted. It closes with We talked or Let go, and an optional "Did getting ready help?".
4. **A gold set for spoken preparation,** owned by the psychology advisor.

## Changes to the owner's proposal (each one is a question in QUESTIONS.md)
- **No written-for-you opening line.** The opening is your own first sentence. The engine may offer at most one change to it, as a note you can Use or Keep mine. That keeps "prepare, don't script" and law 3 ("the person's words"). See PSYCHOLOGY.md.
- **The unknown-person case asks, never guesses.** For someone who shared nothing, or who isn't on Kenember, the card can carry one question to ask them when you talk ("You could ask [Name] how they like hard things raised."). The evidence for asking over imagining is the strongest here. See PSYCHOLOGY.md.
- **The entry point is the person, not Talk.** "Get ready to talk" starts in People (a person, or Someone new → Not on Kenember). Starting from Talk needs the Talk engine to recognise the wish and hand over, which is package 03 with Talk's starters.

## In
- The When step in a person's thread: Now · When we talk.
- The talk card in the thread, with We talked, Let go and the optional follow-up question.
- Contacts: Someone new → Not on Kenember; a contact's row in People; a contact's thread (talk cards only); invite a contact later.
- `for: "talk"` on `POST /bridge/insight`; contacts on the insight call (no receiver pack).
- Export and account deletion cover contacts and talk cards.
- Counts-only measures (below).

## Out (later packages)
- Starting from Talk ("I need to talk to someone about something"): with Talk's starters.
- Bringing a talk card to a check-in, Tomorrow morning, At the check-in: with scheduled sends and check-ins.
- Practising the conversation with the AI, role-play, or "what might they say": out on principle (PSYCHOLOGY.md).
- Reminders before a conversation: out; nothing pushes the person to have it.

## Order after this (proposed; owner decides)
Package 01's SCOPE put import, returning Talk sessions, scheduled sends and check-ins in package 02. If this package leads 02, those move to 03, and receiving-side insight and the map move one package later. QUESTIONS.md Q4.

## Size
About 12 items (package 01 has 32): 6 engine and contract, 6 app. Tests ride with each item. A days estimate comes from package 01's measured throughput once its first build has shipped (docs/verification/retro-first-testflight.md); until then, any number would be a guess.

## What we measure (counts only; no user words, no names, no draft text)
| Measure | Why |
| --- | --- |
| Talk cards kept per week, per active person | Is the ending used? |
| Share of When choices that are When we talk | Prepare versus send |
| Talk cards for contacts versus linked people | Does it reach the people who aren't here? |
| Notes per talk card by tier (3, 2, 1, none) | With versus without shared items |
| Note answers by tier: Use it, Keep mine | Do notes help when someone is getting ready? |
| Talk cards closed We talked versus Let go versus left open after 14 days | Do the conversations happen? |
| Follow-up answers: Yes, Partly, No, Skip | Did getting ready help, in the person's own judgement |
| Contacts later invited, and invites accepted | Does preparing bring the other person in? |
| Safety stops on the talk path | Watched by the safety lead, never used as a growth measure |
