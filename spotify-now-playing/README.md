# spotify-now-playing

Tiny, database-less JSON endpoint that exposes what's currently playing on
Spotify, for the Homepage dashboard's `customapi` widget — plus player
control endpoints used by the buttons injected on `home.int.jaan.nexus`.

- `GET /now-playing` — internal only: reachable as
  `http://spotify-now-playing-spotify-now-playing-1:3000/now-playing` on the
  shared `proxy` docker network. No Traefik route, never exposed to the LAN
  or internet. Returns
  `{ isPlaying, configured, track, artist, album, progressMs, durationMs, url }`
  (or `{ isPlaying: false }` when nothing is playing or the service isn't
  configured).
- `POST /play`, `/pause`, `/next`, `/previous` — exposed LAN-only via Traefik
  at `https://spotify-control.int.jaan.nexus/<action>` (`lan-only@file`
  middleware, same pattern as Sonarr/Radarr/etc). Responses are
  CORS-restricted to the `CONTROL_ORIGIN` env var (default
  `https://home.int.jaan.nexus`), so only script running on that page can
  read the response — the LAN middleware is what actually keeps the routes
  from being reachable off the LAN.
- Uses the refresh token captured once via [auth](../auth)'s `/spotify/callback`
  flow (`auth.int.jaan.nexus/spotify/login`). Client id/secret/refresh token are
  copied into this stack's own `secrets/` (git-ignored, Docker secrets, read-only
  mount).
- Node 22, zero npm dependencies, runs as non-root, read-only filesystem, all
  capabilities dropped.

## Required Spotify scopes

The control endpoints need `user-modify-playback-state` in addition to
whatever was granted before. If the current refresh token doesn't have it,
calls to `/play` etc. return `403 forbidden_scope` — re-authorize (see
below) with:

```
https://auth.int.jaan.nexus/spotify/login?scope=user-read-currently-playing%20user-read-playback-state%20user-modify-playback-state
```

## Run

```sh
cp ../auth/secrets/spotify_client_id secrets/
cp ../auth/secrets/spotify_client_secret secrets/
cp ../auth/secrets/spotify_refresh_token secrets/
chmod 600 secrets/*
docker compose up -d --build
```

## Re-authorizing

If the refresh token is ever revoked, or the control endpoints need a wider
scope, repeat the flow at `https://auth.int.jaan.nexus/spotify/login` (see
scope query above), copy the new refresh token into
`secrets/spotify_refresh_token`, and `docker compose up -d --build` again.

Controls only work while Spotify has an *active device* (something open and
selected on some device) — `/play`/`/pause`/`/next`/`/previous` return
`409 no_active_device` otherwise, same as the official Spotify API behavior.
