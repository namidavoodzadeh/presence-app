<!-- Verbatim excerpts from docs/PRODUCT_THESIS.md (v3). Every task obeys these. Read the full thesis for any spec, design or gate work. -->

# Thesis v3 — the parts every task must obey

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
9. **Confidence earns the screen.** A belief appears during the conversation only at confidence of 0.7 or more, and gently. Below that, the engine keeps listening or offers a light "Is this you?"
10. **Beliefs are special-category data.** Encryption, no training on user content, and export or delete in one tap. Bridge reads a partner's beliefs only with their explicit consent.
11. **Moments, not verdicts (new).** Outside input is a described moment: what was happening, what the person did or said. A label about character ("he's selfish") is never evidence on its own. Contributors describe, the engine infers, the owner decides.
12. **Outside input never arrives raw (new).** Mirror input is never shown word for word and never shows who wrote it. It reaches the owner only when several people converge, and the map only when the owner confirms it.

## Safety, privacy and trust

**Presence is descriptive self-knowledge, never therapy, and trust is the product. Mirror raises the stakes, so it carries the strictest rules in the app.**

- **Not therapy.** No diagnosis, treatment, advice or mental-state labels. The copy, the engine, the map, Bridge insight and Mirror all hold this line. It is right legally, given the restrictions on AI therapy, and right strategically.
- **Risk stop.** A message showing risk to self or others stops mapping in Talk, bridging in Bridge, and processing in Mirror. Resources are shown, and nothing is extracted from that message.
- **Your data.** Beliefs are special-category data: per-user encryption, no training on user content, no ads. "Download a copy" and "Delete my map" (with confirmation) sit in Settings.
- **Consent in Bridge.** The receiver's beliefs are never read without their explicit share, never quoted, and never used to argue a side. Sending the raw message is always one tap away. Receiver-aware insight, when switched on, offers a possibility, never a verdict on what someone meant.
- **Mirror protections (new).** Adults only on both sides. Off by default. Never raw, never named, never from one person. No reply channel, no per-message or teaser alerts, and never a fake message. Raw contribution text is deleted once processed. Pause, rotate or delete the link, and everything pending, in one tap.
- **Contributor privacy (new).** The owner never learns who contributed. Anything that could identify a contributor is stripped before a summary is written.
- **Honest about what it is.** The map is a portrait drawn from what you said and what others saw, not a scan of who you are, and the product says so. People perform a little for any listener, including an AI, and observers see only part of a person; no design removes that, so we name it.

## Scope: now, next, later

**DEV 49 is unchanged: the first prototype on your phone that covers the MVP. v3's additions start after DEV 50; the COO sets their order and numbering.**

- **Now, DEV 49:**
  - Talk with live understanding and inline rating, on engine v2;
  - extraction with receipts, and reconciliation across sessions;
  - the 2D map with Foundations, Domains and List;
  - the share card;
  - Bridge end to end with check-in, using the sender's own map only;
  - the safety stop;
  - Settings: download, delete, log out, help;
  - no dead controls anywhere.
- **DEV 50:** cosmetic polish: the hand-sketched companion art, motion and spacing.
- **Next, new in v3 (order set by the COO):**
  - Bridge "Send mine, with insight", sender-side insight only;
  - a relationship type on each Bridge link (partner, friend, family, coworker);
  - Mirror MVP: owner link and controls; the web contributor page with sign-in; observation listener, screen, mapper and convergence gate; outside-perspective cards; "Talk about this"; "seen by others" marks and receipts on the map.
- **Next, after the 70% endorsement bar:**
  - receiver-aware Bridge and receiver-aware insight;
  - attaching a belief to a message ("show them why");
  - Contrast;
  - real partner invites (your decision).
- **Later:** profiles and follows, communities, Android and the full web app, anonymous aggregate research.
- **Out:** 3D, streaks, badges, scores, comparisons to norms, evaluative or therapeutic copy, raw anonymous messages, and per-message "someone wrote about you" alerts.
