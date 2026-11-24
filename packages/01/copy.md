# Package 01: copy

Every string the package shows. Byte for byte. Ids match `screens.md`; an id that is not a control there is a string key only. `.a11y` is a VoiceOver label for a control with no visible text.

**Source column:** *V3* = drawn in the frozen design; *CPO* = the communication spec's words; *server* = text the server sends and the app shows as sent; *new* = written here because the design does not have it (the owner freezes it with the package). Small-caps headings in the design (for example "IS THIS YOU?") are typography; the string is in sentence case.

**Rules every string here obeys** (laws 4, 5, 7 and V3 rules 1, 5, 11):
- The app never says "I" and has no name or face of its own.
- `[Name]` is the other person's first name, never a pronoun. `[Me]` is the signed-in person's first name.
- No counts, scores, percentages or levels: dots instead of "1 of 2", and no "2 notes".
- Nothing clinical or evaluative. None of these words appear on screen: flooding, pursuer, withdrawer, avoidant, anxious, attachment, rejection sensitivity, love language, Four Horsemen, contempt, toxic, red flag, trigger, style, pattern, diagnosis, healthy, unhealthy.
- Describe, never prescribe a belief; a note is about wording only.
- Dates: "Monday" for the last seven days, else "12 November"; times in the reader's own zone, iPhone 12/24-hour setting.

