import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

function secret(name) {
  try { return readFileSync(`/run/secrets/${name}`, 'utf8').trim(); } catch {}
  return process.env[name.toUpperCase()]?.trim() || null;
}

const CLIENT_ID = secret('spotify_client_id');
const CLIENT_SECRET = secret('spotify_client_secret');
const REFRESH_TOKEN = secret('spotify_refresh_token');

// Only this origin may call the control endpoints (play/pause/next/previous).
// The /now-playing read endpoint is unrestricted, same as before.
const CONTROL_ORIGIN = process.env.CONTROL_ORIGIN || 'https://home.int.jaan.nexus';

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    console.error('token refresh failed:', t.error || r.status);
    return null;
  }
  cachedToken = { value: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function fetchNowPlaying() {
  const token = await getAccessToken();
  if (!token) return { isPlaying: false, configured: false };

  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing?additional_types=track', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 204 || r.status === 202) return { isPlaying: false, configured: true };
  if (!r.ok) return { isPlaying: false, configured: true, error: `spotify_${r.status}` };

  const data = await r.json().catch(() => null);
  if (!data || !data.item) return { isPlaying: false, configured: true };

  return {
    isPlaying: !!data.is_playing,
    configured: true,
    track: data.item.name,
    artist: (data.item.artists || []).map((a) => a.name).join(', '),
    album: data.item.album?.name || '',
    progressMs: data.progress_ms ?? 0,
    durationMs: data.item.duration_ms ?? 0,
    url: data.item.external_urls?.spotify || '',
  };
}

// method/path for the Spotify Web API player-control endpoints we proxy.
const CONTROL_ROUTES = {
  '/play': { method: 'PUT', path: '/v1/me/player/play' },
  '/pause': { method: 'PUT', path: '/v1/me/player/pause' },
  '/next': { method: 'POST', path: '/v1/me/player/next' },
  '/previous': { method: 'POST', path: '/v1/me/player/previous' },
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function callSpotify(route, token) {
  const r = await fetch(`https://api.spotify.com${route.path}`, {
    method: route.method,
    headers: { Authorization: `Bearer ${token}` },
  });
  // Docs say play/pause/next/previous return 204; observed 200 too — treat any 2xx as success.
  if (r.ok) return { ok: true };
  if (r.status === 404) return { ok: false, status: 404 };
  const err = await r.json().catch(() => ({}));
  return { ok: false, status: r.status, message: err.error?.message || '' };
}

async function runControl(pathname) {
  const route = CONTROL_ROUTES[pathname];
  const token = await getAccessToken();
  if (!token) return { status: 503, body: { ok: false, error: 'not_configured' } };

  let result = await callSpotify(route, token);
  // Spotify intermittently 403s "Restriction violated" on play/pause for
  // reasons unrelated to scope (racing the device's own state) — one quick
  // retry reliably clears it, confirmed against the live API.
  if (!result.ok && result.status === 403 && !/permission/i.test(result.message)) {
    await sleep(300);
    result = await callSpotify(route, token);
  }

  if (result.ok) return { status: 200, body: { ok: true } };
  if (result.status === 404) return { status: 409, body: { ok: false, error: 'no_active_device' } };
  // Spotify returns 401 "Permissions missing" (not 403) when the token is
  // valid but lacks user-modify-playback-state — same cause either way.
  if (result.status === 401 || /permission/i.test(result.message)) {
    return { status: 403, body: { ok: false, error: 'forbidden_scope' } };
  }
  return { status: 502, body: { ok: false, error: `spotify_${result.status}` } };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CONTROL_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }

  if (url.pathname === '/now-playing') {
    try {
      const data = await fetchNowPlaying();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    } catch (e) {
      console.error(e.message); // never log tokens or secrets
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ isPlaying: false, error: 'internal' }));
    }
    return;
  }

  if (CONTROL_ROUTES[url.pathname]) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
      return;
    }
    try {
      const { status, body } = await runControl(url.pathname);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } catch (e) {
      console.error(e.message); // never log tokens or secrets
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'internal' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
}).listen(process.env.PORT || 3000, () => console.log('spotify-now-playing listening'));
