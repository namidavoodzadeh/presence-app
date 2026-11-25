# Flow: sign in

Screen: `signIn`. Routes: `POST /auth/apple`, `POST /auth/google`, the Supabase Auth refresh, then `PUT /devices/apns` once notifications are allowed (see `read.md`).

`pendingInvite` is an invite code the app was opened with (`https://kenember.com/i/<code>` or `presence://i/<code>`), kept on the phone until the invite flow uses it.

| State | Event | Next state | On the way |
| --- | --- | --- | --- |
| launching | stored session refreshes | routing | Supabase Auth refresh with the stored refresh token |
| launching | no stored session | signedOut | `signIn` |
| launching | refresh refused (expired or revoked) | signedOut | clear the stored session |
| launching | refresh fails offline | routing | use the stored access token; the first 401 goes to signedOut |
| signedOut | opened by an invite link | signedOut | keep `pendingInvite` |
| signedOut | tap `signIn.apple` | appleSheet | Apple's sheet with a fresh random nonce (its SHA-256 to Apple) |
| signedOut | tap `signIn.google` | googleSheet | Google's sign-in with a fresh random nonce |
| appleSheet | credential | exchanging | `POST /auth/apple {identity_token, nonce, name, adult_confirmed: true, authorization_code}`; `name` only on the first authorization |
| googleSheet | ID token | exchanging | `POST /auth/google {id_token, nonce, adult_confirmed: true, server_auth_code}` |
| appleSheet or googleSheet | cancelled | signedOut | nothing shown |
| appleSheet or googleSheet | fails | signInFailed | the provider line |
| exchanging | 200 | routing | store `access_token`, `refresh_token`, `expires_at` and `me` |
| exchanging | 401 | signInFailed | the provider line (an unverified Google email answers 401 too) |
| exchanging | 400 `invalid` | signInFailed | the provider line; the Ref is logged, never shown |
| exchanging | 5xx or 30 s timeout | signInFailed | the server line; keep Apple's name for the retry |
| exchanging | offline | signInFailed | the offline line |
| signInFailed | tap `signIn.retry` | signedOut | the person picks a provider again |
| routing | `pendingInvite` set | invite flow `peeking` | `invite.md` |
| routing | otherwise | `talk` | Talk is home |

Notes:
- `adult_confirmed: true` is sent because `signIn` says continuing confirms the person is 18 or over, as both routes require.
- `POST /auth/google` is staging-only today (CONTRACT v1.74); see `routes.md`.
- Every call sends `X-Presence-TZ`, so the server learns the person's zone without a `PATCH /me`.
