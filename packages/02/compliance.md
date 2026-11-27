# Package 02: compliance

Status: draft, 27 Nov 2026. A check of what package 02 adds against the fixed lines (privacy, safety, security, the law, App Store rules). Package 01's `compliance.md` stands.

| Line | What package 02 adds | Holds because |
| --- | --- | --- |
| AI consent before words go to Anthropic (App Store 5.1.2(i)) | Words for a talk card, insight with `for: "talk"` | Both run on `POST /bridge/insight` and the Park it safety read, which are behind the AI-consent gate (CONTRACT §11.4, extended to `POST /prep/:person`). No new AI provider |
| Safety (law 8) | Preparing to face someone; a kept card | The same floor and model read as Park it on every keep and every edit. Third-person harm stops it, resources show privately, nothing is stored |
| Data about people who never agreed (privacy; law 15) | Contacts and words written about them | A contact is a first name and a relationship, visible only to the person who typed them. Nothing is inferred, matched, labelled or summarised about the contact, and no notice goes to anyone |
| Special-category data (law 10) | Talk cards | Private to the writer, no route for anyone else, encrypted like drafts, in export, deleted with the account or the contact |
| Account deletion in the app (App Store 5.1.1(v)) | New stores | `DELETE /account` removes contacts and talk cards |
| Analytics | The measures in SCOPE.md | Counts and tiers only. No words, names, draft text or quotes |
| Claims (Nami, 15 Nov) | The follow-up question | It asks whether getting ready helped the person say it as they meant. It makes no claim about the conversation or the relationship |
| Not therapy | The talk card | No feelings vocabulary, no labels, no outcome promises, no practice or role-play with the AI |
