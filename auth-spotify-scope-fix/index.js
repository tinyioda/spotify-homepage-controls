import { randomBytes, timingSafeEqual } from 'node:crypto';
import { secret, esc, page, cookies } from '../../lib.js';

// Hosts this site may be served on (login + callback must use the same host so the state cookie matches).
const HOSTS = (process.env.ALLOWED_HOSTS || 'auth.jaan.nexus,auth.int.jaan.nexus').split(',');

// Register this exact URL as the Redirect URI in the Spotify developer dashboard.
// Routes: GET /spotify/  GET /spotify/login?scope=a%20b  GET /spotify/callback
export default async function spotify(req, url, res) {
  const host = (req.headers.host || '').toLowerCase();
  if (!HOSTS.includes(host)) return page('Bad host', '', 400);
  const REDIRECT_URI = `https://${host}/spotify/callback`;
  const id = secret('spotify_client_id');
  const clientSecret = secret('spotify_client_secret');
  const path = url.pathname.replace(/\/$/, '');

  if (path === '/spotify') {
    return page('Spotify', `<p>Redirect URI: <code>${esc(REDIRECT_URI)}</code></p>
      <p>Configured: ${id && clientSecret ? 'yes' : 'no (missing client id/secret)'}</p>
      <p><a href="/spotify/login">Start login</a> (optional <code>?scope=user-read-private</code>)</p>`);
  }

  if (!id || !clientSecret) return page('Spotify not configured', '<p>Missing secrets.</p>', 500);

  if (path === '/spotify/login') {
    const state = randomBytes(16).toString('hex');
    const q = new URLSearchParams({
      response_type: 'code', client_id: id, redirect_uri: REDIRECT_URI, state,
      ...(url.searchParams.get('scope') && { scope: url.searchParams.get('scope') }),
    });
    res.setHeader('Set-Cookie', `spotify_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/spotify; Max-Age=600`);
    // URLSearchParams encodes spaces as "+"; Spotify's /authorize requires
    // scopes space-separated as literal %20, so fix that up before redirecting.
    const qs = q.toString().replace(/\+/g, '%20');
    res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${qs}` });
    res.end();
    return null;
  }

  if (path === '/spotify/callback') {
    const err = url.searchParams.get('error');
    if (err) return page('Spotify denied', `<p><code>${esc(err)}</code></p>`, 400);

    const state = url.searchParams.get('state') || '';
    const expected = cookies(req).spotify_state || '';
    if (!state || state.length !== expected.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return page('Invalid state', '<p>State mismatch. Start again from <a href="/spotify/login">login</a>.</p>', 400);
    }
    const code = url.searchParams.get('code');
    if (!code) return page('Missing code', '<p>No code returned.</p>', 400);

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${id}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) return page('Token exchange failed', `<p><code>${esc(t.error_description || t.error || r.status)}</code></p>`, 502);

    // Nothing is stored. Tokens are shown once; copy the refresh token into the consuming app.
    res.setHeader('Set-Cookie', 'spotify_state=; HttpOnly; Secure; SameSite=Lax; Path=/spotify; Max-Age=0');
    res.setHeader('Cache-Control', 'no-store');
    return page('Spotify authorized', `<p>Shown once, not stored. Copy now.</p>
      <p>Refresh token:</p><pre>${esc(t.refresh_token)}</pre>
      <p>Access token (expires in ${esc(t.expires_in)}s):</p><pre>${esc(t.access_token)}</pre>
      <p>Scope: <code>${esc(t.scope)}</code></p>`);
  }

  return page('Not found', '', 404);
}
