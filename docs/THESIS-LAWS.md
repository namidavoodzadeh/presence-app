<!-- Verbatim excerpts from the live Product Thesis v3 (https://claude.ai/artifact/4wMPx7VWs3ZBMrptensS1W), copied 24 Nov 2026. Every task obeys these. Read the full thesis for any spec, design or gate work. -->

# Thesis v3 — the parts every task must obey

## Product laws

**Fifteen laws hold whatever the design. Laws 1 to 12 date from v2 and v3. On 15 Nov Nami approved the communication model's changes to laws 1, 3, 7, 8, 9, 10 and 12, and three new laws, 13 to 15 (cpo-2026-11-15-comm-laws).**

1. **Ask about how you communicate; infer nothing about who you are.** Talk asks how the person communicates and offers what they say back, in their own words, to confirm. The engine never infers traits, mood or who the person is (Nami 15 Nov, cpo-2026-11-15-comm-laws; was 'Infer, don't ask; confirm, don't lead').
2. **No receipts, no belief.** Every belief links to the person's own words and the date they said them, or, for Mirror, to the moments others described.
3. **The person decides.** A belief reaches the map only when the person rates it Very me or Partly, or edits it. "Not me" is kept and marked, never silently deleted. This holds for beliefs from Mirror too. The engine suggests wording, kind, scope and expiry; the person confirms each (15 Nov).
4. **Describe, never prescribe.** The app never calls a belief good, bad, healthy or unhealthy, and never suggests changing it.
5. **Gentle wording, always.** A belief is phrased with care ("Part of you feels you're not enough for others"), never as a harsh verdict, however strong the evidence. The quote is the receipt, never the headline.
6. **Tensions are mapped, not resolved.**
7. **Nothing clinical on screen.** No diagnoses, mood labels or schema names. Belief types use plain words. Never on screen: flooding, pursuer, withdrawer, avoidant, anxious, attachment, rejection sensitivity, love language (except the one line that explains it in Talk), Four Horsemen, contempt, toxic, red flag, trigger, style, pattern (15 Nov).
8. **Safety overrides everything.** Risk to self or others stops mapping, bridging and Mirror processing and shows resources. An item that describes harm, or asks to control another person beyond how you talk to each other (where they go, who they see, their money or phone), is not kept, and the safety route applies (15 Nov).
9. **Confidence earns the screen.** A belief appears during the conversation only at confidence of 0.7 or more, and gently. Below that, the engine keeps listening. The first card of a session can show live; later cards wait in a tray at natural pauses (Nami, 31 Oct). Since 15 Nov this law applies only to suggestions the engine draws from drafts, Mirror or import; what a person says in Talk is offered at once, in their own words, for them to confirm
10. **Beliefs are special-category data.** Encryption, no training on user content, and export or delete in one tap. Bridge reads a partner's beliefs only with their explicit consent. What lands hard and This week are private by default and get the strongest protection; This week is deleted when it ends (15 Nov).
11. **Moments, not verdicts (new).** Outside input is a described moment: what was happening, what the person did or said. A label about character ("he's selfish") is never evidence on its own. Contributors describe, the engine infers, the owner decides.
12. **Outside input never arrives raw (new).** It never shows who wrote it. Moments on your Mirror link reach you when several converge. Ask me answers each reach you only as a short card in Kenember's words; overlapping ones fold into one card ('This came up in more than one answer.'); one about a kenning you already confirmed only adds a quiet mark ('Came up in 4 answers'). A single answer about a time you let someone down waits for a second one. Nothing joins your map until you confirm it. (Nami 14 Nov, cpo-2026-11-14-law12; dec-mirror-ask-me-13nov.) Outside answers can suggest only things others can see: how I mean things, what I do when it gets heated, how I show care (15 Nov).
13. **Soften only, everywhere (new, 15 Nov).** No surface helps one person use what another shared to make something land harder, and nothing ranks a person's sore spots.
14. **An item is information, not a rule for the other person (new, 15 Nov).** The app never tells a receiver how to feel or what they may not do.
15. **Items describe the person, never the other (new, 15 Nov).** "Jan never listens" is not an item.

## Safety, privacy and trust

**Presence is descriptive self-knowledge, never therapy, and trust is the product. Mirror raises the stakes, so it carries the strictest rules in the app.**

- **Not therapy.** No diagnosis, treatment, advice or mental-state labels. The copy, the engine, the map, Bridge insight and Mirror all hold this line. It is right legally, given the restrictions on AI therapy, and right strategically.
- **Risk stop.** A message showing risk to self or others stops mapping in Talk, bridging in Bridge, and processing in Mirror. Resources are shown, and nothing is extracted from that message.
- **Your data.** Beliefs are special-category data: per-user encryption, no training on user content, no ads. "Download a copy" and "Delete my map" (with confirmation) sit in Settings.
- **Consent in Bridge.** The receiver's beliefs are never read without their explicit share, never quoted, and never used to argue a side. Sending the raw message is always one tap away, except for a threat or abuse, which Presence never sends. Receiver-aware insight, when switched on, offers a possibility, never a verdict on what someone meant.
- **Mirror protections (new).** Adults only on both sides. Off by default. Never raw, never named. Mirror-link moments never surface from one person. Ask me answers come with no name field and reach the owner only as short cards in Kenember's words, behind the moment filter, the safety stop, at least three answers before any card, a 7-day link and Report; a single harsh answer waits for a second (law 12, 14 Nov). No reply channel, no per-message or teaser alerts, and never a fake message. Raw contribution text is deleted once processed. Pause, rotate or delete the link, and everything pending, in one tap.
- **Contributor privacy (new).** The owner never learns who contributed. Anything that could identify a contributor is stripped before a summary is written.
- **Honest about what it is.** The map is a portrait drawn from what you said and what others saw, not a scan of who you are, and the product says so. People perform a little for any listener, including an AI, and observers see only part of a person; no design removes that, so we name it.

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
  - full Contrast (Compare lite ships at launch, Nami 4 Nov);
  - real partner invites: moved into the prototype (31 Oct). The three items above are now also listed under After beta.
- **Later:** profiles and follows, communities, Android and the full web app, anonymous aggregate research.
- **Out:** streaks, badges, scores, comparisons to norms, evaluative or therapeutic copy, raw anonymous messages, and per-message "someone wrote about you" alerts.
