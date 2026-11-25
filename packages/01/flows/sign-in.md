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
| signedOut | tap `signIn.apple` or `signIn.google` | checkingAge | Declared Age Range request with an age gate at 18 (iOS 26 and later) |
| checkingAge | declared 18 or over | appleSheet or googleSheet | the provider the person tapped, with a fresh random nonce (Apple gets its SHA-256) |
| checkingAge | declared under 18 | underAge | the adults-only line; no provider sheet, nothing sent |
| checkingAge | declined, not available, or an older iOS | appleSheet or googleSheet | the on-screen 18+ statement stands as the person's own declaration |
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
| routing | | checkingConsent | `GET /me` (`ai_consent`) |
| checkingConsent | `given` matches `required_version` | next | |
| checkingConsent | `given` is null or behind | `aiConsent` | see `privacy.md`; the next step waits for the answer |
| checkingConsent | `GET /me` fails | next | the first model call answers `403 ai_consent_required` if consent is missing, and Talk shows `aiConsent` then |
| next | `pendingInvite` set | invite flow `peeking` | `invite.md` |
| next | otherwise | `talk` | Talk is home |
| underAge | | underAge | stays; signing in is not offered |

Notes:
- `adult_confirmed: true` is sent only when the age range says 18 or over, or when the range is not available and the person continued past the 18+ statement. Kenember is for adults only (thesis); Texas SB 2420 and the similar Utah and Louisiana laws make the developer use the store's age signal where it exists (`compliance.md`).
- `POST /auth/google` is staging-only today (CONTRACT v1.74); see `routes.md`.
- Every call sends `X-Presence-TZ`, so the server learns the person's zone without a `PATCH /me`.
