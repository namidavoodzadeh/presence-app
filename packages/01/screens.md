# Package 01: screens

Status: written by the explore chat on 24 Nov 2026. Not frozen.

The five steps in `SCOPE.md`, as screens. Every screen is drawn in the frozen V3 design except where marked **not drawn**; those are in `QUESTIONS.md`. Light and dark follow the iPhone setting on every screen.

Design sources (owner's account): V3 package `QXJajT62N6rbVaUvmobHsE`, its screens page "Kenember next design" `65EPGuB7nAn8pPmky69nZY`, V3 flows `KX1q5g2B7yQQvS2pR2H4bz` (wins where it differs), remaining screens `66qiLKhtG3eDm36VGcSaqx`, communication spec `RKgowhverRSDWoYeRUFH2n`, insight engine review `F2Sfu7SWYaiQgSADPfyAmJ`.

## The chain

1. **Sign-in.** `signIn`.
2. **First Talk.** `talk`, led by the engine's opening question.
3. **What I learned about you.** `you`, `suggestions`, `kenning`.
4. **Write with insight.** `write`. To have someone to write to: `home`, `addPerson`, `invitePreview`, and on the other phone `gift`.
5. **Send, and the other person reads it.** `write` sends; the other person sees it on `home` and `person`, and reads it on `card`.

`safety` is shared by Talk and Write (law 8).

New account, own download: `signIn` → `talk` → (✕) `you` → (‹) `home`.
New account, from an invite link: `signIn` → `gift` → `home`.
Returning account: `home`.

## Screens

Control ids are `screen.control`. They are the `accessibilityIdentifier` values (AGENTS.md).

### `signIn` — Sign in (not drawn: Q1)
| Id | Control |
| --- | --- |
| `signIn.apple` | Apple's Sign in with Apple button (system control) |
| `signIn.privacy` | "Privacy" link |
| `signIn.retry` | Try again (failed state only) |

### `talk` — Talk (V3 "Talking" and "After you stop")
Opens as an act: rises from the bottom.
| Id | Control |
| --- | --- |
| `talk.close` | ✕, top left |
| `talk.question` | The app's line at the top: reflection, then question (text, not a button) |
| `talk.mic` | The big mic: tap to talk, tap to stop |
| `talk.type` | "or type": opens the keyboard and a text field |
| `talk.field` | The text field (typing mode) |
| `talk.sendTyped` | Return key / send for typed words |
| `talk.words` | The person's words on paper (text) |
| `talk.consentSure`, `talk.consentNotNow`, `talk.consentNever` | Consent chips (not drawn: Q3) |
| `talk.card` | Suggestion swipe card (swipe right = That's me, left = Not now) |
| `talk.cardNotNow` | "not now" under the card |
| `talk.cardThatsMe` | "that's me" under the card |
| `talk.cardDots` | Dots for the queued cards (no count) |
| `talk.retry` | Try again (failed turn only) |

### `you` — You (Y1 as in V3 flows Q19; empty state F5 · You)
A place: slides in from the left.
| Id | Control |
| --- | --- |
| `you.back` | ‹ to Home |
| `you.suggestionsRow` | "Suggestions waiting" dashed-glass row, shown only when at least one waits |
| `you.kenning` | One row per kenning (one id per row, index appended by the list: `you.kenning.0`, `you.kenning.1`, …) |
| `you.talk` | Talk, the one primary |
| `you.retry` | Try again (failed state only) |

### `suggestions` — Suggestions (Y5)
An act.
| Id | Control |
| --- | --- |
| `suggestions.close` | ✕ |
| `suggestions.card` | The swipe card |
| `suggestions.notNow` | Not now |
| `suggestions.thatsMe` | That's me |
| `suggestions.dots` | Dots (no count) |
| `suggestions.retry` | Try again (failed state only) |

### `kenning` — Kenning detail (Y2, thin)
A place.
| Id | Control |
| --- | --- |
| `kenning.back` | ‹ |
| `kenning.words` | The kenning in the person's words (text) |
| `kenning.receipt` | "You said: …" with where and when (text) |
| `kenning.done` | Done |
| `kenning.retry` | Try again (failed state only) |

### `home` — Home (card stack, at rest; F5 · Home line)
| Id | Control |
| --- | --- |
| `home.person` | One card per person (`home.person.0` …, lowest = most urgent, as the server orders them) |
| `home.addAboutYou` | "Add something about you" line (only while You has no kenning and someone is on Home) |
| `home.you` | Your initial in the bar: opens You |
| `home.write` | Write, the wide button |
| `home.add` | + : opens Add a person |
| `home.retry` | Try again (failed state only) |

### `addPerson` — Add a person (F4, without the HOW step)
An act.
| Id | Control |
| --- | --- |
| `addPerson.close` | ✕ |
| `addPerson.partner`, `addPerson.friend`, `addPerson.family` | WHO chips |
| `addPerson.name` | NAME field |
| `addPerson.cancel` | Cancel |
| `addPerson.next` | Next |

### `invitePreview` — Invite preview (F4 · preview; F4b when there is no kenning)
| Id | Control |
| --- | --- |
| `invitePreview.back` | ‹, top left |
| `invitePreview.backButton` | Back, bottom left (same action as ‹) |
| `invitePreview.picked` | The picked kenning, shown as the other person will see it |
| `invitePreview.other` | "Or give this one" rows (`invitePreview.other.0`, `.1`) |
| `invitePreview.ownLine` | F4b: "Write one thing about you for [Name]" field |
| `invitePreview.send` | Send invite (apricot); opens the iOS share sheet |
| `invitePreview.retry` | Try again (failed state only) |

### `gift` — Invited person's first open (F3b)
| Id | Control |
| --- | --- |
| `gift.words` | The kenning given (text) |
| `gift.continue` | Continue |
| `gift.retry` | Try again (failed state only) |

### `person` — Person page (P1, thin: the OPEN block only)
A place.
| Id | Control |
| --- | --- |
| `person.back` | ‹, top left |
| `person.backButton` | Back, bottom left (same action as ‹) |
| `person.item` | One row per card (`person.item.0` …) |
| `person.write` | Write to [Name] |
| `person.retry` | Try again (failed state only) |

### `write` — Write (P4, with F1's single Send and the first-message card)
An act.
| Id | Control |
| --- | --- |
| `write.close` | ✕ |
| `write.field` | The words, on paper |
| `write.notesLine` | "Notes on how [Name] may hear this · See ›" |
| `write.note` | Note swipe card (right = change it, left = keep yours) |
| `write.noteKeep` | keep yours |
| `write.noteChange` | change it |
| `write.noteDots` | Dots (no count) |
| `write.skipNotes` | Skip the notes |
| `write.own` | "From what you said" card (right = add it, left = not now) |
| `write.ownNotNow` | not now |
| `write.ownAdd` | add it |
| `write.closeButton` | Close (bottom left) |
| `write.send` | Send (apricot) |
| `write.edit` | Edit (refusal state only) |

### `card` — Card opened (P3, first reading)
An act. The first reading has no app commentary (V3 rule 6).
| Id | Control |
| --- | --- |
| `card.close` | ✕ |
| `card.text` | The words (text) |
| `card.keep` | Keep |
| `card.reply` | Reply (apricot) |
| `card.retry` | Try again (failed state only) |

### `safety` — Safety stop (not drawn: Q3)
| Id | Control |
| --- | --- |
| `safety.resource` | One link per resource (`safety.resource.0` …) |
| `safety.close` | Close |

## Deferred

Drawn in V3 but outside the five steps. Not built in package 01.

- **Home:** finger-on-card lift and its preview; check-in lines; sent-card envelope beyond the send itself; H3 first run "Who's on your mind?" (it opens a first message before anyone is linked, which needs a pending-recipient design).
- **Person page:** "What you both share" and Share something with [Name]; Talked about; All [Name] shared; This week; the check-in line.
- **Write:** "To [Name] ▾" switching; the time chip ("Now ▾", "At the check-in ▾") and Send at a later time; Hold for check-in; notes read aloud with headphones and voice "keep"/"change"; notes grounded in what the receiver shared (Tier 3); the sender research question; Talk it through after a refusal.
- **Card:** "What may [Name] mean?" (receiving-side insight, package 03); Remind me later; Let's talk; the receiver research question.
- **Talk:** "· another" question; tap to edit a suggestion; Partly; read-aloud; the scope step after That's me; streaming voice; kind labels on cards.
- **You:** Ask (Mirror); Everyone / [Name] seen-by chips and What [Name] sees; the gear and Settings (including Log out, Download your data and Delete my account); + Add with the kind picker; carry-over cards.
- **Kenning detail:** Who can see it; Edit the words; Set it down; Still true?; kind, scope, when.
- **Invite preview:** "Edit the words picked for [Name]".
- **Everything in package 02 to 04:** import from your AI, scheduled sends, check-ins, receiving-side insight, the map, cards (story and share), Mirror.
- **Outside the app:** the invite web page already exists in `site/_worker.js`; the friend's answer page and story cards are later.
- **Launch requirements (CONTRACT §11):** the AI-provider consent screen (L6), Report and Block (L3). Needed before App Store review, not for this chain.
