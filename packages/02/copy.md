# Package 02: copy

Status: draft, 27 Nov 2026. Every new string, byte for byte. Package 01's copy rules all hold: the app never says "I", `[Name]` is the first name, no counts or scores, none of the never-on-screen words, and nothing claims the app improves a relationship or how a conversation goes.

**Source:** *G* = the greenhouse package; *01* = package 01's copy, reused; *new* = written here.

## `when`
| Id | String | Source |
| --- | --- | --- |
| `when.label` | WHEN | G |
| `when.now` | Now | G |
| `when.talk` | When we talk | new |
| `when.keep` | Keep it | new (the bar's send with When we talk) |
| `pause.send` | Fold and send | 01 |

## Thread, talk cards
| Id | String | Source |
| --- | --- | --- |
| `bar.placeholderContact` | Get ready to talk to [Name] | new |
| `talkCard.label` | FOR WHEN YOU TALK · [WHEN] | new |
| `talkCard.only` | Only you see this. | new |
| `talkCard.notesLabel` | KEEP IN MIND | new |
| `talkCard.sharedLabel` | [NAME] SHARED | G ("JAN SHARED") |
| `talkCard.askLabel` | YOU COULD ASK | new |
| `talkCard.ask` | You could ask [Name] how they like hard things raised. | 01 (`pause.askLine`) |
| `talkCard.edit` | Edit | 01 |
| `thread.talked` | We talked | new |
| `thread.letGo` | Let go | new (V3 check-in "Let go") |
| `talkCard.notKept` | Not kept. | new |
| `talkCard.notSaved` | Not saved. Try again. | 01 (`thread.notSaved`) |
| `talkCard.unavailable` | Your talk cards can't be shown right now. | new |
| `talkCard.stale` | Still want this for when you talk? | new (shown once, after 14 days, with Let go) |
| `talkCard.a11y` | For when you talk, [when], only you see this | new |

## Before it goes, for a contact
| Id | String | Source |
| --- | --- | --- |
| `pause.basisContact` | [Name] isn't on Kenember, so this is based only on you. | new (from `pause.basisNothing`) |

## `helped`
| Id | String | Source |
| --- | --- | --- |
| `helped.question` | Did getting ready help you say it the way you meant? | new (from G's after-fold question) |
| `helped.yes` | Yes | G |
| `helped.partly` | Partly | G |
| `helped.no` | No | G |
| `helped.skip` | Skip | G |

## Contacts
| Id | String | Source |
| --- | --- | --- |
| `someoneNew.notHere` | Not on Kenember | new |
| `someoneNew.add` | Add [Name] | new |
| `someoneNew.nameProblem` | A first name is enough. | new |
| `someoneNew.sameName` | You already have [Name] here. | new |
| `someoneNew.open` | Open [Name] | new |
| `someoneNew.notAdded` | Not added. | new |
| `people.notHere` | NOT ON KENEMBER | new |
| `people.notHere.a11y` | [Name], not on Kenember | new |
| `people.removeContact` | Remove [Name] | new |
| `people.confirmRemove` | This removes [Name] and everything you wrote for them, for good. | new |
| `people.remove` | Remove | new |
| `people.keep` | Keep | 01 |
| `thread.invite` | Invite [Name] | new |
| `thread.contactEmpty` | Write what you want to say to [Name]. Only you see it. | new (the empty state's one line) |

## Server strings shown as they come
`why_line` on a note, `headline` on a refusal, and the safety `line` and `resources`: as package 01.

## Words checked against the rules
"When we talk" and "We talked" describe what the person does, never how it went. No string says the talk will go well, and none names a feeling.
