# Flow: invite someone, and their first open

Screens: `addPerson`, `invitePreview`, the iOS share sheet, `safety`; on the invited person's phone `signIn` then `gift`. Routes: `GET /kennings`, `POST /beliefs`, `POST /invites` (needs the gift fields, see `routes.md`), `GET /invites/:code` (needs the gift in its reply), `POST /invites/:code/accept`.

Adding a person gives before it asks: the invite carries one kenning, in the inviter's own words, picked for that person (V3 package, "Invite links"; F4, F4b). The link works for one person and expires in 7 days.

## Inviter

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| home | tap `home.add`, or `home.write` with nobody on Home | naming | `addPerson` rises |
| naming | type a name, pick a WHO chip (optional) | naming | Next is enabled once the name has a letter |
| naming | tap `addPerson.next` | previewLoading | `invitePreview` slides in; `GET /kennings` |
| naming | tap `addPerson.cancel` or `addPerson.close` | home | nothing kept |
| previewLoading | 200 with at least one kenning that has `own_wording` | picked | the newest such kenning is picked; up to two others under "Or give this one" |
| previewLoading | 200, none with `own_wording` | writingOwn | F4b: the one empty line; Send invite dimmed |
| previewLoading | fails | previewFailed | the unavailable line and Try again |
| previewFailed | tap `invitePreview.retry` | previewLoading | |
| picked | tap `invitePreview.other.N` | picked | that one becomes the picked kenning; the one shown before moves into the list |
| writingOwn | type words | writingOwn | Send invite enabled once there is a letter |
| picked | tap `invitePreview.send` | creatingInvite | `POST /invites {relationship, gift: {belief_id}}` |
| writingOwn | tap `invitePreview.send` | savingOwn | `POST /beliefs {statement, relationship}` |
| savingOwn | 201 `created` | creatingInvite | `POST /invites {relationship, gift: {belief_id}}` with the new belief |
| savingOwn | 200 `state: "safety"` | safetyStop | `safety` with the resources; nothing was stored |
| savingOwn | 400 `invalid` (over 400 characters) | writingOwn | the too-long line under the field |
| savingOwn | fails | writingOwn | the not-sent line; the words stay |
| safetyStop | tap `safety.close` | writingOwn | the words stay in the field |
| creatingInvite | 200 | sharing | iOS share sheet with the share text and `link` |
| creatingInvite | fails | picked or writingOwn | the not-sent line |
| sharing | shared (any activity completes) | home | sheet and act close; Home shows the person once they accept |
| sharing | share sheet cancelled | picked | the same invite is reused if Send invite is tapped again (no second code) |
| picked or writingOwn | tap `invitePreview.back` or `invitePreview.backButton` | naming | the name and chip are kept |

## Invited person

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| (app opened by the link, signed out) | | sign-in flow | `pendingInvite` kept; see `sign-in.md` |
| (app opened by the link, signed in) | | peeking | |
| peeking | | peeking | `GET /invites/:code` |
| peeking | 200 | giftShown | `gift`: the inviter's name and the words given |
| peeking | 404 `not_found` (expired, used, revoked, unknown) | linkDead | the dead-link line; `gift.continue` goes on |
| peeking | 400 `invalid` (own code) | linkOwn | the own-link line; `gift.continue` goes on |
| peeking | fails | giftFailed | the unavailable line and Try again |
| giftFailed | tap `gift.retry` | peeking | |
| giftShown | tap `gift.continue` | accepting | `POST /invites/:code/accept` |
| accepting | 200 | home | clear `pendingInvite`; Home shows the inviter |
| accepting | 409 `conflict` (already linked) | home | clear `pendingInvite` |
| accepting | 404 | linkDead | the link was used or expired meanwhile |
| accepting | fails | giftShown | the not-sent line; Continue stays |
| linkDead or linkOwn | tap `gift.continue` | home | clear `pendingInvite` |

Notes:
- Only kennings with `own_wording` (the person's own first-person words) are offered, so the other person never reads a second-person line such as "Part of you feels…" as if the inviter wrote it.
- The invited person is never asked for anything before receiving (F3b). Their own first Talk is reached from Home's line "Add something about you".
- The web page at `kenember.com/i/<code>` already exists in `site/` and is not part of this package.
