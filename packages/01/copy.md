# Package 01: copy

Every string the package shows. Byte for byte. Ids match `screens.md`; an id that is not a control there is a string key only. `.a11y` is a VoiceOver label.

**Source:** *G* = the greenhouse package or "every page"; *CPO* = the communication spec; *V3* = carried from the V3 design where the greenhouse has no string; *server* = text the server sends; *system* = Apple's or Google's own; *new* = written here (frozen with the package). Labels the design sets in caps ("WHO SEES THIS?") are spelled in caps; everything else is sentence case.

**Rules every string obeys** (laws 4, 5, 7 as amended; CPO "Words"):
- The app never says "I" and has no name or face of its own.
- `[Name]` is the other person's first name, never a pronoun. `[Me]` is the signed-in person's first name.
- No counts, scores or percentages: dots instead of "1 of 2".
- None of these on screen: flooding, pursuer, withdrawer, avoidant, anxious, attachment, rejection sensitivity, love language, Four Horsemen, contempt, toxic, red flag, trigger, style, pattern, diagnosis, healthy, unhealthy.
- Claims rule (Nami, 15 Nov): nothing says the app improves a relationship or reduces conflict.
- When words: "now", "this morning", "this afternoon", "this evening", "yesterday", a weekday within the week, else "12 Nov"; in labels they are caps ("THIS MORNING").

## `signIn`
| Id | String | Source |
| --- | --- | --- |
| `signIn.line` | Say hard things the way you mean them. | new |
| `signIn.adult` | Kenember is for adults. By continuing, you confirm you're 18 or over. | new |
| `signIn.apple`, `signIn.google` | the providers' own button text | system |
| `signIn.ai` | Kenember is an AI, not a person. | V3 |
| `signIn.privacy` | Privacy | new |
| `signIn.providerFailed` | That sign-in didn't go through. | new |
| `signIn.serverFailed` | Signing in didn't finish. | new |
| `signIn.offline` | You're offline. | new |
| `signIn.retry` | Try again | new |

## `signIn`, age
| Id | String | Source |
| --- | --- | --- |
| `signIn.underAge` | Kenember is for adults, so it can't be used on this account. | new |
| `signIn.deleted` | Your account and everything in it are deleted. | new (shown once after deleting) |

## `aiConsent`
| Id | String | Source |
| --- | --- | --- |
| `aiConsent.title` | Before Kenember's AI reads your words | new |
| `aiConsent.what` | When you talk or write here, your words go to Anthropic's Claude so Kenember can reply and offer notes. | new |
| `aiConsent.not` | Kenember never uses your words to train AI, never sells them and never uses them for ads. Speech is turned into text on this iPhone; no audio is sent. | new |
| `aiConsent.off` | You can turn this off in Settings at any time. What you kept stays until you delete it. | new |
| `aiConsent.ai` | Kenember is an AI, not a person. | V3 |
| `aiConsent.agree` | Agree and continue | new |
| `aiConsent.notNow` | Not now | new |
| `aiConsent.privacy` | Privacy | new |
| `aiConsent.notSaved` | Not saved. Try again. | new |
| `aiConsent.declinedLine` | Talk and notes need Kenember's AI. Your people and their cards work without it. | new |
| `aiConsent.turnOn` | Turn on Kenember's AI | new |

## `settings`
| Id | String | Source |
| --- | --- | --- |
| `settings.ai` | Kenember's AI | new |
| `settings.aiOn` / `settings.aiOff` | On / Off | new |
| `settings.privacy` | Privacy policy | new |
| `settings.download` | Download your data | V3 (Settings) |
| `settings.logOut` | Log out | V3 (Settings) |
| `settings.delete` | Delete my account | V3 (Settings) |
| `settings.close` | Touch anywhere to close | G (Y9) |
| `settings.ai.line` | Kenember is an AI, not a person. | V3 |
| `settings.confirmTitle` | Delete your account? | new |
| `settings.confirmBody` | Your kennings, your talks and your Mirror link go now. Cards you sent that were already opened stay with the people who read them, under "Deleted account". This can't be undone. | new (from CONTRACT §7 `DELETE /account`) |
| `settings.confirmDelete` | Delete | new |
| `settings.cancelDelete` | Keep my account | new |
| `settings.notDeleted` | Nothing was deleted. Try again. | new |
| `settings.testAccount` | This is a test account, so it can't be deleted here. | new |
| `settings.exportFailed` | Your data isn't ready to download. Try again. | new |

