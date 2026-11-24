# Contract

`openapi.yaml` is the one definition of what the server returns to the app.
It grows one route at a time, as packages need routes. The old prose contract is `next/api/CONTRACT.md` (reference only).

- Server side: a test validates each listed route's real response against this file.
- App side: the Swift client in `app/Packages/Contract` is generated from this file at build time.
- Server changes add before they remove, so older app builds keep working.
