# spotify-homepage-controls

Adds play/pause/previous/next buttons to the Spotify tile on my
[Homepage](https://gethomepage.dev) dashboard, visible only when the
dashboard is viewed at `home.int.jaan.nexus` (LAN) — not on the public
`jaan.nexus` page.

Homepage's `customapi` widget (what the Spotify tile uses, via
`spotify-now-playing`) has no native button support, so the controls are a
small floating bar injected by `custom.js`, positioned over the Spotify
tile and gated on `location.hostname`.

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
