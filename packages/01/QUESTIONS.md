# Package 01: questions for the owner

Where the frozen V3 design does not cover something the five steps need. Simplest option first; the package is written as if you pick it.

**Q1. Sign-in is not drawn.**
- **(a) Simplest:** one screen on the ground colour with the light behind: the wordmark, "Say hard things the way you mean them.", Apple's own Sign in with Apple button, the line "Kenember is for adults. By continuing, you confirm you're 18 or over.", "Kenember is an AI, not a person." and a Privacy link. Apple only.
- (b) The same with Google added (the route is staging-only today).

**Q2. Which engine runs the first Talk.** The repo's laws (`docs/THESIS-LAWS.md`, twelve laws) and the 15 Nov communication spec (amended laws, items collected by asking) disagree, and Talk has an engine for each.
- **(a) Simplest:** the live `POST /talk/turn`: belief suggestions, confirmed with That's me; the person ends Talk with ✕. Matches the repo's laws as they stand.
- (b) `POST /comm/talk/turn`: communication items, ends itself after a few turns "on care". Its migration is not applied, it is owner-only, and the repo's laws would need the 15 Nov amendments first.

**Q3. Three states the five steps reach are not drawn:** consent chips in Talk (Sure, Not now, Never), the safety stop (law 8), and Write refusing a threat.
- **(a) Simplest:** consent as three plain glass chips under the question; the safety stop as one glass sheet with the server's message, resource links and Close, appearing at once; the refusal as one line under the words ("This can't be sent as written.", plus the server's headline) with Edit, Send disabled.
- (b) Wait for CDO frames before these three are built.

**Q4. Home with nobody on it.** H3 "Who's on your mind?" opens a first message before anyone is linked, which needs a pending-recipient design.
- **(a) Simplest:** Home shows only the bar; Write and + both open Add a person. H3 waits for a later package.
- (b) Draw a one-line empty Home ("Add someone you want to understand, or be understood by.") above the bar.

**Q5. What "Keep" does on a received card.**
- **(a) Simplest:** Keep closes the card; it stays on the person page. No server call.
- (b) Keep marks the card kept for both people (`PATCH /cards/:bridge_id`; not deployed).

**Q6. How the receiver finds out a card arrived.** Nothing reaches a closed app today without push.
- **(a) Simplest:** no notification in package 01; the receiver sees "New card from [Name]" on Home the next time they open the app.
- (b) A push with no content and no name, "A new card is ready.", through the APNs sender already built (CONTRACT §12). Adds the notification-permission ask and device registration to the package.
