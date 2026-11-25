<!-- Repo copy of Thesis v3 (rev 65), https://claude.ai/artifact/4wMPx7VWs3ZBMrptensS1W, refreshed by the COO 2026-10-31 17:20 Tehran -->

# Presence — Product Thesis v3

> **24 Nov 2026:** this copy predates the 15 Nov law changes. The laws, safety and scope that every task obeys are in `docs/THESIS-LAWS.md`, copied from the live thesis (https://claude.ai/artifact/4wMPx7VWs3ZBMrptensS1W). Where this file and that one differ, `docs/THESIS-LAWS.md` wins.

Oct 25, 2026 · @Nami Davoodzadeh

## What Presence is

**Presence draws a map of what you actually believe, from how you talk about your life and from what the people who know you have seen, and helps you say the hard things so they land.**

You talk about your day, or a moment that stuck with you, by voice or text. While you talk, Presence shows what it is understanding: a few gentle belief cards, each backed by your own words. You confirm what fits. Over time those beliefs become a living map: the few foundations everything rests on, the rules and coping habits built on top, and the tensions between them.

When something with someone close lands hard, Bridge holds your message until the moment you choose. If you want, it rewrites the message so it can be heard, without losing a single point. Or you write it yourself, and Presence quietly shows you what is in it and what might get in the way.

When you share your Mirror link, people who know you describe moments they saw. You never see their words or who wrote them. When several of them point the same way, Presence offers it as an outside perspective on your map, which you accept or reject like anything else.

**The one-line promise:** a map of what you actually believe, seen from inside and outside, and a way to send the hard messages so they land.

**One map, three features:**

- **Talk** builds the map from your own words. It is the core.
- **Mirror** lets the people who know you add what you can't see. It is the outside view and the growth loop.
- **Bridge** carries the hard things to the people you share a life with. It is the everyday reason to come back.
- **Sharing** stays something you choose to show, not a network.

The product was called "Belief Map" in v1 of this thesis; it is now Presence. "Mirror" is a working name.

## The problem

**Much of what drives our reactions comes from beliefs we never chose and rarely see, and no tool today shows them to us honestly.**

- **Beliefs run below awareness.** A belief like "if I need something, I'm a burden" shapes how we react at work and at home. But asking "do you believe X?" mostly gets flattering answers: people have limited access to the reasons behind their own behaviour.
- **Some of it only others can see (new in v3).** Part of what drives us is visible to the people around us and not to us: psychology calls it the blind spot. A map built only from what we narrate can never reach it.
- **Self-knowledge products are snapshots.** Typology tests and astrology are instant and shareable, but have little validity. They die as static results: test taken, result shared, app deleted.
- **AI chats forget and advise.** People already narrate their lives to AI daily. But a chat keeps no evidence-linked model of one person, and it offers advice rather than an honest description.
- **Hard conversations fail in the moment, or never happen.** In the heat, a true point comes out as an absolute, a label or sarcasm, and the other person hears an attack. Waiting helps, and so does rewording. But generic AI rewriting produces boilerplate that doesn't sound like you; the early GPT experiment with couples-communication books showed this. And many hard things are never said at all, because the person can't find the words or the courage.
- **Anonymous feedback has been tried, and it hurt people (new in v3).** Apps that let friends send anonymous messages spread fast and then failed on cruelty delivered raw. The need to hear how others see you is real; the format was wrong.
- **The therapy lane is closing; the descriptive lane is open.** AI-delivered therapy has been restricted (Illinois and Nevada, 2025), and the best-known therapy chatbot shut its consumer app. Descriptive self-knowledge and communication is the lane still open.

## The science behind it

**Presence builds on a model of belief that psychology already has. What's new is an engine that can infer it from ordinary conversation, add what others observe, and keep it.**

| Idea | What it says | How Presence uses it | Evidence |
| --- | --- | --- | --- |
| Central and peripheral beliefs (Rokeach) | Beliefs differ in how many other beliefs depend on them | Foundations: the few beliefs the rest of the map rests on | Established; decades of measurement |
| Core beliefs, rules and coping (Beck; Young's schemas) | Global beliefs about self, others and the world are managed by rules and coping strategies | Belief types, and related beliefs shown under their core belief | Established clinical models, used here only to describe |
| Belief systems as networks (Brandt and colleagues) | Identities sit at the centre; the structure replicates across 31 countries | Centrality computed on a real network, never a score or a left–right label | Established, active research field |
| Cognitive-affective maps (Thagard) | Concepts with feeling, joined by support or conflict | The map's grammar: links and tensions | Mapping beliefs from text is reproducible between mappers |
| Limits of introspection (Nisbett and Wilson) | People report reasons they don't have | Infer from told episodes; never ask "do you believe X?" | Established |
| Elicitation methods: laddering, downward arrow, critical incident, contrast | Ways around the front door to a belief | The engine's conversation moves: follow, deepen, contrast, clarify | Established methods |
| Complaint versus criticism, contempt and sarcasm (couples research) | A complaint about a behaviour is heard; attacks on character and contempt escalate | Bridge's fixes and insight: an absolute becomes the specific time, a label becomes the behaviour, sarcasm becomes a straight statement | Pattern established; our rewrite's effect not yet shown |
| The Johari window (Luft and Ingham) (new) | Part of a person is known to others and not to themselves: the blind spot | Mirror: outside observations reach the blind spot; the person still decides | Established model; our aggregation not yet shown |
| Multi-rater feedback (new) | Several observers are more reliable than one; a single rater is noisy and biased | Mirror's convergence rule: nothing surfaces from one person | Established in organisational research |
| AI-mediated communication (new) | Readers trust messages less when they know AI helped; AI in the middle can also absorb blame when things go wrong | Bridge keeps every point in the sender's voice, marks rewritten messages, and offers a write-it-yourself path with insight | Effects established; their size in close relationships not yet shown |

**Proven:**

- the belief model;
- the elicitation methods;
- that people narrate their lives to AI;
- that products used with another person retain better than solo self-help;
- that several observers describe a person more reliably than one.

**Promising, not yet shown:**

- that an engine can infer beliefs people endorse at least 70% of the time;
- that the map doesn't feel generic: people should reject a stranger's map in a swap test;
- that a map-aware rewrite lands better than the raw message;
- that friends' described moments converge on beliefs the owner endorses (new);
- that seeing insight before sending changes what people send (new).

The current engine test rounds measure the first of these.

## Product laws

**Twelve laws hold whatever the design. Laws 1 to 10 carry over from v2 unchanged, except that law 8 now also covers Mirror. Laws 11 and 12 are new, for Mirror.**

1. **Infer, don't ask; confirm, don't lead.** Beliefs come from told episodes. The engine never asks "do you believe X?"
2. **No receipts, no belief.** Every belief links to the person's own words and the date they said them, or, for Mirror, to the moments others described.
3. **The person decides.** A belief reaches the map only when the person rates it Very me or Partly, or edits it. "Not me" is kept and marked, never silently deleted. This holds for beliefs from Mirror too.
4. **Describe, never prescribe.** The app never calls a belief good, bad, healthy or unhealthy, and never suggests changing it.
5. **Gentle wording, always.** A belief is phrased with care ("Part of you feels you're not enough for others"), never as a harsh verdict, however strong the evidence. The quote is the receipt, never the headline.
6. **Tensions are mapped, not resolved.**
7. **Nothing clinical on screen.** No diagnoses, mood labels or schema names. Belief types use plain words.
8. **Safety overrides everything.** Risk to self or others stops mapping, bridging and Mirror processing and shows resources.
9. **Confidence earns the screen.** A belief appears during the conversation only at confidence of 0.7 or more, and gently. Below that, the engine keeps listening. The first card of a session can show live; later cards wait in a tray at natural pauses (Nami, 31 Oct)
10. **Beliefs are special-category data.** Encryption, no training on user content, and export or delete in one tap. Bridge reads a partner's beliefs only with their explicit consent.
11. **Moments, not verdicts (new).** Outside input is a described moment: what was happening, what the person did or said. A label about character ("he's selfish") is never evidence on its own. Contributors describe, the engine infers, the owner decides.
12. **Outside input never arrives raw (new).** Mirror input is never shown word for word and never shows who wrote it. It reaches the owner only when several people converge, and the map only when the owner confirms it.

## The core experience: Talk, understanding, map

**Talk is the entrance. Its main screen shows what Presence is understanding about you, live, rather than a chat log. This section is unchanged from v2, except where the map now shows what came from Mirror.**

**Talk**

- **Starting.** Talk by voice or text, with no time limit. Or tap a starter ("Finish a few sentences", "Something at work", "Someone close", "A decision", "Import from your AI"), which is sent as your first turn. Mirror can add starters of its own (see Mirror).
- **Being heard.** Your words stream as a live caption, so you can see you're heard. The app's one question appears, then fades into the history once you answer; the whole conversation is a scroll up.
- **Never frozen.** A still scribble shows whenever the engine is working, and the mic ring shows that Presence is listening. Behind the frosted curtain, a belief sphere forms as a belief takes shape (see Look and feel). A small hand-drawn face greets you once a day on Talk home; the listening and smiling faces are retired (Nami, 31 Oct).
- **One thread.** Every question continues your story: one question at a time, with a short reflection first.
  - The director picks a move: follow, deepen, contrast, clarify, bridge to a related area, ask permission, or close. It goes for whichever part of your belief system is least clear.
  - Before a sensitive or new area it asks: Sure / Not now / Never. "Never" is respected.

**Understanding cards**

- **What a card shows.** When the engine is confident (0.7 or more), a card appears with:
  - a one- or two-word label;
  - a gentle one-sentence statement;
  - a type the engine chose, shown as a glass pill you can change (for example "a rule I live by", "how I tend to react", "something I believe is true", "a view or taste").
- **Rating is confirming.** The first card of a session shows live, as soon as it is ready. After that, cards wait in a tray that opens at natural pauses (or at Finish) and shows 2 to 4 at a time (Nami, 31 Oct, engine decision D5). Each card asks "Is this you? Not me · Partly · Very me", or Edit. Very me and Partly put the belief on the map; Not me keeps it as disputed.
- **Related beliefs.** Rules and coping habits that sit on a core belief appear under it, linked.
- **Fast first card.** The first card can be a plainly stated view or reaction, which reaches 0.7 at once. A core belief is never an early card. This replaces the earlier "Is this you?" chip at turn 3, which offered a belief and so broke the chip rule below (Nami, 31 Oct, engine decisions D1 and D5).
- **Answer chips.** A question about what happened may offer up to 3 tap-to-answer chips plus "Something else": things a person might have done or kinds of moments ("I said nothing · I left the room"), never beliefs, feelings or meanings. At most one set every two turns, none on heavy or safety topics. A tap shows on receipts as "you chose: …", never as a quote, and a card above the reaction layer never rests on taps alone (Nami, 31 Oct, D1).
- **Progress you can feel.** A small line shows map coverage ("Your map: 4 beliefs · 2 more for your first map"). Milestones: First map at 5 beliefs, at least one about you and one about others; Bridge ready at 5 of 8 relationship slots when a partner is linked. A milestone is progress, never a gate and never a score of the person (Nami, 31 Oct, D2).
- **Finish.** After about 8 turns Talk may offer to close; the person can always go on. Finish shows what the conversation added, and unrated cards open in the tray one last time. Unrated beliefs never reach the map.

**The map**

- **The sculpture.** One glass cube holds the whole map: a sphere for each area of life, a layer inside it for each belief, the core at the centre. Clear glass means known: the cube clears as beliefs are rated. Only rated beliefs are in the cube (confirmed, Not me as a clear ghost, or retired). Each of the four sides holds two areas, their names engraved low in the glass, and the map opens facing the side with the most weight. At rest a soft veil lies on the glass and a touch wipes it off; drag turns the cube, pinch zooms, press and hold lights the cores, and tapping a sphere lists its beliefs (Orbs and map v2, Nami, 30 and 31 Oct).
- **Views.** Foundations (the few beliefs most of the map rests on), Domains (work, relationships, money, family, body, politics, morality, meaning) and a List.
- **A belief's card.** Tapping a belief opens:
  - the label, the gentle statement and the changeable type;
  - your quotes as receipts, with their real dates;
  - "Seen by others" receipts, when Mirror has any: a paraphrased summary and a count, never a quote (new);
  - linked beliefs.

  Edit wording and Not me both persist.
- **Seen from outside (new).** A belief that first came from Mirror carries a "seen by others" mark on its card, and its area's sphere shows a soft rainbow sheen, so the person can always tell what they said from what others saw.
- **The map lives.** Talking about the same thing again adds a receipt to the same belief instead of a duplicate. A contradiction draws a tension. A belief that changed is marked.

**Look and feel.** Warm, quiet and precise (craft pass v1, approved by Nami, 31 Oct). Glass controls on a calm warm-glow ground; Talk keeps its frosted curtain. At most one small hand-drawn mark per screen, from a fixed set of eight, never on safety, data, settings or error screens. Nothing moves unless something real happened: no idle loops, pulsing, bounce or celebration, and nothing moves behind text being read or typed. Silence by default: a few quiet glass sounds, each saying that something landed, was kept, let go, lit, sealed or arrived, plus one when a couple opens the check-in together. No walls of text, no points, streaks or badges. Behind Talk's curtain, belief spheres replace the moving shape: size shows how far a belief has formed, colour its area, frost that it is not yet rated. They never show mood, tone or emotion (Nami, 31 Oct; replaces the 29 Oct live shapes). The map's glass follows the same rule: it shows only what the person rated and how surely, never how heavy a belief feels, so the cube never turns smoky (Nami, 31 Oct).

## Bridge

**Bridge is the everyday reason to come back: say the hard thing now, and they get it at the moment you choose, in words they can hear. In v3 it has two ways to send, and it works with anyone you link, not only a partner.**

**Who it's for.** Bridge works with anyone you link at launch: a partner, a friend, family or a coworker (Nami, 31 Oct). You set the relationship once per link, and Bridge uses it to pitch tone and delivery options. The store page and onboarding lead with partners. Bridge is also simply a way to see what a message says, or to make it clearer, before it goes. The messaging itself must be as dependable as an established messaging app (storage, delivery, sync), and Nami tests it with test and real conversations as soon as it is ready.

**The flow (the MVP uses only the sender's own map)**

1. Write or say the message in the heat of the moment.
2. Pick when it arrives: Tonight, Tomorrow, Next check-in, or a custom time. Next check-in is offered for partner, family and friend links.
3. Choose how to send it:
   - **Bridge it.** Presence rewrites it. Your version and the bridged one show together, with "What changed" visible only to you. Use bridged, use mine, or edit.
   - **Send mine, with insight (new).** You keep your own words. Insight sits above the compose box, out of the way: scroll up to see it, or ignore it.
4. One final tap schedules it. Nothing is sent without it.
5. The receiver sees "You have a bridge for Thursday's check-in", with the content hidden until then. A small "bridged" mark shows if you used the rewrite. Insight mode carries no mark: every word is yours.
6. **Check-in mode** shows both sides' messages one at a time, each closed with "Talked about it".

**Two ways, one reason: getting the hard thing said.** The rewrite is a curtain. Telling Presence first is easier than telling the person, and it gives the sender the courage to say what they otherwise wouldn't. Insight is for people who would rather keep every word their own but still want to see how it reads before it goes.

**What insight shows (new in v3)**

Insight is up to three short, quiet lines, refreshed when the sender pauses typing:

- **What's in it:** the points Presence hears, so the sender can check the message says what they mean.
- **What might get in the way:** the frictions found (an absolute, a character label, sarcasm, an order, a pile of old grievances), with the words highlighted in place. Each comes with one plain line on how that kind of wording tends to be heard. A rewrite is offered only if the sender taps.
- **What it touches in you:** the sender's own confirmed beliefs this connects to ("this seems to land on 'being an afterthought'"), in gentle wording. Only beliefs the sender has confirmed.
- **How it may land (later, off in the MVP):** a hypothesis about how the receiver might read it, using only beliefs the receiver chose to share ("they tend to hear bluntness as strength"). It is always worded as a possibility, never as what the receiver feels or meant.

Insight never scores the message, never tells the sender not to send, never says who is right, and never uses clinical words.

**What a bridged message is: not a nicer message, but one the other person can understand.**

- **It keeps** every point, your voice and your feeling (at most one step softer).
- **It never adds** an apology, compliment or hedge you didn't write, and no therapy boilerplate.
- **It fixes the frictions that make people stop listening:**
  - an absolute becomes the specific time;
  - a character label becomes the behaviour;
  - sarcasm becomes a straight statement;
  - an order becomes a clear request;
  - a pile of old grievances becomes the one at hand.
- **It may add context** from your own confirmed beliefs, in your voice ("this landed on something old for me").
- **It never touches the receiver's inner life.** It says nothing about it and never quotes their map.
- **It pitches tone to the relationship (new).** A coworker message stays more formal than one to a partner; the points stay the same.
- **When it shouldn't rewrite:**
  - it can't do it well → "I couldn't bridge this one", then send as written or edit;
  - risk → it stops and shows resources;
  - a threat or abuse → "I won't rewrite this one". The words stay on the sender's phone, and the way forward is "Talk it through" (opens Talk with those words, outside the daily Talk limit) or "Edit it myself". An insult is not refused: it is bridged like any character label.

**Why it matters.** For the sender, Bridge turns a moment of hurt into something that gets said. For the product, Bridge moments are the richest evidence the map will ever get.

**Later, by your decision.** Receiver-aware bridging and receiver-aware insight are built but switched off. They would use only beliefs the receiver chose to share, and only to choose framing or to offer a gentle hypothesis. They stay off until shown beliefs are endorsed at least 70% of the time and you decide. Real partner invites are now in the prototype (Nami, 31 Oct), and the partner joins free; see Prototype additions.

## Mirror (new in v3)

**Mirror lets the people who know you add to your map without you ever seeing what they wrote or who wrote it. They describe moments; Presence works out which beliefs those moments point to; nothing reaches you unless several people converge, and nothing reaches your map unless you confirm it.**

**Why it exists**

- **The blind spot.** Talk can only map what you narrate. Mirror reaches what others see in you and you don't, and it makes the map more true, not just bigger.
- **The growth loop.** "Link in bio, friends respond" is the mechanic that made anonymous-question apps spread. Every contributor meets the product. A share card gets looked at; a link gets acted on.
- **A reason to come back.** Your map changes because something happened in it, not because of a streak.
- **Social without a network.** For now it replaces communities as the social layer.

**What we learned from anonymous apps.** Sarahah, YOLO and NGL spread fast, then failed on abuse: cruel messages delivered raw, young users, and in NGL's case fake messages that ended in a regulatory settlement. tbh allowed only positive input and still faded within a year, so novelty alone doesn't retain. Mirror is designed against each: nothing arrives raw, nothing from one person surfaces, adults only, no fake or teaser alerts, no reply channel, and the value is a map that keeps growing, not a message feed.

**For the owner**

1. **Turn it on.** Mirror is off by default. Turning it on creates a personal link you can pause, rotate or delete at any time. You choose who can use it: anyone with the link, or only people you approve.
2. **Share it** anywhere: a bio, a story, a message to friends. The link page tells the visitor what is being asked: "describe a moment, not a verdict."
3. **Nothing per contribution.** There are no "someone wrote about you" alerts and no counter of incoming messages. You hear from Mirror only when something clears the gate.
4. **An outside perspective arrives.** It looks like a Talk card with a "seen by others" mark:
   - the label, a gentle one-sentence statement and the changeable type;
   - "From 4 people who know you, across 6 moments" (counts only);
   - a paraphrased summary of the moments ("people describe you going quiet when plans change at the last minute"), never a quote and never a detail that could identify who wrote it.
5. **Decide.** Very me, Partly, Not me or Not now. Very me and Partly put it on the map with "seen by others" receipts. Not me keeps it as disputed and marked, like Talk. Not now saves it for later.
6. **Talk about it.** Every Mirror card has "Talk about this", which opens Talk with the perspective as a starter. That conversation adds your own receipts. This is how Mirror discusses a belief with you instead of prescribing it.
7. **New branches.** When moments point to an area your map has nothing on, Mirror offers a starter: "People who know you have described moments at work. Want to talk about it?"

**For the contributor**

1. **Open the link on the web.** No app is needed to contribute. They sign in with one account (Apple or Google) to stop brigading. The owner never learns who they are.
2. **Say how they know the person:** partner, friend, family, coworker or other, and roughly for how long. In the MVP this is used only inside the engine, for weighting.
3. **Tell one moment,** mostly by picking (Nami, 31 Oct): structured moment prompts, never ratings or scales of the person, about five minutes:
   - "What was happening?" Pick the kind of moment.
   - "What did \[name\] do or say?" Pick what they did.
   - "What seemed to matter to \[name\] there?" Pick, optional.

   An optional short detail in their own words is screened before use and never shown to the owner. Story first, guessing last.
4. **Gentle steering.** If the input is a label ("he's selfish"), the guide asks once for a moment where they saw it. A label with no moment is not used. Insults, threats, sexual content and details about other people are dropped silently.
5. **Know what happens next.** "\[Name\] will never see your words or who you are. What several people describe may become an outside perspective on their map, which they choose to accept or not."
6. **The invite.** At the end: "Want your own map?" This is the loop.

Contributors never see the owner's map unless it was shared with them, never learn what happened to their input, and have no reply or thread.

**How Mirror works inside**

- **Observation listener:** reads a moment into the situation, the behaviour, the reaction, the contributor's guess at its meaning (kept separate and weighted low), the domain, and whether it is a moment or a label.
- **Screen:** safety and abuse checks; strips names of other people, places, dates and anything that could identify the contributor. Failed input is dropped and never shown.
- **Mapper:** matches each observation to the owner's existing beliefs (supports or contradicts) or proposes a new belief hypothesis, with confidence.
- **Convergence gate, the key rule:**

| Outcome | Needs | What the owner sees |
| --- | --- | --- |
| A new belief from outside | Several distinct contributors, with high confidence | An outside-perspective card to rate |
| Support for a belief already on the map | More than one contributor | "Seen by others" receipts on that belief, quietly, with no alert |
| A different view of a confirmed belief | Several distinct contributors | A gentle tension: "Some people who know you describe this differently" |
| Below the gate | Fewer contributors or lower confidence | Nothing; held unseen until others corroborate it |

- **Writer and guard:** writes the card in gentle wording with a paraphrased summary. The guard checks: no quote, no identifying detail, no clinical words, no verdict.
- **Brigading checks:** one verified account per contributor; new or bulk accounts weighted down; near-identical submissions counted once; a sudden burst holds everything for review.
- **Retention:** the raw text of a contribution is deleted once processed; only the structured, de-identified observation is kept, encrypted.

**Hard rules for Mirror**

- Adults only, on both sides.
- Off by default; one tap to pause, rotate or delete the link and everything pending.
- Never a message channel: no replies, no per-message alerts, no fake or teaser notifications.
- Never raw, never named, never from one person.
- Mirror input never feeds Bridge.
- Concern for the owner's safety in a contribution: in the MVP it is not mapped, and the contributor is shown how to reach out themselves. Whether the owner should hear anything is an open question.
- App Store safeguards (Apple guideline 1.2): the owner can report a perspective and block the contributors behind it without learning who they are; contact details are published; an 18+ rating with a declared-age check for web contributors; App Review notes explain Mirror (Nami, 31 Oct, with the answer format).
- A new outside perspective can only be a reaction, a coping habit or a view. Core beliefs come only from the person; outside moments may add "seen by others" receipts to a belief the owner already confirmed (engine v2, Nami, 31 Oct).

**Bridge and Mirror, side by side.** They stay separate features in v3; whether they later share one "Send" screen is an open question.

|  | Bridge | Mirror |
| --- | --- | --- |
| Who sends | Someone the receiver knows by name | Someone the owner never sees |
| About | Something between the two of you | The person themselves |
| Arrives as | A message at a chosen time | An outside perspective on the map, only after convergence |
| Receiver sees the words | Yes, the sender's or the bridged version | Never |
| AI's role | Optional rewrite, or insight | Always: input is never shown raw |
| Purpose | Get the hard thing said | Let others add what you can't see |

## Sharing and community

**Sharing is something you choose to show, not a network. Mirror is now the social layer; the network waits for scale and safeguards.**

- **Now: the share card.** Three vertical cards in the style of Spotify Wrapped. The share sheet opens on the words card, with the map card and the spotlight card as swipe-to alternatives (Nami, 31 Oct). You pick three to five beliefs; quotes are off by default. The footer carries the Presence wordmark, and the card ends with "What's yours?" and a link to start a map (prototype item 5). Preview, then save to Photos or share anywhere. Private by default.
- **Next: Mirror.** The "belief link" that v2 listed as under discussion is now its own feature, with its abuse and privacy design (see Mirror).
- **Next: Contrast.** Two consenting people see what they share, where they differ, and where their foundations touch. It reuses Bridge's two-person machinery, and it is the natural invite: "compare with me."
- **Later: profiles and communities** that show chosen views of a map instead of left–right labels. They unlock only when:
  - shown beliefs are endorsed at least 70% of the time;
  - at least half of linked couples use Bridge weekly;
  - a privacy audit passes;
  - a written abuse policy exists.

A cross-user "belief fingerprint" stays a research ambition; it needs on the order of 100,000 maps.

## Main flows

**It is one loop with two ways in. Talk and Mirror feed the map; the map makes the next hard message clearer; that message's check-in becomes the next moment.**

&#91;embedded content: the Presence loop · Talk, Mirror, map, Bridge\]

The map is the centre: Talk and Mirror feed it, the share card draws on it, and Bridge turns a hard moment into a message whose check-in becomes the next moment.

**For the person**

1. Talk about a moment, see understanding cards, rate them, and they appear on the map.
2. Come back and talk again: the same beliefs gain receipts, and contradictions show as tensions.
3. When something lands with someone close, Bridge it: rewritten, or your own words with insight. It arrives when you chose, you talk about it, and that moment feeds the map.
4. Share your Mirror link. When several people describe the same thing, an outside perspective appears; rate it, or talk about it.
5. Share a card of three to five beliefs you choose.

**For the system, on every Talk turn**

- **Four calls (engine v2, Nami, 31 Oct).** A safety screen runs first on every message. A fast writer then streams one short question or reflection; it gets only a target area in plain words, never the guesses, so it cannot lead. At the same time an extractor reports belief candidates with their evidence (stated or implied, hedged, which episodes support or contradict them); it no longer records a feeling. A separate verifier checks each card against its quotes before anyone sees it.
- **Blueprint and director:** code scores the open slots (the Bridge set first when a partner is linked, then 12 foundation slots, then area slots) and picks the target area, the next rung of the follow-up ladder and the pace. Never childhood, origins or "why" questions; if the person brings up their past, the engine listens and does not probe.
- **Questions:** one ask per turn, 20 words or fewer, about a moment, a thought or an action. A reflection of 15 words or fewer may replace it, only when it adds something the person implied.
- **Guard:** one ask, on-thread, no clinical words, no raw quote. A failed check is repaired or replaced with a safe fallback; the person never sees an error.
- **Understanding:** code, not the model, computes confidence from the evidence, with a minimum per layer (a core belief needs two episodes from different situations plus a linked rule or coping belief). At 0.7 a card is ready: the first shows live, the rest wait in the tray. A match with a belief already on the map adds a receipt instead of a duplicate.
- **On rating:** extraction, critic and reconcile write the belief to the person's graph as endorsed or disputed. Centrality and views recompute.
- **Safety screen** on every turn.

**For Bridge**

- **Analyse:** the points, the feeling, the frictions, the beliefs touched, safety.
- **Insight path (new):** the analysis runs when the sender pauses and shows the points, the highlighted frictions and the beliefs touched. Nothing is rewritten unless the sender asks.
- **Rewrite path:** plan a fixed fix for each friction, decided in code; rewrite; then verify every point is kept, no softening was added, and nothing is said about the receiver.
- **Then:** the sender chooses, it is scheduled, and it is opened at check-in.

**For Mirror (new)**

- Contributor tells a moment → observation listener → screen → mapper → convergence gate → outside-perspective card → owner rates or talks about it. Details are in the Mirror chapter.

**For the community (later)**

- Share card now.
- Mirror and Contrast next.
- Profiles and communities only after the gates in Sharing and community.

## Safety, privacy and trust

**Presence is descriptive self-knowledge, never therapy, and trust is the product. Mirror raises the stakes, so it carries the strictest rules in the app.**

- **Not therapy.** No diagnosis, treatment, advice or mental-state labels. The copy, the engine, the map, Bridge insight and Mirror all hold this line. It is right legally, given the restrictions on AI therapy, and right strategically.
- **Risk stop.** A message showing risk to self or others stops mapping in Talk, bridging in Bridge, and processing in Mirror. Resources are shown, and nothing is extracted from that message.
- **Your data.** Beliefs are special-category data: per-user encryption, no training on user content, no ads. "Download a copy" and "Delete my map" (with confirmation) sit in Settings.
- **Consent in Bridge.** The receiver's beliefs are never read without their explicit share, never quoted, and never used to argue a side. Sending the raw message is always one tap away, except for a threat or abuse, which Presence never sends. Receiver-aware insight, when switched on, offers a possibility, never a verdict on what someone meant.
- **Mirror protections (new).** Adults only on both sides. Off by default. Never raw, never named, never from one person. No reply channel, no per-message or teaser alerts, and never a fake message. Raw contribution text is deleted once processed. Pause, rotate or delete the link, and everything pending, in one tap.
- **Contributor privacy (new).** The owner never learns who contributed. Anything that could identify a contributor is stripped before a summary is written.
- **Honest about what it is.** The map is a portrait drawn from what you said and what others saw, not a scan of who you are, and the product says so. People perform a little for any listener, including an AI, and observers see only part of a person; no design removes that, so we name it.

## What we want out of it

**Success is a map people recognise as theirs, people who keep using Bridge, and Mirror links that friends actually answer, not downloads.**

| Outcome | Measure | Bar |
| --- | --- | --- |
| The engine is honest | Share of shown beliefs rated Very me or Partly | 70% or more |
| The map isn't generic | Swap test: people shown a stranger's map reject it | accepted less than a third of the time |
| The conversation feels warm and stays on the person's story | Engine test, judged turn by turn | warmth 4 of 5 or more; no topic jumps; fallback replies 10% or less |
| Talk shows real understanding | Cards on turns where one is warranted; conversations with at least one card | 50% or more; 9 of 12 or more |
| Bridge becomes a habit | Bridge messages per linked couple per week | at least 1 |
| Insight is useful (new) | Share of insight-mode messages edited after insight appears | to be decided |
| Mirror gets answered (new) | Contributions per shared link in the first 14 days | to be decided |
| Mirror converges (new) | Share of active links that reach a first outside perspective within 30 days | to be decided |
| Mirror is accurate (new) | Share of outside perspectives rated Very me or Partly | to be decided |
| Mirror stays safe (new) | Share of contributions dropped by the screen; abuse reports | to be decided |
| Mirror spreads (new) | Share of contributors who start their own map | tracked from launch |
| People stay | Day-30 retention | couples 15% or more; solo 8% or more |
| People share | Share-card rate; Contrast invites accepted | tracked from launch |

**Business model (for the CPO thread):** a subscription, a couples plan built around Bridge, and never ads. Ads on belief data would end the trust the product runs on. Mirror is free for owners and contributors: it is the acquisition loop. Prices are set after the beta, which runs without a paywall. Launch is targeted for late January 2027. Decided 31 Oct: one subscription covers both linked partners, so the partner joins free; a referral reward waits until prices are set.

## Scope: now, next, later

**DEV 49 is unchanged: the first prototype on your phone that covers the MVP. v3's additions start after DEV 50; the COO sets their order and numbering.**

- **Now, DEV 49:**
  - Talk with live understanding and inline rating, on engine v2;
  - extraction with receipts, and reconciliation across sessions;
  - the map with Foundations, Domains and List, as a 3D sculpture under glass;
  - the share card;
  - Bridge end to end with check-in, using the sender's own map only;
  - the safety stop;
  - Settings: download, delete, log out, help;
  - no dead controls anywhere.
- **DEV 50:** the craft pass (Nami, 31 Oct): map v2, the Talk belief spheres, the eight hand-drawn marks, the closed motion list, the glass sounds and the warm-glow ground.
- **Next, new in v3 (order set by the COO):**
  - Bridge "Send mine, with insight", sender-side insight only;
  - a relationship type on each Bridge link (partner, friend, family, coworker);
  - Mirror, in launch scope (adults only, full moderation): owner link and controls; the web contributor page with sign-in; observation listener, screen, mapper and convergence gate; outside-perspective cards; "Talk about this"; "seen by others" marks and receipts on the map.
- **Next, after the 70% endorsement bar:**
  - receiver-aware Bridge and receiver-aware insight;
  - attaching a belief to a message ("show them why");
  - Contrast;
  - real partner invites: moved into the prototype (31 Oct). The three items above are now also listed under After beta.
- **Later:** profiles and follows, communities, Android and the full web app, anonymous aggregate research.
- **Out:** streaks, badges, scores, comparisons to norms, evaluative or therapeutic copy, raw anonymous messages, and per-message "someone wrote about you" alerts.

## Prototype additions (decided 31 Oct)

Nami added eight items to the prototype, in this order. The daily-use TestFlight build (DEV 49) comes first: none of these may delay it.

| # | Item | Who | What it is |
| --- | --- | --- | --- |
| 1 | Weekly check-in plus a "park it" list | CPO spec, CDO screens, COO build | Partners note small things during the week, Bridge phrases them, and they open them together at the weekly check-in. Spec below. |
| 2 | Real partner invites; the partner joins free | COO | Invites work beyond test accounts. One subscription covers both linked partners, through a server-side shared entitlement (not Family Sharing). |
| 3 | First belief card within 3 minutes | CPO spec, CDO, COO | Starters plus "Import from your AI". Spec below. |
| 4 | Event-based reminders, no streaks | CPO spec, CDO, COO | Spec below. |
| 5 | Share card with a "what's yours?" line, plus the Mirror link | CDO, COO | The share card ends with "What's yours?" and a link to start a map; the Mirror link sits beside it, under Mirror's rules. |
| 6 | Beta measurement | COO, CDO | Analytics events for the core loops (never any Talk, Bridge, Mirror or note content), crash reporting, AI cost per active user, and a week-3 "Would you miss Presence?" survey on one in-app screen. |
| 7 | Siri "park it" | CDO, COO | An iOS 27 App Intent that adds a note to the park-it list by voice. It never sends anything. |
| 8 | Apple Foundation Models test | COO | On-device models (and Private Cloud Compute, if available) against Claude for the Talk listener and the safety screen, on the same engine test set. |

### 1. Weekly check-in and the "park it" list

The values below are starting values: Nami can change any of them, and the beta tunes them.

- **Setting it.** When two partners link, they pick one weekly slot (day and time). Either can change it; the other is told once.
- **Parking a note.** From Bridge or by Siri, a partner writes or says a small thing as it happens. It goes through Bridge's usual choice: Bridge it (the rewrite beside your words) or Keep mine (with insight). Bridge's rules apply unchanged: every point kept, an absolute becomes the specific time, a label becomes the behaviour, an order becomes a request. A threat or risk is never parked or rewritten; it follows the safety stop. A note that describes being hurt, threatened or controlled by the partner is never parked or brought to a shared check-in: only its writer sees resources (law 8).
- **Who sees it, and when.** A parked note is its writer's alone until the check-in. The partner gets no alert, no count and no preview. Until then the writer can edit it, delete it, send it now as a Bridge, or keep it for a later week. A deleted note leaves no trace.
- **Notes parked by Siri** stay "to phrase" until the writer opens them and picks Bridge it or Keep mine. One still unchosen at the check-in opens first for its writer only.
- **The check-in.** Either partner taps Start; the other joins on their own phone. Notes come one at a time, alternating, starting with whoever didn't go first last week. Each shows the chosen version (with the "bridged" mark if rewritten) and closes with "Talked about it" or "Next week". Bridges scheduled for "Next check-in" join the same queue.
- **Not a weekly review of faults.** Up to 3 notes each per check-in, chosen and ordered by the writer; the rest stay parked. Nothing counts notes, missed weeks, or who parked more.
- **Into the map.** After the check-in, each partner may "Talk about it" alone, which adds receipts to their own map. A partner's notes never enter the other's map (the Bridge feed rule).
- **Open with Nami:** whether notes can also be appreciations ("something I noticed and liked"). The CPO recommended it; it is not decided.

### 3. First belief card within 3 minutes

In a first session, the first card should show within 3 minutes. Beta target: 80% of first sessions.

- **Starters.** The first Talk screen offers five: "Finish a few sentences" first (the engine's quick start, a few sentence completions such as "When someone gets close to me, I..."; the fastest way to a first map in one sitting, needing no other app), then "Something at work", "Someone close", "A decision" and "Import from your AI" (Nami, 31 Oct). A starter sends the first turn.
- **A faster first card.** In a first session the director favours one recent moment (follow, then deepen) over breadth, and the first card is a plainly stated view or reaction that shows live (the fast first card, Nami, 31 Oct). There is no "Is this you?" chip. Law 9 is unchanged: a card still needs 0.7 confidence.
- **Import from your AI.** The person copies a prompt into the AI they already use, then shares the answer back to Presence (share sheet, or paste). Presence never connects to their AI, their account or their chat history.

The prompt, copied exactly:

```text
I'm trying Presence, an app that maps the beliefs I live by. Based only on what I've told you in our past conversations, describe up to 5 patterns you've noticed in how I think or react.

For each pattern, write:
1. One kind sentence in the first person, like "Part of me feels I have to earn rest."
2. One or two moments I told you about that show it, one sentence each. Don't name other people.
3. The area of life: work, relationships, money, family, body, politics, morality or meaning.

Rules: describe, don't judge or advise. No diagnoses, mental-health labels or personality types. Leave out my health, sex life, account numbers, passwords, address, and other people's private details. If you don't know me well enough, write fewer patterns or none. Plain text only.
```

Shown on the import screen, before the prompt:

| What we ask | What we never ask |
| --- | --- |
| Patterns your AI has noticed in how you think or react, in kind words | Access to your AI, your account or your chat history: you copy the answer yourself |
| A moment you told it about, for each one | Health details, diagnoses or mental-health labels |
| Which area of life each one is about | Your sex life, account numbers, passwords or address |
|  | Other people's names or private details |
|  | A verdict on whether you're a good or bad person |

Under the table: "Every guess is yours to rate. Nothing reaches your map unless you say it fits. The text you share is deleted once it's read."

How the answer becomes cards:

- The returned text goes through the safety screen and the screen that strips other people's names and identifying details. Risk stops the import and shows resources (law 8).
- The listener turns each pattern into a belief hypothesis with an area and a type. Up to 5 show as **"Your AI's guess"** cards: label, gentle statement and type pill. The receipt reads "From your AI · \[date\]"; the described moment shows as your AI's note, never as a quote of you (law 2).
- Each card asks "Is this you? Not me · Partly · Very me". Only Very me, Partly or an edit puts it on the map (law 3); Not me keeps it as disputed. Unrated guesses are discarded when the session ends.
- On the map, an imported belief keeps its "from your AI" mark until the person adds a receipt of their own in Talk, and it can't sit at core until Talk evidence meets the core rule. Every card has "Talk about this".
- The shared text is deleted once read; only the receipts of rated cards are kept. The 0.7 bar (law 9) does not gate these cards, because each is labelled a guess and must be rated; gentle wording and nothing clinical (laws 5 and 7) apply to every card.

### 4. Event-based reminders

A reminder goes out only when something has happened or is about to, never because time passed.

| Event | Who gets it | Wording (draft) |
| --- | --- | --- |
| Check-in day | Both partners, at a time each picks (default 2 hours before) | "Your check-in is at 8 tonight." |
| A bridge reaches its time | The receiver | "A bridge is waiting." Or, for a check-in bridge: "You have a bridge for Thursday's check-in." |
| The partner accepts the invite | The inviter | "\[Name\] joined. Pick your check-in time." |
| The check-in time changes | The other partner | "\[Name\] moved your check-in to Friday, 8 pm." |
| An outside perspective clears the Mirror gate | The owner | "Something new on your map." |

Rules: no streaks, no counts of missed days, no "you haven't talked in a while", no alert per parked note or per Mirror contribution, and never a teaser or fake message. The lock screen never shows a belief, note or message. At most one reminder per person per day (two events the same day merge into one), none in quiet hours (22:00 to 08:00 local), and each type can be turned off. The week-3 survey appears in the app, not as a push.

## After beta

Decided as later, not now (31 Oct). Each is revisited once there are beta numbers.

- **Partner home-screen widget**: the next check-in, a bridge waiting, or your sculpture.
- **Couple recap card**, monthly or yearly, made to be shared.
- **Contrast** ("compare with me") for two consenting people.
- **Referral reward**, once prices are set (Nami, 31 Oct). Count only friends who finish onboarding, and never reward Mirror answers.
- **Receiver-aware Bridge and receiver-aware insight**, still also behind the 70% endorsement bar.

## What changed since v2

**The mission, the loop and laws 1 to 10 are unchanged. v3 adds Mirror, gives Bridge a second way to send, and opens Bridge to anyone you link.**

| When | Change | Why |
| --- | --- | --- |
| Oct 31, night | Five starters, with "Finish a few sentences" (the quick start) first. The map's glass never shows how heavy a belief feels: no smoke | Nami's answer to the alignment card (both as the CPO recommended) |
| Oct 31, evening | Alignment audit. Craft pass v1 recorded (map v2, eight hand-drawn marks, the face once a day, the closed motion list, glass sounds, the warm-glow ground) and belief spheres behind Talk's curtain, replacing live shapes. Share sheet opens on the words card, with the wordmark. Engine v2 D1 to D5: answer chips, milestones, faster ways in, the tray, and the fast first card replacing the turn-3 chip; four engine calls and evidence rules. Bridge with anyone you link at launch. Mirror answers structured, with App Store safeguards and outside perspectives limited to reaction, coping or view. Import receipts and park-it safety tightened | Nami's 31 Oct approvals (craft pass, sounds, spheres, prototype screens, engine v2, Bridge for friends, Mirror format); CPO alignment audit |
| Oct 31 | Prototype additions 1 to 8 in Nami's order, with specs for the weekly check-in and park-it list, the first card within 3 minutes (with Import from your AI) and event-based reminders. Real partner invites move into the prototype and the partner joins free; referral reward after prices are set; a new After beta list. Appreciation notes stay open (Mirror answer format and Bridge for friends were decided later that day) | Nami's prototype decision, 31 Oct (reasoning in the Success Playbook) |
| Oct 29 | The map and Talk become 3D sculptures under glass; 3D removed from Out. Live shapes follow tone and pace and never name an emotion | Nami's decisions, 26 Oct and 29 Oct |
| Oct 29 | Mirror in launch scope; prices set after a beta with no paywall; launch targeted for late January 2027; couples first (Q1 decided) | Nami's decisions, 27 Oct |
| Oct 25 | Mirror added as its own feature, replacing v2's "belief link" | It reaches the blind spot, and it is a growth loop that is social without being a network |
| Oct 25 | Laws 11 (moments, not verdicts) and 12 (outside input never arrives raw); law 8 now covers Mirror | Outside input needs its own guard rails; anonymous apps failed on raw cruelty |
| Oct 25 | Bridge gains "Send mine, with insight": points, frictions and beliefs touched, above the compose box | Some senders want to keep their own words and still see how it reads |
| Oct 25 | The Bridge rewrite is framed as a curtain that gives the sender courage | Its main value is getting the hard thing said, for the sender |
| Oct 25 | Bridge works with any linked person, with a relationship type; marketing still leads with partners | Hard messages aren't only for couples |
| Oct 25 | The science table adds the Johari window, multi-rater feedback and AI-mediated communication | They ground Mirror and the Bridge design |

**Earlier changes (v1 to v2)**

| When | Change | Why |
| --- | --- | --- |
| Oct 25 | A rating writes straight to the map: Very me and Partly mean endorsed, Not me means disputed | Rating is the confirmation; no separate review step |
| Oct 25 | A light "Is this you?" chip if no card is confident by turn 3 | A first conversation should never end with nothing understood |
| Oct 24 | Talk shows the AI's understanding live, rather than a chat log; the question fades; there is a live caption; starters send the first turn; no time limit | Owner's Talk concept, modelled on Granola: the entrance must show value at once |
| Oct 24 | Cards appear only at 70% confidence, with inline Not me / Partly / Very me; the post-session review screen is gone | Confirmation happens in the flow, not on a separate screen |
| Oct 24 | Gentle wording becomes a law; the quote is only the receipt | A harsh verdict ("I think I'm trash") must never be shouted back |
| Oct 24 | The engine chooses the belief type, shown as a changeable glass pill in plain words (replacing L0–L4 on screen) | Typing a belief is not the person's job |
| Oct 24 | Related beliefs appear under their core belief, on Talk and on the map | Shows how rules and coping sit on a core belief |
| Oct 24 | Map labels of one or two words, revealed on touch; the card shows the statement, receipts with real dates, and links | Truncated sentences as labels didn't work |
| Oct 24 | The Bridge rewrite contract and friction fixes; sender-only in the MVP; clear "couldn't bridge", safety and abuse states | Generic rewriting sounded like boilerplate |
| Oct 23 | Conversation engine v2: one thread, one question, reflection first, permission before sensitive areas, "Never" respected | Template follow-ups broke the conversation |
| Oct 23 | Share card as Wrapped-style vertical cards, three to five chosen beliefs, quotes off by default | The growth artifact, private by default |
| Oct 2026 | Visual direction: warm, minimal, hand-sketched companion and accents, glass controls | Earlier screens looked flimsy and slide-like |
| Oct 2026 | Name changed from Belief Map to Presence | Product name |
| Oct 2026 | The build setup (v1 Part A and the agents' north-star prompt) moved out of this thesis | It now lives in the Operations Thesis |

## Open questions for the CPO

**Fifteen questions are listed; Q1, Q7, Q13 and Q14 are decided, Q5 partly. Q2 still shapes everything else. The v2 question on the belief link is settled by Mirror and replaced by six Mirror and Bridge questions.**

1. **Solo first or couples first?** v1 argued the wedge is couples. The prototype leads with solo Talk and adds Bridge. Decided by Nami: couples first. Bridge leads the store page and onboarding; Talk and the map build up underneath.
2. **Live understanding versus leading the person.** Cards now appear during the conversation. How quickly may they appear before they start steering what the person says next?
3. **Should "Partly" count as endorsed?** Today it puts the belief on the map, marked "partly".
4. **The plain-language types.** Are "a rule I live by", "how I tend to react", "something I believe is true", "a view or taste" and "something I do to cope" the final set?
5. **When to switch on receiver-aware Bridge, and with whom first.** Real partner invites: decided by Nami, in the prototype now, partner joins free (31 Oct).
6. **Presence and Hozur:** one product or two? Presence describes the beliefs you run on; Hozur is about the ones you choose to live by.
7. **Pricing:** the free-tier session cap, Pro, and the couples plan. Decided by Nami: set after the beta, which runs without a paywall.
8. **Mirror thresholds (new).** How many contributors must converge before an outside perspective surfaces, and how many before outside receipts are added to an existing belief?
9. **Contributor sign-in (new).** How much friction is acceptable to stop brigading without killing contributions?
10. **Relationship mix (new).** Should an outside perspective ever say "from friends and family", or is a count the safest limit?
11. **Concern for the owner's safety in Mirror (new).** Map nothing and point the contributor to resources, or let the owner know something in a careful way?
12. **Bridge and Mirror layout (new).** Separate features now; do they later share one "Send" screen, and where does Mirror sit in the tabs?
13. **Bridge beyond couples (new).** Decided by Nami (31 Oct): Bridge works with anyone you link at launch; the store page and onboarding lead with partners.
14. **Mirror answer format (new 31 Oct).** Decided by Nami (31 Oct): structured moment prompts plus an optional short screened detail.
15. **Appreciation notes in the check-in (new 31 Oct).** Can a parked note also be an appreciation ("something I noticed and liked")? Open with Nami.
