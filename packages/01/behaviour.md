# Package 01: behaviour

What each control does in each state, per screen. "—" means the control is not on screen in that state. "Disabled" means shown, dimmed, and not tappable, with VoiceOver reading it as dimmed. The flows in `flows/` give the calls and the next states.

Applies everywhere:
- One primary action per screen, in the bottom third, with its exit the same size to its left (V3 rule 13). Apricot only on an action that reaches another person, at most once per screen (rule 10): `write.send`, `invitePreview.send`, `card.reply`.
- Pressed state: the system highlight only; no scale, bounce or ripple. Nothing moves while someone types or speaks.
- Places (`home`, `you`, `kenning`, `person`) slide sideways and follow the finger; edge swipe goes back. Acts (`talk`, `suggestions`, `addPerson`, `invitePreview`, `write`, `card`) rise and close downward; drag down closes them, with the same result as their ✕.
- Haptics: firm on send; light on confirming a kenning. Insight never buzzes. Sounds: one paper sound on send and on confirming a kenning.
- Reduce Motion: places and acts cross-fade in 200 ms; the fold cross-fades; the envelope fades between 100% and 55% instead of folding.

## `signIn`
| Control | signedOut | appleSheet / exchanging | signInFailed |
| --- | --- | --- | --- |
| `signIn.apple` | Opens Apple's sheet | Disabled | Opens Apple's sheet |
| `signIn.privacy` | Opens kenember.com/privacy in Safari | Disabled | Opens kenember.com/privacy |
| `signIn.retry` | — | — | Opens Apple's sheet again |

## `talk`
| Control | loading | ready | listening | typing | sending | cardUp | consent | turnFailed / limited |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `talk.close` | Closes (finish if a conversation exists) | Same | Stops listening, then closes | Same | Closes; a reply that lands later is found by the next Talk | Closes; unanswered cards stay suggestions | Closes | Closes |
| `talk.mic` | Hidden | Starts listening | Stops and sends | — | Disabled | — | Starts listening (the chips go) | Hidden on limited; on turnFailed starts listening for new words |
| `talk.type` | Hidden | Opens typing | — | — | Disabled | — | Opens typing (the chips go) | Same as mic |
| `talk.field` | — | — | — | Edits the words | Read-only | — | — | — |
| `talk.sendTyped` | — | — | — | Sends when not empty | — | — | — | — |
| `talk.consentSure` / `NotNow` / `Never` | — | — | — | — | — | — | Sends the answer | — |
| `talk.card` | — | — | — | — | — | Swipe right: That's me; left: Not now; past 50% of the width or a flick over 300 pt/s, else it settles back | — | — |
| `talk.cardNotNow` / `talk.cardThatsMe` | — | — | — | — | — | Same as the swipe | — | — |
| `talk.retry` | — | — | — | — | — | — | — | turnFailed: sends the same words again. limited: hidden |

While a rating is saving, the card stays in place and its buttons are disabled.

## `you`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `you.back` | Home | Home | Home | Home |
| `you.suggestionsRow` | — | — | — | Opens Suggestions (shown only when at least one suggestion waits) |
| `you.kenning.N` | — | — | — | Opens kenning detail |
| `you.talk` | Opens Talk | Opens Talk | Opens Talk | Opens Talk |
| `you.retry` | — | — | Loads again | — |

## `suggestions`
| Control | loading | failed | loaded (cardUp) | rating |
| --- | --- | --- | --- | --- |
| `suggestions.close` | Closes | Closes | Closes; the rest stay suggestions | Closes after the save answers |
| `suggestions.card` | — | — | Swipe right: That's me; left: Not now | Disabled |
| `suggestions.notNow` / `thatsMe` | — | — | Same as the swipe | Disabled |
| `suggestions.retry` | — | Loads again | — | — |

## `kenning`
| Control | loading | failed | loaded |
| --- | --- | --- | --- |
| `kenning.back` / `kenning.done` | Back to You | Back to You | Back to You |
| `kenning.retry` | — | Loads again | — |