## The talk bar
| Id | String | Source |
| --- | --- | --- |
| `bar.placeholderTalk` | Say what's on your mind | G |
| `bar.placeholderThread` | Write to [Name] | G |
| `bar.placeholderOne` | One thing about you for [Name] | new (Q3) |
| `bar.done` | Done | G (Y5 who sees this) |
| `bar.share` | Share the link | G (H2) |
| `bar.foldAndSend` | Fold and send | G (P4 When) |
| `bar.mic.a11y` | Talk / Stop | new |
| `bar.send.a11y` | Send | new |
| `edge.left.a11y` | Your kennings | new |
| `edge.right.a11y` | Your people | new |
| `pull.toYou.a11y` | Show your kennings | G (VoiceOver action) |
| `pull.toPeople.a11y` | Show people | G |
| `pull.toTalk.a11y` | Back to talk | G |

## `talk`
| Id | String | Source |
| --- | --- | --- |
| `talk.greeting` | Morning, [Me]. / Afternoon, [Me]. / Evening, [Me]. | G ("Evening, Nami.") |
| `talk.realOne` | [Name] left you a card. Nothing else needs you. | G; [Name] carries the apricot underline |
| `talk.realMany` | [Name] and [Name] left you cards. Nothing else needs you. | new (the two most recent names) |
| `talk.realNone` | Say whatever's on your mind. | G (Y4, without the starters) |
| `talk.fallbackQuestion` | What's one moment from this week that's still with you? | new (only when the first question can't load) |
| `talk.reply` | `reflection`, then `question` | server |
| `talk.suggestionKind` | the kind's heading, in caps | server (`item.kind` → heading) |
| `talk.suggestionWords` | `item.wording` | server |
| `talk.suggestionFrom` | From what you just said. | G |
| `talk.thatsMe` | That's me | G |
| `talk.partly` | Partly | G |
| `talk.notNow` | Not now | G |
| `talk.kept` | Kept for you | G |
| `talk.notKept` | This one can't be kept. | CPO |
| `talk.partlyFailed` | Kept as That's me. Partly didn't save. | new |
| `talk.grantFailed` | Not shared with [Name]. Try again from You. | new |
| `talk.notSaved` | Not saved. Try again. | new |
| `talk.turnFailed` | That didn't go through. Your words are still here. | new |
| `talk.limited` | Talk opens again at [time]. / Talk opens again on [day]. | server wording, formatted on the phone |
| `talk.retry` | Try again | new |
| `notOpen` | Talk isn't open on this account yet. | new |

## `scope`
| Id | String | Source |
| --- | --- | --- |
| `scope.question` | Is this with everyone, or with someone? | CPO and G |
| `scope.everyone` | With everyone | CPO |
| `scope.partner` | With my partner | CPO |
| `scope.family` | With family | CPO |
| `scope.friends` | With friends | CPO |
| `scope.coworkers` | With coworkers | CPO |
| `scope.only` | Only with [Name] | CPO |
| `scope.whoSees` | WHO SEES THIS? | G |
| `scope.onlyMe` | Only me | CPO and G |

## `you`
| Id | String | Source |
| --- | --- | --- |
| `you.title` | You | G |
| `you.line` | Something true about you, in your words. You choose who sees it. | CPO (the kenning's plain description) |
| `you.kindHeading` | `heading` for each group | server |
| `you.item` | the item's `wording` | server |
| `you.empty` | Say one thing that's true for you. It stays here until you share it. | V3 (F5) |
| `you.talk` | Talk | V3 |
| `you.unavailable` | Your kennings can't be shown right now. | new |
| `you.retry` | Try again | new |

## `kenning`
| Id | String | Source |
| --- | --- | --- |
| `kenning.kind` | the kind's heading, in caps | server |
| `kenning.words` | the item's `wording` | server |
| `kenning.receiptTalk` | From Talk, [date]: “[quote]” | G (Y2) |
| `kenning.receiptTyped` | Written by you, [date] | new |
| `kenning.with` | WITH | G |
| `kenning.withValue` | Everyone / My partner / Family / Friends / Coworkers / Only [Name] | G ("My partner"); the rest new in the same form |
| `kenning.seenBy` | SEEN BY | G |
| `kenning.seenNobody` | Only you | new |
| `kenning.when` | WHEN | G (the row is left out when the item has no "when") |
| `kenning.unavailable` | Where this came from can't be shown right now. | new |
| `kenning.retry` | Try again | new |

## `people`
| Id | String | Source |
| --- | --- | --- |
| `people.title` | Your people | G |
| `people.lineUnread` | A card, folded, from [when] | G |
| `people.lineDraft` | You started writing | new (same voice as the drawn "You wrote on Friday") |
| `people.lineNothing` | Nothing open | V3 |
| `people.new` | Someone new | G |
| `people.row.a11y` | [Name], [line], [time]; plus "new" when the dot shows | new |
| `people.unavailable` | Your people can't be shown right now. | new |
| `people.retry` | Try again | new |

## `someoneNew`
| Id | String | Source |
| --- | --- | --- |
| `someoneNew.title` | Someone new | G |
| `someoneNew.who` | WHO ARE THEY TO YOU? | G |
| `someoneNew.partner` / `.friend` / `.family` | Partner / Friend / Family | G |
| `someoneNew.nameLabel` | THEIR FIRST NAME | G |
| `someoneNew.line` | The link works once and ends in 7 days. [Name] sees one thing you choose to share, then decides. | G (shown once a name is typed) |
| `someoneNew.giftLabel` | WHAT [NAME] WILL SEE | new (Q3) |
| `someoneNew.gift` | the kind label, then the item's `wording` | server |
| `someoneNew.change` | Change | new (Q3) |
| `someoneNew.shareText` | [Me] wants you to know one thing. This link is for you only: [link] | G (X1 "Nami wants you to know one thing."); the rest new |
| `someoneNew.notKept` | This one can't be kept. | CPO |
| `someoneNew.notSent` | The link wasn't made. Try again. | new |
| `someoneNew.unavailable` | What you could share can't be shown right now. | new |
| `someoneNew.retry` | Try again | new |

## `thread` and `reading`
| Id | String | Source |
| --- | --- | --- |
| `thread.name` | [Name] | G |
| `thread.empty` | Nothing here yet. | new |
| `thread.fromLabel` | FROM [NAME] · [WHEN] | G |
| `thread.youLabel` | YOU · [WHEN] | G |
| `thread.keptLabel` | FROM [NAME] · KEPT | G (R4 frame) |
| `thread.giftLabel` | FROM [NAME] · SHARED WITH YOU | new (Q4) |
| `thread.folded` | A card, folded | G |
| `thread.touch` | Touch to open | G |
| `thread.keep` | Keep | G |
| `thread.reply` | Reply | G |
| `thread.helped` | Helped by Kenember | G |
| `thread.notSent` | Not sent. | new |
| `thread.retry` | Try again | new |
| `thread.refused` | This can't be sent as written. | new |
| `thread.refusedWhy` | `headline` | server |
| `thread.edit` | Edit | new |
| `thread.notConnected` | You and [Name] aren't connected on Kenember now. | server contract (v1.93) |
| `thread.didntOpen` | Didn't open. Touch to try again. | new |
| `thread.notSaved` | Not saved. Try again. | new |
| `thread.unavailable` | [Name]'s cards can't be shown right now. | new |
| `reading.words` | `final` | server |
| `reading.name` | [Name] | G |
| `invite.deadLink` | This invite link doesn't work any more. Ask for a new one. | new (shown in Talk) |
| `invite.ownLink` | This is your own invite link. Send it to the person it's for. | new (shown in Talk) |

## `pause`
| Id | String | Source |
| --- | --- | --- |
| `pause.title` | Before it goes | G |
| `pause.noteLabel` | HOW IT MAY LAND | new (the general basis label; "JAN SHARED" waits for receiver-grounded notes) |
| `pause.noteWhy` | `why_line` | server (`next/engine/bridge/insight_copy.json`, below) |
| `pause.tryLabel` | TRY | G |
| `pause.trySuggested` | “[suggested]” | server |
| `pause.basisNothing` | [Name] hasn't shared anything yet, so this is based only on you. | G and CPO |
| `pause.basisGeneral` | This is general, not about [Name]. | new (PSY "labelled general") |
| `pause.fromMe` | You shared: “[wording]” Want to say that here? | G and CPO, changed: "You shared that …" would need the person's own words turned into the second person |
| `pause.askLine` | You could ask [Name] how they like hard things raised. | G and CPO |
| `pause.keepMine` | ‹ Keep mine | G |
| `pause.useIt` | Use it › | G |
| `pause.dots.a11y` | More after this one | new |

**The why lines** (server, reviewed and linted by the engine; shown only for highlights with a `friction_kind`; a line about the receiver is not shown in package 01):

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

A vague_ask note has no TRY (its `suggested` equals `original`), so its card offers "‹ Keep mine" only.

## `safety`
| Id | String | Source |
| --- | --- | --- |
| `safety.message` | `safety.message`, `line` or `resources.message` from the triggering reply | server |
| `safety.resource.N` | the resource's `label` | server |
| `safety.close` | Close | new |

## Notifications and permissions
| Id | String | Source |
| --- | --- | --- |
| `PRESENCE_TITLE` | Kenember | new |
| `PUSH_BRIDGE_READY` | A new card is ready. | new (no name, no words: CONTRACT §12.4) |
| `NSMicrophoneUsageDescription` | Kenember listens only while the mic is on, to put your words in the bar. | new |
| `NSSpeechRecognitionUsageDescription` | Your words are turned into text on this iPhone, so you can check them before anything is sent. | new |

## Shared
| Id | String | Source |
| --- | --- | --- |
| `wait.a11y` | Loading | V3 flows |

## Server text the app does not show as sent
- `POST /bridges` 403 `message` "I won't carry this one." and the insight `declined` `line` "I won't rewrite this one." say "I". The app shows `thread.refused` and the server's `headline` instead.
- Any error `message`. The app shows its own line; the Ref is logged, never shown.
