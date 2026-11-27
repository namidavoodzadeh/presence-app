# Package 02: screens

Status: draft, 27 Nov 2026. Not frozen. Package 01's views, ids and rules stand. This file lists only what package 02 adds or changes on them.

## Design source
The greenhouse package `J6koT1C7knci3rdy1RAP3y` wins over everything else. Two parts of it are used here for the first time:
- **The When step** ("Then When: Now · Tomorrow morning · At the check-in", "People, thread and insights"). Package 02 builds it with two choices: Now and When we talk.
- **The after-fold question** ("Did the note help you say it the way you meant?" Yes · Partly · No · Skip, at most once a day). Package 02 asks its own version when a talk card is closed.

There is no drawing of the talk card or the contact thread. They are built with the thread's own card and the greenhouse rules (glass card, small caps label over the words, max 84% wide, radius 22 pt). The talk card sits on your side of the thread, with no apricot tint and a dashed edge, so it never reads as sent. That is one new token (tokens.md).

## The chain
1. **Choose the person.** `people`: a person, or `someoneNew` → Not on Kenember (a new contact).
2. **Write what you want to say.** `thread` with the bar, exactly as in package 01. For a contact the bar reads "Get ready to talk to [Name]".
3. **Notes.** `pause` (Before it goes), unchanged, with `for: "talk"` when the ending is already known (contact) and the general basis lines.
4. **When.** `when`: Now (fold and send, linked people only) or When we talk.
5. **The talk card.** In the thread, only you see it. It closes with We talked or Let go, then the optional `helped` question.

`safety` is shared, as in package 01.

## Screens and controls
Control ids are `screen.control`, the `accessibilityIdentifier` values.

### `someoneNew` — Someone new (H2), one addition
| Id | Control |
| --- | --- |
| `someoneNew.notHere` | "Not on Kenember": the name and relationship only, no link |
| `someoneNew.add` | "Add [Name]" (the bar's send, in the Not on Kenember state) |

The chips (`someoneNew.partner`, `.friend`, `.family`) and `someoneNew.name` are reused. With Not on Kenember chosen, the gift and Share the link are hidden.

### `people` — Your people (H1), one change
| Id | Control |
| --- | --- |
| `people.row` | A contact's row looks like any person's, with the label NOT ON KENEMBER instead of the reason line |

### `thread` — A person, additions
| Id | Control |
| --- | --- |
| `thread.talkCard` | A talk card (`thread.talkCard.N`): your words and the notes you kept; touch to open it full |
| `thread.talked` | "We talked", under an open talk card |
| `thread.letGo` | "Let go", under an open talk card |
| `thread.invite` | "Invite [Name]" (contacts only), the quiet word under the name |

For a contact the bar reads "Get ready to talk to [Name]" and there is no Fold and send. Everything else is package 01's thread.

### `when` — When (the greenhouse When step), new
| Id | Control |
| --- | --- |
| `when.now` | "Now": fold and send (linked people only) |
| `when.talk` | "When we talk": keep it as a talk card, send nothing |

Two short words of equal size above the bar, under the final card (or under the bar when there were no notes). The bar's send confirms the chosen one: it reads "Fold and send" with Now, and "Keep it" with When we talk. Pulling down goes back to writing.

### `talkCard` — A talk card, open
| Id | Control |
| --- | --- |
| `talkCard.words` | Your words (text) |
| `talkCard.note` | A note you kept or used (`talkCard.note.N`, at most two) |
| `talkCard.shared` | What [Name] shared that a note quoted (text, only when a note quoted it) |
| `talkCard.ask` | The question to ask, when [Name] shared nothing or isn't on Kenember (text) |
| `talkCard.edit` | "Edit": your words return to the bar; the card is replaced when kept again |
| `thread.talked`, `thread.letGo` | As above |

A touch outside closes it.

### `helped` — After We talked, new (optional)
| Id | Control |
| --- | --- |
| `helped.yes`, `helped.partly`, `helped.no` | Yes · Partly · No |
| `helped.skip` | Skip |

At most once a day, across all talk cards. Skip, or a touch outside, closes it with nothing recorded.

## Deferred
- Starting from Talk ("I need to talk to someone about something"), with Talk's starters.
- When: Tomorrow morning and At the check-in (scheduled sends, check-ins).
- Bringing a talk card to a check-in.
- Practising the conversation, or "what might they say": out on principle (PSYCHOLOGY.md).
