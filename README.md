# spotify-homepage-controls

Adds play/pause/previous/next buttons to the Spotify tile on my
[Homepage](https://gethomepage.dev) dashboard, visible only when the
dashboard is viewed at `home.int.jaan.nexus` (LAN) — not on the public
`jaan.nexus` page.

Homepage's `customapi` widget (what the Spotify tile uses, via
`spotify-now-playing`) has no native button support, so the controls are a
small floating bar injected by `custom.js`, positioned over the Spotify
tile and gated on `location.hostname`.

## Problem

The Spotify tile on the Homepage dashboard used Homepage's `customapi`
widget type to show read-only now-playing info (track/artist/status) via a
small internal `spotify-now-playing` service. `customapi` has no concept of
buttons, so there was no way to play/pause/skip from the dashboard — and
none of that should be reachable from the public `jaan.nexus` page anyway,
only from home on the LAN (`home.int.jaan.nexus`).

Getting there required three separate fixes along the way, beyond just
adding the buttons:

1. **No OAuth scope for control.** The refresh token behind
   `spotify-now-playing` was minted for reading now-playing state only
   (`user-read-currently-playing`, etc.), not
   `user-modify-playback-state`, which play/pause/skip need. Re-authorizing
   with a wider scope surfaced the next bug.
2. **`auth`'s login redirect was silently broken for multi-scope requests.**
   It built the Spotify `/authorize` URL with `URLSearchParams`, which
   encodes the spaces between scopes as `+`. Spotify requires literal
   `%20` there and rejects the whole scope list as one invalid token
   (`invalid_scope`) otherwise — this would have broken *any* multi-scope
   login through this shared auth proxy, not just this one.
3. **Spotify's own API didn't match its docs.** `play`/`pause`/`next`/
   `previous` are documented as returning `204`, but returned `200` in
   practice, and the docs don't mention that `play` can intermittently
   403 with `"Restriction violated"` (unrelated to scope) right after a
   `pause` — a true scope problem returns `401`/`403` with a `Permissions
   missing`-style message instead. The service now treats any `2xx` as
   success, retries once on an ambiguous 403, and only reports
   `forbidden_scope` when the error message actually says so.

## Pieces

- `spotify-now-playing/` — the existing internal `/now-playing` JSON
  endpoint, plus new `/play`, `/pause`, `/next`, `/previous` endpoints that
  proxy to the Spotify Web API's player-control routes. Exposed LAN-only via
  Traefik (`spotify-control.int.jaan.nexus`, `lan-only@file` middleware,
  same pattern as Sonarr/Radarr/etc.), CORS-restricted to
  `https://home.int.jaan.nexus`.
- `homepage/spotify-controls.js` — finds the Spotify tile by its configured
  href (`https://open.spotify.com`), floats a play/pause/prev/next bar over
  it, only when `location.hostname === 'home.int.jaan.nexus'`.
- `homepage/spotify-controls.css` — styling for that bar.
- `deploy.ps1` — copies the above to the Docker VM (`10.10.10.10`), appends
  the JS/CSS into Homepage's live `custom.js`/`custom.css` (idempotent,
  marker-guarded), and rebuilds `spotify-now-playing`.

## Deploying a change

```powershell
.\deploy.ps1
```

Homepage serves `custom.js`/`custom.css` with `Cache-Control: no-store`
already, so edits show up on next page load with no container restart
needed. `spotify-now-playing` does need a rebuild (`deploy.ps1` does this).

## One-time setup still required

The existing Spotify refresh token (from the original `/now-playing`-only
setup) may not have the `user-modify-playback-state` scope the control
endpoints need. If `/play` returns `403 forbidden_scope`, re-authorize —
see `spotify-now-playing/README.md`.

`deploy.ps1` assumes passwordless SSH key auth to `justin@10.10.10.10` is
already set up (it is, on this machine) and must be run from PowerShell,
not Git Bash — see the comment at the top of the script.

## Secrets

No client secret, refresh token, or access token is ever written into this
repo. They live only in `/opt/stacks/{auth,spotify-now-playing}/secrets/`
on the Docker VM (`.gitignore`d, Docker secrets, 600 permissions) and are
deployed by copying the token value directly over SSH into that file —
never through a local file or a git commit.
