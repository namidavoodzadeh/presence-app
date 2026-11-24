# Flow: sign in

Screen: `signIn`. Route: `POST /auth/apple`. On launch the app first checks for a stored session.

`pendingInvite` is an invite code the app was opened with (`https://kenember.com/i/<code>` or `presence://i/<code>`), kept on the phone until the invite flow uses it.

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| launching | stored session refreshes | routing | Supabase Auth refresh with the stored refresh token |
| launching | no stored session | signedOut | show `signIn` |
| launching | refresh fails (expired or revoked) | signedOut | clear the stored session; show `signIn` |
| launching | refresh fails (offline) | routing | use the stored access token; the first call that answers 401 goes to signedOut |
| signedOut | opened with an invite link | signedOut | store `pendingInvite`; stay on `signIn` |
| signedOut | tap `signIn.apple` | appleSheet | Apple's sheet with a fresh random nonce (its SHA-256 goes to Apple) |
| appleSheet | person cancels | signedOut | nothing shown |
| appleSheet | Apple returns a credential | exchanging | `POST /auth/apple` with identity token, raw nonce, name (first authorization only), `adult_confirmed: true`, authorization code |
| appleSheet | Apple fails (not a cancel) | signInFailed | show the Apple failure line |
| exchanging | 200 | routing | store `access_token`, `refresh_token`, `expires_at`; keep `me` |
| exchanging | 401 `unauthorized` | signInFailed | show the Apple failure line |
| exchanging | 400 `invalid` | signInFailed | show the Apple failure line; the Ref goes in the log, never on screen |
| exchanging | 5xx or timeout (30 s) | signInFailed | show the server failure line; keep the name Apple gave, for the retry |
| exchanging | offline | signInFailed | show the offline line |
| signInFailed | tap `signIn.retry` | appleSheet | as above |
| routing | `pendingInvite` set | invite flow `peeking` | see `invite.md` |
| routing | no `pendingInvite`, `GET /conversations` shows none and `GET /kennings` shows none | first Talk `opening` | see `first-talk.md` |
| routing | otherwise | home | show `home` |
| routing | `GET /conversations` or `GET /kennings` fails | home | Home loads on its own; nothing is lost |

Notes:
- `adult_confirmed: true` is sent only because the sign-in screen states that continuing confirms the person is 18 or over (copy `signIn.adult`), as the contract requires.
- `PATCH /me {tz}` is not needed: the server learns the zone from `X-Presence-TZ`, which every call sends.
- A person who signs in again on a new phone after finishing their first Talk goes to Home, never to a second first Talk.
