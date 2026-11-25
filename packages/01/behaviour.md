# Package 01: behaviour

What each control does in each state. "—" means not on screen. "Dimmed" means shown at the faint ink, not tappable, and read by VoiceOver as dimmed. The flows in `flows/` give the calls and next states.

Applies everywhere (greenhouse package):
- **One thing in front.** One card or one list at a time. Choices are short words of equal size; the only filled button is the apricot send in the bar.
- **Swipe to decide.** Yes-or-no is a swipe card: right accepts, left keeps or skips; its two answers sit at the edges and are also tappable.
- **Pulls.** A drag starts after 10 pt sideways and more sideways than up or down; release past 90 pt commits, less springs back. Each pull is also a VoiceOver action ("Show your kennings", "Show people", "Back to talk").
- **Cards** rise 16 pt above the bar in 0.5 s and close on a tap outside (sink 16 pt and fade).
- **Haptics,** and only these: a soft tick when a kenning card opens; a double soft pulse when a note opens; a light tap when listening starts; one firm haptic and the paper sound on send.
- **Reduce Motion:** no sway, drift, breathing or lamp sweep; views cross-fade in 0.2 s; the camera jumps.
- **Nothing moves while someone types, speaks or reads** a card's words.

## The talk bar (every view)
| Control | empty | has words | listening | sending (Talk) |
| --- | --- | --- | --- | --- |
| `bar.field` | Placeholder of the view; tap to type | Edits; grows to 4 lines, then scrolls | Text hidden | Read-only |
| `bar.mic` | Starts listening (light tap) | — | Stops; the words land in the bar; nothing sends | — |
| `bar.send` | — | Sends (in Talk), sends or opens the pause (in a thread), shares (Someone new), Done (`scope`), Fold and send (`pause.final`) | — | Dimmed |

## `edge.left`, `edge.right`
Shown on Talk; tapping runs the pull to You or People. On first launch both breathe three times. VoiceOver labels: "Your kennings", "Your people".

## `signIn`
| Control | signedOut | sheet open / exchanging | signInFailed |
| --- | --- | --- | --- |
| `signIn.apple` | Opens Apple's sheet | Dimmed | Opens Apple's sheet |
| `signIn.google` | Opens Google's sign-in | Dimmed | Opens Google's sign-in |
| `signIn.privacy` | Opens kenember.com/privacy in Safari | Dimmed | Same as signedOut |
| `signIn.retry` | — | — | Back to signedOut |

## `talk`
| Control | ready | sending | suggesting | turnFailed / limited / notOpen |
| --- | --- | --- | --- | --- |
| `talk.message.N`, `talk.reply.N` | Text | Text | Text, still | Text |
| `talk.suggestion` | — | — | Swipe right: That's me; left: Not now | — |
| `talk.thatsMe`, `talk.partly`, `talk.notNow` | — | — | Same size; That's me and Partly open `scope`; Not now sinks the card | — |
| `talk.retry` | — | — | — | turnFailed: sends the same words; hidden otherwise |

## `scope`
| Control | choosing | keeping |
| --- | --- | --- |
| Scope words | One at a time, underlined when chosen; "Only with [Name]" limits Who sees this to that person | Dimmed |
| `scope.person.N` | Toggles; nothing pre-ticked | Dimmed |
| `scope.onlyMe` | Clears the people | Dimmed |
| `scope.done` (bar send) | Keeps the item | Dimmed |

## `you`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `you.item.N` | — | — | — | Opens its card |
| `you.talk` | — | Back to Talk | — | — |
| `you.retry` | — | — | Loads again | — |

## `kenning`
| Control | loading / loaded / failed |
| --- | --- |
| `kenning.card` | Text only in package 01 (Edit, Change kind and Set aside are deferred, so they are not drawn); a tap outside closes |
| `kenning.retry` | Failed only: loads the receipt again |

## `people`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `people.row.N` | — | — | — | Opens the thread |
| `people.new` | Opens Someone new | Same | Same | Same |
| `people.retry` | — | — | Loads again | — |

VoiceOver reads a row as one element: "[Name], [line], [time]", plus "new" when the dot shows.

## `someoneNew`
| Control | loading | ready | writingOne | failed | creating / sharing |
| --- | --- | --- | --- | --- | --- |
| WHO words | Choose one; tap again to clear | Same | Same | Same | Dimmed |
| `someoneNew.name` | Edits (40 characters) | Same | Same | Same | Read-only |
| `someoneNew.gift` | — | Text, exactly as they will see it | — | — | Text |
| `someoneNew.change` | — | Next eligible item (only when there is more than one) | — | — | Dimmed |
| `someoneNew.share` (bar send) | Dimmed | Enabled once there is a name | Enabled once there is a name and words | Dimmed | Dimmed |
| `someoneNew.retry` | — | — | — | Loads again | — |

## `thread`
| Control | loading | empty | failed | loaded |
| --- | --- | --- | --- | --- |
| `thread.card.N` | — | — | — | A folded card to you: opens it. Any other card: text |
| `thread.keep` | — | — | — | Under a card you have read: keeps it |
| `thread.reply` | — | — | — | Under a card you have read: focuses the bar as a reply |
| `thread.retry` | — | — | Loads again | Under your unsent card: sends it again |
| `thread.edit` | — | — | — | Under a card refused as written: returns its words to the bar |

## `reading`
| Control | shown |
| --- | --- |
| `reading.card` | Their words and name only; a touch anywhere ends the first reading |

## `pause`
| Control | a note card | the fromMe card | final |
| --- | --- | --- | --- |
| `pause.note` | Swipe right: Use it; left: Keep mine | Swipe right: add it; left: Keep mine | — |
| `pause.keepMine`, `pause.useIt` | Same as the swipe | Same as the swipe | — |
| `pause.final` | — | — | Text, exactly as [Name] will read it |
| `pause.send` (bar send) | — | — | Folds and sends |

Pulling down from any pause state goes back to writing.

## `aiConsent`
| Control | showing | saving |
| --- | --- | --- |
| `aiConsent.agree` (bar send) | Gives consent | Dimmed |
| `aiConsent.notNow` | Goes on without the AI | Dimmed |
| `aiConsent.privacy` | Opens kenember.com/privacy | Same |

Agree and Not now are the same size; nothing is pre-chosen.

## `settings`
| Control | open | confirming | busy (withdrawing, exporting, deleting, logging out) |
| --- | --- | --- | --- |
| `pull.mark` | — | — | — |
| `settings.ai` | On: withdraws. Off: opens `aiConsent` | Dimmed | Dimmed |
| `settings.privacy` | Opens kenember.com/privacy | Dimmed | Dimmed |
| `settings.download` | Exports, then the share sheet | Dimmed | Dimmed |
| `settings.logOut` | Logs out | Dimmed | Dimmed |
| `settings.delete` | Opens the confirming card | — | Dimmed |
| `settings.confirmDelete`, `settings.cancelDelete` | — | Delete, or back to the rows; the same size | Dimmed |

`pull.mark` opens Settings from any view.

## `safety`
| Control | shown |
| --- | --- |
| `safety.resource.N` | Opens the resource in Safari |
| `safety.close` | Closes; the view below goes on as its flow says |

The card appears at once with no transition and nothing else moves. No hand-drawn touch and no apricot on it.
