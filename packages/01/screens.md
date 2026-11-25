# Package 01: screens

Status: written by the explore chat on 24 Nov 2026, revised 25 Nov to the owner's answers and the greenhouse design. Not frozen.

## Design source

The greenhouse replaces the V3 look and navigation (owner, 24 Nov):
- **Package:** "Kenember design package: the greenhouse" `J6koT1C7knci3rdy1RAP3y` (wins over everything else).
- **Pages:** "Kenember, every page" `JRP65nx8pUoZMKFqbAm7Nd`.
- **Prototype:** "Kenember, the greenhouse" `TagZ4UKT9dZB6hCM53BcbS`. Every build value comes from it; where the package and the prototype disagree, the package wins.
- **System rules:** communication spec (CPO) `RKgowhverRSDWoYeRUFH2n` and insight engine review (PSY) `F2Sfu7SWYaiQgSADPfyAmJ`.

Where this package names a page id (Y4, Y5, P3 …) it is the id on "every page".

## One surface, not pages

There are no pages and no tab bar. Four views share one frosted pane over the greenhouse, and the talk bar sits at the bottom of all of them:
- **Talk** is home; the app opens here.
- **You** is pulled in from the left.
- **People** is pulled in from the right.
- **Thread** rises over People when a person is opened.

Cards (a suggestion, a kenning, a note, a received card) rise above the talk bar. Pulls follow the finger (package, "Views and gestures"). Every pull also exists as a VoiceOver action.

## The chain

1. **Sign-in.** `signIn`.
2. **First Talk.** `talk`, led by the engine's first question (communication engine, owner answer 2b).
3. **What I learned about you.** In Talk, the suggestion card and `scope`; after, `you` and `kenning`.
4. **Write with insight.** `people`, `someoneNew` (to have someone to write to), `thread`, then `pause` ("Before it goes").
5. **Send, and the other person reads it.** The card folds and sends; the other person gets a push, opens `thread`, and reads it on `reading`.

`safety` is shared by Talk, the pause and Someone new (law 8).

New account, own download: `signIn` → `aiConsent` → `talk`.
New account, from an invite link: `signIn` → `aiConsent` → `thread` with the inviter, the gift first (Q4).
Returning account: `talk` (or `aiConsent` first when the consent version has moved on).

`aiConsent` and `settings` are not in the five steps; they are what the five steps need to stay inside the App Store and privacy rules (`compliance.md`).

## Screens and controls

Control ids are `screen.control`; they are the `accessibilityIdentifier` values. A row list appends an index: `people.row.0`, `people.row.1`, …

### Everywhere
| Id | Control |
| --- | --- |
| `bar.field` | The talk bar's text (grows to 4 lines, then scrolls) |
| `bar.mic` | The engraved mic, shown while the bar is empty |
| `bar.send` | The apricot send, shown once the bar has words |
| `edge.left` | The left edge light: shows You |
| `edge.right` | The right edge light: shows People |

| `pull.mark` | The hand-drawn pull mark at the top: opens Settings (also a drag down from the top 140 pt) |

