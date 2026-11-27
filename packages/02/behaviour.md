# Package 02: behaviour

Status: draft, 27 Nov 2026. Package 01's general rules hold: one thing in front, swipe to decide, pulls, card motion, the closed haptics list, Reduce Motion, nothing moves while someone types. "—" means not on screen.

## The talk bar in a thread
| Control | Linked person | Contact |
| --- | --- | --- |
| `bar.field` placeholder | "Write to [Name]" (package 01) | "Get ready to talk to [Name]" |
| `bar.send`, words in the bar | opens the pause, or `when` when nothing is unanswered | the same |
| `bar.send`, `when` shown | "Fold and send" with Now; "Keep it" with When we talk | "Keep it" |

## `when`
| Control | Linked person | Contact | saving |
| --- | --- | --- | --- |
| `when.now` | Chooses Now (chosen first) | — | Dimmed |
| `when.talk` | Chooses When we talk | Shown alone, chosen | Dimmed |

Choosing gives the soft tick. Keeping a talk card gives one light tap and no paper sound: nothing is sent.

## `thread`, talk cards
| Control | kept | saving | notKept | open |
| --- | --- | --- | --- | --- |
| `thread.talkCard.N` | Touch opens `talkCard` | Dimmed, the knot breathing | Dimmed; Try again under it | — |
| `thread.retry` | — | — | Saves again with the same body | — |
| `thread.talked` | — | — | — | Closes the card as talked, then maybe `helped` |
| `thread.letGo` | — | — | — | Closes the card as let go |
| `thread.invite` (contact) | Opens Someone new with the name and chip filled in | the same | the same | — |

## `talkCard`
| Control | open | closing |
| --- | --- | --- |
| `talkCard.edit` | The words go to the bar; the card stays until the new one is kept | Dimmed |
| `talkCard.note.N` | Text only | Text only |
| A touch outside | Closes it | — |

## `helped`
Three short words of equal size and Skip, as the greenhouse's after-fold question. One tap answers and closes. No answer is ever shown back, counted on screen or used to change a note.

## `someoneNew`, Not on Kenember
| Control | invite form | Not on Kenember | saving |
| --- | --- | --- | --- |
| `someoneNew.notHere` | Switches to Not on Kenember | Switches back | Dimmed |
| `someoneNew.add` (bar's send) | — | Shown once a name is typed | Dimmed |

## `people`, a contact's row
| Gesture | Does |
| --- | --- |
| Tap | Opens the contact's thread |
| Long press | "Remove [Name]", then the confirming card (`people.confirmRemove`, Remove · Keep) |

VoiceOver: a contact's row reads "[Name], not on Kenember". The talk card reads "For when you talk, [when], only you see this", then its words. Every gesture above is also a VoiceOver action.