## `home`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `home.person.N` | — | — | — | Unread: opens the oldest ready card. "Not sent": opens Write with the kept words. Otherwise: opens the person page |
| `home.addAboutYou` | — | — | — | Opens Talk |
| `home.you` | Opens You | Opens You | Opens You | Opens You |
| `home.write` | Disabled | Opens Add a person | Disabled | Opens Write to the person on the lowest card |
| `home.add` | Opens Add a person | Same | Same | Same |
| `home.retry` | — | — | Loads again | — |

VoiceOver reads each card as one element: "[Name], [line]". The send envelope is decorative inside that label.

## `addPerson`
| Control | name empty | name has a letter |
| --- | --- | --- |
| `addPerson.close` / `addPerson.cancel` | Closes, nothing kept | Same |
| WHO chips | Select one; tapping the selected chip clears it | Same |
| `addPerson.name` | Edits (40 characters at most) | Same |
| `addPerson.next` | Disabled | Opens the invite preview |

## `invitePreview`
| Control | loading | empty (F4b) | failed | loaded (picked) | sending |
| --- | --- | --- | --- | --- | --- |
| `invitePreview.back` / `backButton` | Back to Add a person | Same | Same | Same | Disabled |
| `invitePreview.other.N` | — | — | — | Makes it the picked kenning | Disabled |
| `invitePreview.ownLine` | — | Edits (400 characters at most) | — | — | Read-only |
| `invitePreview.send` | Disabled | Disabled until there is a letter, then saves the line and creates the invite | Disabled | Creates the invite, then the share sheet | Disabled |
| `invitePreview.retry` | — | — | Loads again | — | — |

## `gift`
| Control | loading | failed | loaded | dead or own link |
| --- | --- | --- | --- | --- |
| `gift.continue` | — | — | Accepts, then Home | Home |
| `gift.retry` | — | Loads again | — | — |

## `person`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `person.back` / `backButton` | Home | Home | Home | Home |
| `person.item.N` | — | — | — | A card to you: opens it. A card you sent: not tappable (VoiceOver reads it as text) |
| `person.write` | Opens Write | Opens Write | Opens Write | Opens Write |
| `person.retry` | — | — | Loads again | — |

## `write`
| Control | editing | reading | ownUp | notesReady | noteUp | ready | refused | not connected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `write.close` / `closeButton` | Saves the draft and closes | Same | Same | Same | Same | Same | Same | Same |
| `write.field` | Edits | Edits (cancels the read) | Edits (the card goes) | Edits (notes go) | Read-only while a card is up; a tap on the words lowers the keyboard and scrolls the card into view | Edits | Edits | Read-only |
| `write.own`, `ownNotNow`, `ownAdd` | — | — | Swipe or tap: add it or not now | — | — | — | — | — |
| `write.notesLine` | — | — | — | Opens the first note | — | — | — | — |
| `write.note`, `noteKeep`, `noteChange` | — | — | — | — | Swipe or tap: keep yours or change it | — | — | — |
| `write.skipNotes` | — | — | — | — | Closes the notes | — | — | — |
| `write.send` | Sends (disabled when empty) | Sends (the read is cancelled) | Sends | Sends | Sends | Sends | Disabled | Disabled |
| `write.edit` | — | — | — | — | — | — | Back to editing | — |

Send never waits for a note. With headphones nothing is read aloud in package 01.

## `card`
| Control | loading | failed | loaded |
| --- | --- | --- | --- |
| `card.close` | Closes to the person page | Same | Same |
| `card.keep` | — | — | Closes to the person page; the card stays there (Q5) |
| `card.reply` | — | — | Opens Write to the sender, as a reply to this card |
| `card.retry` | — | Opens again | — |

## `safety`
| Control | shown |
| --- | --- |
| `safety.resource.N` | Opens the resource's `url` in Safari |
| `safety.close` | Closes the sheet; the screen below goes on as its flow says |

The sheet appears at once, with no transition, and nothing else on screen moves. No hand-drawn mark, no apricot.