## `signIn`
| Id | String | Source |
| --- | --- | --- |
| `signIn.line` | Say hard things the way you mean them. | new |
| `signIn.adult` | Kenember is for adults. By continuing, you confirm you're 18 or over. | new |
| `signIn.apple` | (Apple's own button text, "Sign in with Apple") | system |
| `signIn.ai` | Kenember is an AI, not a person. | V3 (Settings) |
| `signIn.privacy` | Privacy | new |
| `signIn.appleFailed` | Apple couldn't confirm this sign-in. | new |
| `signIn.serverFailed` | Signing in didn't finish. | new |
| `signIn.offline` | You're offline. | new |
| `signIn.retry` | Try again | new |

## `talk`
| Id | String | Source |
| --- | --- | --- |
| `talk.question` | `reply.reflection`, then `reply.question` (or the opener's `question`) | server |
| `talk.fallbackOpener` | What's one moment from this week that's still with you? | server's fixed opener wording, kept on the phone |
| `talk.idleHint` | Tap to talk · or type | new (from the drawn "Tap to stop · or type") |
| `talk.listeningHint` | Tap to stop · or type | V3 |
| `talk.fieldPlaceholder` | Type what happened | new |
| `talk.mic.a11y` | Talk / Stop | new |
| `talk.close.a11y` | Close | new |
| `talk.cardHeader` | Is this true about you? | V3 |
| `talk.card` | `offered_wording`, else `statement` | server |
| `talk.cardNotNow` | ← not now | V3 |
| `talk.cardThatsMe` | that's me → | V3 |
| `talk.cardFooter` | Only you see these. | V3 (first half dropped: it named Write before the person has seen it) |
| `talk.cardDots.a11y` | More to look at after this one | new |
| `talk.notSaved` | Not saved. Try again. | new |
| `talk.consentSure` | Sure | server contract (T08) |
| `talk.consentNotNow` | Not now | server contract (T08) |
| `talk.consentNever` | Never | server contract (T08) |
| `talk.turnFailed` | That didn't go through. Your words are still here. | new |
| `talk.limited` | Talk opens again at [time]. / Talk opens again on [day]. | server wording, formatted on the phone from `opens_at` |
| `talk.retry` | Try again | new |

## `you`
| Id | String | Source |
| --- | --- | --- |
| `you.title` | You | V3 |
| `you.back.a11y` | Home | new |
| `you.emptyLine` | Say one thing that's true for you. It stays here until you share it. | V3 (F5) |
| `you.suggestionsRow` | Suggestions waiting | V3 (Q19) |
| `you.suggestionsSub` | From what you said in Talk. Only you see these. | V3 (Q19) |
| `you.heading` | Your kennings | V3 (Q19) |
| `you.kenningLine` | Something true about you, in your words. You choose who sees it. | CPO |
| `you.kenning` | `own_wording`, else `wording` | server |
| `you.talk` | Talk | V3 |
| `you.unavailable` | Your kennings can't be shown right now. | new |
| `you.retry` | Try again | new |

## `suggestions`
| Id | String | Source |
| --- | --- | --- |
| `suggestions.title` | Suggestions | V3 (Y5) |
| `suggestions.close.a11y` | Close | new |
| `suggestions.header` | Is this you? | V3 (Y5) |
| `suggestions.card` | “`offered_wording`, else `wording`” | server |
| `suggestions.source` | From Talk, [date] | V3 (Y5) |
| `suggestions.notNow` | Not now | V3 (Y5) |
| `suggestions.thatsMe` | That's me | V3 (Y5) |
| `suggestions.notSaved` | Not saved. Try again. | new |
| `suggestions.unavailable` | Suggestions can't be shown right now. | new |
| `suggestions.retry` | Try again | new |

## `kenning`
| Id | String | Source |
| --- | --- | --- |
| `kenning.back.a11y` | You | new |
| `kenning.words` | `own_wording`, else `statement` | server |
| `kenning.receipt` | You said: “[quote]” | V3 (Y2) |
| `kenning.whereTalk` | Said in Talk, [date] · confirmed That's me | V3 (Y2) |
| `kenning.whereOwn` | Written by you, [date] | new (a kenning typed on the invite preview) |
| `kenning.done` | Done | V3 (Y2) |
| `kenning.unavailable` | This kenning can't be shown right now. | new |
| `kenning.retry` | Try again | new |

## `home`
| Id | String | Source |
| --- | --- | --- |
| `home.wordmark` | (the Kenember wordmark image) | V3 |
| `home.lineUnread` | New card from [Name] | V3 |
| `home.lineDraft` | Draft | V3 |
| `home.lineNothing` | Nothing open | V3 |
| `home.lineNotSent` | Not sent | new |
| `home.person.a11y` | [Name], [line] | V3 flows (QA-B271 ruling) |
| `home.addAboutYou` | Add something about you | V3 (F5) |
| `home.you.a11y` | You | new |
| `home.write` | Write | V3 |
| `home.add.a11y` | Add a person | new |
| `home.unavailable` | Your people can't be shown right now. | new |
| `home.retry` | Try again | new |

A person's line is chosen from the top `reason` in `GET /home`: `unread` → `home.lineUnread`; `draft` → `home.lineDraft`; anything else or none → `home.lineNothing`. A send that has not been confirmed shows the breathing envelope instead of changing the line; a failed send shows `home.lineNotSent`.

## `addPerson`
| Id | String | Source |
| --- | --- | --- |
| `addPerson.title` | Add a person | V3 |
| `addPerson.close.a11y` | Close | new |
| `addPerson.who` | Who | V3 |
| `addPerson.partner` | Partner | V3 |
| `addPerson.friend` | Friend | V3 |
| `addPerson.family` | Family | V3 |
| `addPerson.nameLabel` | Name | V3 |
| `addPerson.namePlaceholder` | First name | new |
| `addPerson.note` | Next shows exactly what [Name] will see. The link works for [Name] only and expires in 7 days. | V3 (F4); shown once the name has a letter |
| `addPerson.cancel` | Cancel | V3 |
| `addPerson.next` | Next | V3 |

## `invitePreview`
| Id | String | Source |
| --- | --- | --- |
| `invitePreview.title` | Invite [Name] | V3 |
| `invitePreview.back.a11y` | Back | new |
| `invitePreview.allTheySee` | This is all [Name] will see. | V3 |
| `invitePreview.exactWords` | [Name] will read exactly these words. | V3 |
| `invitePreview.cardHeader` | [Me] shared something with you | V3, changed: the drawn "…about herself…" needs a pronoun the app does not know |
| `invitePreview.picked` | the kenning's `own_wording` | server |
| `invitePreview.orGive` | Or give this one | V3 |
| `invitePreview.ownPlaceholder` | Write one thing about you for [Name] | V3 (F4b) |
| `invitePreview.ownHelper` | In your words. It becomes a kenning shared with [Name] only. | V3 (F4b) |
| `invitePreview.tooLong` | Keep it under 400 characters. | new |
| `invitePreview.notSent` | The invite wasn't made. Try again. | new |
| `invitePreview.backButton` | Back | V3 |
| `invitePreview.send` | Send invite | V3 |
| `invitePreview.shareText` | [Me] shared something with you on Kenember. This link is for you only: [link] | new |
| `invitePreview.unavailable` | Your kennings can't be shown right now. | new |
| `invitePreview.retry` | Try again | new |

## `gift`
| Id | String | Source |
| --- | --- | --- |
| `gift.header` | [Name] shared something with you | V3 (F3b), changed as above |
| `gift.words` | the words given | server |
| `gift.sub` | In [Name]'s words. [Name] chose to give you this first. | V3 (F3b) |
| `gift.continue` | Continue | V3 (F3b) |
| `gift.dead` | This invite link doesn't work any more. Ask for a new one. | new |
| `gift.own` | This is your own invite link. Send it to the person it's for. | new |
| `gift.notSent` | That didn't go through. Try again. | new |
| `gift.unavailable` | This invite can't be opened right now. | new |
| `gift.retry` | Try again | new |

## `person`
| Id | String | Source |
| --- | --- | --- |
| `person.back.a11y` | Home | new |
| `person.open` | Open | V3 |
| `person.itemFromThem` | A card from [Name] · [date] | V3 |
| `person.itemNew` | new | V3 |
| `person.itemMine` | Your card · [date] | V3 (F6, without the check-in part) |
| `person.empty` | Nothing open | V3 |
| `person.backButton` | Back | V3 |
| `person.write` | Write to [Name] | V3 |
| `person.unavailable` | [Name]'s cards can't be shown right now. | new |
| `person.retry` | Try again | new |

## `write`
| Id | String | Source |
| --- | --- | --- |
| `write.title` | To [Name] | V3 |
| `write.close.a11y` | Close | new |
| `write.placeholder` | Write to [Name] | new |
| `write.notesLine` | Notes on how [Name] may hear this | V3, changed: "2 notes" removed (V3 rule 5, no count of problems) |
| `write.notesSee` | See › | V3 |
| `write.noteHeader` | May land hard | V3 |
| `write.noteBody` | [why_line] Try “[suggested]”. | why_line: server; frame: V3 |
| `write.noteKeep` | ← keep yours | V3 |
| `write.noteChange` | change it → | V3 |
| `write.noteDots.a11y` | More notes after this one | new |
| `write.skipNotes` | Skip the notes | V3 |
| `write.ownHeader` | From what you said | V3 (first message) |
| `write.ownLine` | “[line]” | server (`/bridge/why-it-matters`) |
| `write.ownAsk` | Add it to your message? | V3 (first message) |
| `write.ownNotNow` | ← not now | V3 (first message) |
| `write.ownAdd` | add it → | V3 (first message) |
| `write.basisNothing` | [Name] hasn't shared anything yet, so this is based only on you. | V3 and CPO |
| `write.basisWordsOnly` | These notes come from your words, not from what [Name] shared. | new (when [Name] has shared something, package 01 still makes notes from words only) |
| `write.ready` | Ready to fold | V3 (F1) |
| `write.closeButton` | Close | V3 |
| `write.send` | Send | V3 (F1) |
| `write.refused` | This can't be sent as written. | new |
| `write.refusedWhy` | `headline` | server |
| `write.edit` | Edit | new |
| `write.notConnected` | You and [Name] aren't connected on Kenember now. | server contract (v1.93) |
| `write.notSent` | This wasn't sent. Your words are here. | new |

**The why lines** (server, `next/engine/bridge/insight_copy.json`, reviewed and linted by the engine; shown only for highlights with a `friction_kind`; a highlight about the receiver is not shown in package 01):

| `friction_kind` | Line |
| --- | --- |
| absolute | Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost. |
| character | A word about who someone is tends to be heard before what they did, so the moment itself can get lost. |
| mind_reading | A line about what they feel or mean tends to be heard as a claim about them, and invites a correction instead of an answer. |
| sarcasm | Words that mean their opposite often land as a jab, so the point underneath can be missed. |
| contempt | Words that look down on the person tend to be heard as the whole message, so the point underneath can get lost. |
| demand | An order tends to be heard as something to push back on; a request tends to be heard as something to answer. |
| blame_stack | Several old moments at once tend to be heard as a verdict, and the one that matters today can get lost in the pile. |
| vague_ask | This says something has to change; it does not yet say what you want them to do. |
| heat | A word like hate tends to be heard as the size of the message, so the point underneath can get lost behind it. |
| you_blame | A line about what they do tends to be heard as blame, and invites a defence instead of an answer. |

When `suggested` equals `original` (a vague_ask note), `write.noteBody` is the why line alone, and the card has "keep yours" only.

## `card`
| Id | String | Source |
| --- | --- | --- |
| `card.title` | From [Name] | V3 |
| `card.close.a11y` | Close | new |
| `card.meta` | [Name] · [date] [time] | V3 |
| `card.text` | `final` | server |
| `card.keep` | Keep | V3 |
| `card.reply` | Reply | V3 |
| `card.unavailable` | This card can't be opened right now. | new |
| `card.retry` | Try again | new |

## `safety`
| Id | String | Source |
| --- | --- | --- |
| `safety.message` | `safety.message` (Talk) or `line` (Write, invite) | server |
| `safety.resource.N` | the resource's `label` | server |
| `safety.close` | Close | new |

## Shared
| Id | String | Source |
| --- | --- | --- |
| `wait.a11y` | Loading | V3 flows |
| `wait.slow` | the screen's `*.unavailable` line, after 10 s | V3 flows |

## Server text the app does not show as sent
- `POST /bridges` 403 `message` "I won't carry this one." and `/bridge/insight` declined `line` "I won't rewrite this one." say "I" (V3 rule 1). The app shows `write.refused` and the server's `headline` instead.
- Any error `message` from the server. The app shows its own line for the screen; the Ref is logged, never shown.