### `signIn` — Sign in (not drawn; built simply, Q1 decided)
| Id | Control |
| --- | --- |
| `signIn.apple` | Sign in with Apple (Apple's control) |
| `signIn.google` | Sign in with Google (Google's control) |
| `signIn.privacy` | "Privacy" |
| `signIn.retry` | "Try again" (failed state only) |

### `aiConsent` — Before Kenember's AI reads your words (not drawn; built simply, Q6 decided)
| Id | Control |
| --- | --- |
| `aiConsent.agree` | "Agree and continue" (the bar's send) |
| `aiConsent.notNow` | "Not now" |
| `aiConsent.privacy` | "Privacy" |

### `settings` — Settings (Y9, only the rows package 01 needs)
| Id | Control |
| --- | --- |
| `settings.ai` | "Kenember's AI" with On or Off: withdraw or give the AI consent |
| `settings.privacy` | "Privacy policy" |
| `settings.download` | "Download your data" |
| `settings.logOut` | "Log out" |
| `settings.delete` | "Delete my account" |
| `settings.confirmDelete` | "Delete" in the confirming card |
| `settings.cancelDelete` | "Keep my account" in the confirming card |

A touch anywhere outside the rows closes Settings.

### `talk` — Talk (Y4 first open, conversation, Y5 a suggestion)
| Id | Control |
| --- | --- |
| `talk.greeting` | Greeting and the one or two lines about what is real now (text) |
| `talk.message` | One of your messages (text; `talk.message.N`) |
| `talk.reply` | One reply (text; `talk.reply.N`) |
| `talk.suggestion` | The suggestion card (swipe right = That's me, left = Not now) |
| `talk.thatsMe` | That's me |
| `talk.partly` | Partly |
| `talk.notNow` | Not now |
| `talk.retry` | "Try again" under a turn that didn't go through |

### `scope` — Who sees this? (Y5, right after That's me or Partly)
| Id | Control |
| --- | --- |
| `scope.everyone`, `scope.partner`, `scope.family`, `scope.friends`, `scope.coworkers` | Scope words |
| `scope.only` | "Only with [Name]" (`scope.only.N`, one per linked person) |
| `scope.person` | A person under "Who sees this?" (`scope.person.N`) |
| `scope.onlyMe` | "Only me" |
| `scope.done` | Done (the bar's send) |

### `you` — You, as the list by kind (Y1 list)
| Id | Control |
| --- | --- |
| `you.item` | One kenning (`you.item.N`) |
| `you.talk` | "Talk" on the empty state |
| `you.retry` | "Try again" (failed state only) |

### `kenning` — A kenning (Y2), a card over You
| Id | Control |
| --- | --- |
| `kenning.card` | The card (tap outside closes) |
| `kenning.retry` | "Try again" (failed state only) |

### `people` — Your people (H1)
| Id | Control |
| --- | --- |
| `people.row` | One person (`people.row.N`) |
| `people.new` | "Someone new" |
| `people.retry` | "Try again" (failed state only) |

### `someoneNew` — Someone new (H2)
| Id | Control |
| --- | --- |
| `someoneNew.partner`, `someoneNew.friend`, `someoneNew.family` | Who are they to you? |
| `someoneNew.name` | Their first name |
| `someoneNew.gift` | The one thing they will see (Q3) |
| `someoneNew.change` | "Change" (Q3) |
| `someoneNew.share` | "Share the link" (the bar's send) |
| `someoneNew.retry` | "Try again" (failed state only) |

Pulling right or down closes Someone new.

### `thread` — A person (P1 without This week and check-in, P3 arrives, P4 writing)
| Id | Control |
| --- | --- |
| `thread.card` | One card (`thread.card.N`); a folded card to you opens on touch |
| `thread.keep` | Keep, under a card you have read |
| `thread.reply` | Reply, under a card you have read |
| `thread.retry` | "Try again" (failed state, or under a card that wasn't sent) |
| `thread.edit` | "Edit", under a card that couldn't be sent as written |

The bar reads "Write to [Name]" here.

### `reading` — First reading (P3)
| Id | Control |
| --- | --- |
| `reading.card` | Their words, alone; a touch anywhere ends the first reading |

### `pause` — Before it goes (P4 the pause, P4 [Name] shared nothing)
| Id | Control |
| --- | --- |
| `pause.note` | One note card (swipe right = Use it, left = Keep mine) |
| `pause.keepMine` | "‹ Keep mine" |
| `pause.useIt` | "Use it ›" |
| `pause.final` | The final card with the words [Name] will read (only when a note changed them) |
| `pause.send` | "Fold and send" (the bar's send), on the final card |

Pulling down goes back to writing, with the words as they are now.

### `safety` — Safety stop (not drawn; built simply, Q2 decided)
| Id | Control |
| --- | --- |
| `safety.resource` | One resource (`safety.resource.N`) |
| `safety.close` | "Close" |

## Deferred

Drawn in the greenhouse or on "every page", but outside the five steps:

- **Talk:** the starters on first open, Import from your AI, the When field for a kenning, "Ask about your kennings".
- **You:** the subway map (the CPO holds map work; package 01 shows the List by kind, which the greenhouse names as the same content), This week, + Add something, Y2 Edit · Change kind · Set aside, Y3 share What lands hard, kennings from feedback.
- **People and thread:** This week at the top, the check-in line, "What Jan shared", P10 Only you, "What may [Name] mean?" (P5, receiving-side insight, package 03), the R3 and R4 research questions, the When step (Now · Tomorrow morning · At the check-in: scheduled sends are package 02).
- **Mirror:** the link, the Mirror card, their page, feedback arriving and its notification (package 04).
- **Check-in:** P6 to P9 (package 02).
- **Settings and research:** the Y9 rows Appearance, Notifications, Mirror, Research and Learn from what I write; R1 research.
- **Outside the app:** the X1 invite web page and X3 story cards. The page at `kenember.com/i/<code>` lives in `site/`, not in an app package.
- **Platform:** the Action button, Live Activities, notification replies, widgets, Android (greenhouse package, "Not in this package").
- **Launch requirements (CONTRACT §11):** AI-provider consent, Report and Block.
