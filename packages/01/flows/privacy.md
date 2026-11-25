# Flow: AI consent and Settings

Views: `aiConsent`, `settings`. Routes: `GET /me`, `POST /consent/ai`, `DELETE /consent/ai` (CONTRACT §11.4, not ready), `GET /export`, `DELETE /account`, `DELETE /devices/apns/:installation_id`, Supabase Auth sign-out.

Why these are in a thin package: every Talk turn and every note sends the person's words to Anthropic, and App Store guideline 5.1.2(i) requires a clear disclosure naming that third-party AI and explicit permission before anything is sent. Account creation requires in-app account deletion (guideline 5.1.1(v)). Law 10 requires export and delete in one tap. See `compliance.md`.

## AI consent

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| asked (after sign-in, or a 403 `ai_consent_required`, or the version moved on) | | showing | `aiConsent` over the greenhouse: what is sent, to whom, what is not, and that it can be turned off |
| showing | tap `aiConsent.agree` | saving | `POST /consent/ai {version: required_version, providers: ["anthropic"]}` |
| saving | 200 | given | back to where the person was going; a Talk turn that was refused is sent again once, with the same words |
| saving | 400 `invalid` (version unknown) | showing | `GET /me` again for the current version, then the same screen |
| saving | fails | showing | the not-saved line; nothing is sent to the AI |
| showing | tap `aiConsent.notNow` | declined | `talk` without the AI: the greeting, the not-agreed line and "Turn on Kenember's AI" in place of the first question; People, threads and reading still work; writing sends with no notes |
| declined | tap the turn-on line, or `settings.ai` | showing | |
| showing | tap `aiConsent.privacy` | showing | kenember.com/privacy in Safari |

## Settings

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| any view | tap `pull.mark`, or drag down from the top 140 pt | open | the curtain clouds over; the rows appear etched |
| open | touch outside the rows | closed | the clouding clears |
| open | tap `settings.ai` while On | withdrawing | `DELETE /consent/ai` |
| withdrawing | 200 | open | the row reads Off; from now on nothing is sent to the AI until it is turned on again; nothing already kept is deleted |
| withdrawing | fails | open | the not-saved line; the row still reads On |
| open | tap `settings.ai` while Off | `aiConsent` | |
| open | tap `settings.privacy` | open | kenember.com/privacy in Safari |
| open | tap `settings.download` | exporting | `GET /export` |
| exporting | 200 | open | the iOS share sheet with `presence-YYYY-MM-DD.json` |
| exporting | fails | open | the not-ready line |
| open | tap `settings.logOut` | loggingOut | `DELETE /devices/apns/:installation_id`, then Supabase Auth sign-out; the phone forgets the session, drafts and Talk turns it kept |
| loggingOut | done (either call may fail) | `signIn` | a failed device removal is retried at the next sign-in |
| open | tap `settings.delete` | confirming | one glass card: what goes and what stays, with "Delete" and "Keep my account", the same size |
| confirming | tap `settings.cancelDelete` | open | |
| confirming | tap `settings.confirmDelete` | deleting | `DELETE /account` |
| deleting | 200 | `signIn` | the phone forgets everything it kept; the deleted line shows on `signIn` once |
| deleting | 403 `preview_account` or `example_account` | open | the test-account line; nothing is deleted |
| deleting | fails | confirming | the not-deleted line; nothing changed |

Notes:
- `DELETE /account` already revokes a stored Sign in with Apple token at Apple before it deletes, as guideline 5.1.1(v) asks (CONTRACT §3).
- The consent screen is never shown inside a Talk turn as a sheet over words; it is its own view, and nothing the person typed is lost while it is up.
