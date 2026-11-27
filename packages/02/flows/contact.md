# Flow: someone not on Kenember (a contact)

Views: `someoneNew`, `people`, `thread`. Routes: `POST /contacts`, `DELETE /contacts/:id`, `POST /invites {contact_id}`, `GET /home` (contacts as rows), all **not ready** (routes.md).

A contact is a first name and a relationship that only the person who added it can see. It is never told about, never notified and never matched with any account. Nothing written to or about a contact becomes an item, a label or a summary about them (law 15).

## Adding

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| someoneNew open | tap `someoneNew.notHere` | addingContact | the gift and Share the link go; the chips and the name stay; the bar's send reads "Add [Name]" once a name is typed |
| addingContact | tap a chip, type a name | addingContact | |
| addingContact | tap `someoneNew.add` | saving | `POST /contacts {name, relationship}` |
| saving | 200 | thread | People closes; the contact's thread opens empty, with `thread.contactEmpty` and the bar "Get ready to talk to [Name]" |
| saving | 400 `invalid` `field: "name"` | addingContact | `someoneNew.nameProblem` under the name |
| saving | 409 `conflict` `reason: "same_name"` | addingContact | `someoneNew.sameName`, and "Open [Name]" opens the existing contact's thread |
| saving | 429, 5xx, offline, timeout | addingContact | `someoneNew.notAdded` and Try again |
| addingContact | tap `someoneNew.notHere` again | someoneNew open | back to the invite form |

## In People

A contact is a row like any person, ordered by the most recent talk card, then by name. The row's second line is `people.notHere`. A long press offers "Remove [Name]" (`people.removeContact`), which asks once (`people.confirmRemove`) and calls `DELETE /contacts/:id`. That deletes the contact, its drafts and its talk cards, for good.

## Inviting a contact later

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| contact thread | tap `thread.invite` | someoneNew open | the invite form, with the name and chip filled in |
| someoneNew open | tap `someoneNew.share` | sharing | package 01's invite flow, with `POST /invites {contact_id, relationship, gift}` |
| (later) they accept | | linked | the server moves the contact's talk cards and drafts to the new link and deletes the contact. The row becomes the linked person's row. [Name] sees none of them |
