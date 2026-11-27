# Package 02: routes

Status: draft, 27 Nov 2026. The server routes package 02 needs, by name. Package 01's routes are used unchanged. Everything new below is **not ready**: it needs a contract proposal pull request (contract changes go through one), the engine items, migrations and the hosted deploy before the app items can start. Every call sends package 01's headers, and errors keep the `{error, ref, message?, …}` shape.

## By view
| View | Route | Used for | Notes |
| --- | --- | --- | --- |
| `someoneNew` | `POST /contacts` | Add someone not on Kenember | **New** |
| `people` | `GET /home` | Contacts as rows | **Change:** rows gain `status: "contact"` |
| `people` | `DELETE /contacts/:id` | Remove a contact | **New** |
| `thread` | `GET /drafts/:person`, `PUT`, `DELETE` | Unsent words, for a contact too | **Change:** accept a contact's id |
| `thread` | `POST /bridge/insight` | Notes at a pause | **Change:** `for`, and a contact's id |
| `thread` | `GET /prep/:person` | The talk cards | **New** |
| `when` | `POST /prep/:person` | Keep a talk card | **New** |
| `talkCard` | `PATCH /prep/:id` | We talked, Let go, the follow-up answer | **New** |
| (contact removed, account deleted) | `DELETE /prep/:id` and cascades | Remove a card | **New** |
| `someoneNew` (invite a contact) | `POST /invites` | Invite, then move the cards on accept | **Change:** `contact_id` |
| `settings` | `GET /export`, `DELETE /account` | Download and delete | **Change:** include contacts and talk cards |

## Proposed shapes (additive)

**1. Contacts.**
- `POST /contacts {name, relationship}` → `{person: Person}`, where `Person.status` is `"contact"`. `name` is 1 to 40 characters, a first name. `relationship` is `partner | friend | family`. The same name (case-insensitive) as one of the caller's contacts is `409 conflict`, `reason: "same_name"`, with `person_id`. Owner-only: no other account can ever read, find or match a contact, and nothing is sent anywhere.
- `GET /home` lists contacts with `status: "contact"` and no reason line, ordered by the latest talk card, then name.
- `DELETE /contacts/:id` deletes the contact, its drafts and its talk cards, for good.
- A contact's id works as `:person` on the drafts routes, `/prep` and `POST /bridge/insight`, and nowhere else (`/threads`, `/bridges`, `/people/:person/map`, check-in and sharing routes answer `404 not_found`, `where: "link"`).

**2. Insight for speaking.** `POST /bridge/insight` takes `for: "message" | "talk"` (default `message`; anything else is `400 invalid`, `field: "for"`).
- `talk` keeps every check, the safety floor, the AI-consent gate, the tiers, soften only and the source rule. It drops checks that only apply to written text (the PSY advisor lists which, with the gold set). It never writes a sentence the person did not start.
- For a contact, there is no receiver pack: notes are Tier 2 (`from_me`, CONTRACT v1.92 rules) or Tier 1 (general), `about: "wording"` only, and `from_them` is always empty.
- Each `highlights[]` entry gains `tier: 1 | 2 | 3`. The app needs it for the talk card and the measures, and it is useful to package 01 too.

**3. Talk cards.**
- `POST /prep/:person {text, notes: [{text, tier, item_id}], ask_line, replaces}` → `{state: "kept", card: PrepCard}` | `{state: "risk", card: null, line, resources}` | `{state: "declined", card: null, line: null, resources: null, spans, headline}`.
  - The same safety floor and model read as Park it (`floorSafety`, then `analyse`'s safety field, `decidePark`). Third-person harm stops it, and nothing is stored.
  - At most two `notes`. `item_id` must be an item [Name] shares with the caller now; otherwise it is dropped.
  - `replaces` (a card id or null) deletes that card once the new one is kept.
  - A kept card deletes the draft for that person.
  - `text` is 1 to 4,000 characters.
- `PrepCard {id, person_id, text, notes: [{text, tier, quote, quote_label}], ask_line, state: "kept" | "talked" | "let_go", created_at}`. `quote` and `quote_label` are rendered from the live grant on every read, as CONTRACT v1.51: a withdrawn share shows `null`. Nothing about the quote is stored but the item id.
- `GET /prep/:person` → `{cards: [PrepCard]}`: only `kept` cards, oldest first. The caller's own cards only; there is no route for [Name] to read them, and none is planned (law 10).
- `PATCH /prep/:id {state: "talked" | "let_go"}` or `{helped: "yes" | "partly" | "no"}`. A card that is not the caller's is `404`. `helped` is stored as a count on the card and in the measures, never as text.
- `DELETE /prep/:id` deletes it for good.
- Closed cards (`talked`, `let_go`) are kept for export and deleted with the account. They are never shown in the app again.

**4. Inviting a contact.** `POST /invites` takes `contact_id`. On `POST /invites/:code/accept`, the contact's drafts and talk cards move to the new link, and the contact is deleted. Nothing about them is shown to the person who accepted.

**5. Export and delete.** `GET /export` adds `contacts[]` (name, relationship, created) and `prep_cards[]` (every state). `DELETE /account` removes both.

## Engine items this needs (for the planner)
1. Contract proposal pull request: everything in this file.
2. Migration and routes: contacts.
3. Migration and routes: talk cards, with the Park it safety path.
4. `POST /bridge/insight`: `for`, contacts, `tier`.
5. Spoken-preparation gold set and eval run (the PSY advisor owns the gold set).
6. Invite a contact, and the move on accept; export and delete.

## Not used in package 02
Everything package 01 lists as not used, still. Check-in routes stay unused: bringing a talk card to a check-in is a later package.
