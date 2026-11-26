# Package 02 input: "Prepare for a conversation" (proposal, not a package)

Status: an idea from the owner (26 Nov 2026), with the setup chat's read below. Nothing here is frozen or scheduled. Package 01 is frozen and does not change for this.

## The setup chat's read (26 Nov)

- **Not in package 01.** Its 32 issues and their tests are written against the frozen package; adding a feature now would repeat the "design replaced mid-build" failure.
- **Proposed as the lead of package 02.** It gives value to one person alone, with no need for the other person to be in the app.
- **A simpler shape to weigh first:** preparing and writing are one act with two endings. In a person's thread, the same words and the same notes end either in "Fold and send" or in "Keep for when you talk". That would reuse the thread, the pause and the note cards, and add one ending and one saved card.
- **What is new for the engine either way:** a suggested way to open, the case where the other person is not in the app (no person id), a gold set for spoken preparation, and the safety and AI-consent gates on the new call.
- **Rough size:** one engine route with its evaluation set, one flow, two views, contract and tests. About a quarter of package 01 by issue count. No estimate in days until package 01 has produced real throughput numbers.

## The proposal as written

FEATURE PROPOSAL: "Prepare for a conversation" (working title)

1. THE IDEA IN ONE LINE
Help a person get ready for a conversation they will have out loud (in person or on a call), using what they've told Kenember about themselves and what the other person has chosen to share.

2. WHY
- Kenember is communication-first: better conversations with your partner, friends and family, with insight from both sides.
- Today that insight only appears when you write a message. But most hard conversations happen face to face or by phone, not by text.
- It fits the direction that Kenember is a companion to how people already communicate, not a replacement messenger. The app helps you prepare; you do the talking.
- It makes Talk more than a place where the app asks questions and collects kennings. Talk also becomes the place you come to for help before a real conversation.
- It gives a reason to open the app that doesn't depend on the other person replying inside it.

3. WHAT THE PERSON DOES
- They start it from Talk ("I need to talk to someone about something") or from a person's page.
- They say who it's with and what they want to bring up, in their own words, typed or dictated. Example: "I want to tell my sister I can't host this year. I was going to say it like this..."
- They get a short card back and can go back and forth to refine it.
- They can keep the card: on that person's page, or for the next check-in.

4. WHAT COMES BACK
- A small card: 2 or 3 things to keep in mind, plus one suggested way to open.
- Each point shows where it came from: one of their own kennings, or one the other person shared with them.
- Two cases:
  a) The other person is a contact who shared kennings: the insight uses both sides. ("Sam shared that they'd rather hear the headline first.")
  b) The other person isn't in the app, or hasn't shared: the insight uses only the person's own kennings, and the card says so plainly. It can also invite them to bring that person in, without pushing.

5. PRINCIPLES (these are fixed)
- Prepare, don't script. A few points and an opening line, never a full speech. The person should sound like themselves.
- Never guess about the other person. Only what they chose to share, shown with its source. No mind-reading, no personality labels.
- Not a rewriting tool. The value is the insight about the two people, not nicer wording.
- AI is the helper, not the point. The conversation stays between the two people.
- The same safety stop applies as in Talk and Bridge: if someone describes fear, threats, control or violence, it stops and shows resources privately.
- No outcome claims ("this will work"). No therapy language.
- Privacy as everywhere else: the person's words are theirs; sharing is opt-in and selective.

6. WHAT IT REUSES
- The existing insight engine behind writing a message (it already reads the sender's kennings and the receiver's shared ones). The new part is the input framing and the card output.
- Talk's conversation surface and dictation.
- The person page and check-in for saving the card.

7. OPEN TO YOUR JUDGMENT (please propose, don't wait for me)
- The name and the entry point wording.
- Whether it lives inside Talk, on the person page, or both.
- The card's shape, and whether the back-and-forth is a chat or card revisions.
- Whether there's a light follow-up after the conversation ("How did it go?"), which could also teach us if it helped. Only if it stays optional and short.
- Whether a preparation can turn into a written message when the person decides to text instead.
- How this affects the first-time experience: could "prepare for one real conversation" be a faster first win than writing a message?
- Any better idea that serves the same goal. If you see a simpler or stronger version, propose it.

8. WHAT I NEED BACK
- A short proposal: the flow in 4-6 screens or steps, what's reused vs new, and the build estimate in days.
- A psychology check on "prepare, don't script" and on the unknown-person case.
- What we should measure (for example: preparations started, cards saved, with vs without shared kennings), with no user words stored in analytics.
- Your recommendation: build it into the current version, or schedule it right after. I decide once I see the estimate.
