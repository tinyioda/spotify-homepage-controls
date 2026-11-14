/* Spotify player controls (play/pause/prev/next) — only rendered on
   home.int.jaan.nexus, never on the public jaan.nexus page.

   Homepage's `customapi` widget type has no native button support, so this
   injects a floating control bar into the empty space above the
   Artist/Status fields, found by live geometry (the Spotify tile's href,
   then the ARTIST/STATUS field labels) rather than guessed class names,
   since those are stable across Homepage's internal CSS/class changes and
   this page's own layout changes. Posts to the LAN-only
   spotify-control.int.jaan.nexus routes added alongside this file; see
   spotify-now-playing's README for the required Spotify OAuth scope. */
(function () {
  'use strict';
  if (location.hostname !== 'home.int.jaan.nexus') return;

  var CONTROL_BASE = 'https://spotify-control.int.jaan.nexus';
  var SPOTIFY_HREF = 'https://open.spotify.com';

  var lastHeader = null;
  var lastRoot = null;

  function findHeader() {
    return document.querySelector('a[href="' + SPOTIFY_HREF + '"]');
  }

  // Climb from the (narrow) icon/title link up to the ancestor that contains
  // the whole tile, identified by having both field labels in its text.
  function findCardRoot(header) {
    var el = header;
    for (var i = 0; i < 8 && el; i++) {
      var t = (el.textContent || '').toUpperCase();
      if (t.indexOf('STATUS') !== -1 && t.indexOf('TRACK') !== -1) return el;
      el = el.parentElement;
    }
    return header.parentElement || header;
  }

  // Finds the leaf element whose own text is exactly e.g. "ARTIST", then
  // returns its parent (the value+label block) for a usable bounding box.
  function findFieldTile(root, label) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && (el.textContent || '').trim().toUpperCase() === label) {
        return el.parentElement || el;
      }
    }
    return null;
  }

  function isPlaying(root) {
    return /Playing/.test((root && root.textContent) || '');
  }

  function flash(btn) {
    if (!btn) return;
    btn.classList.add('hp-spotify-btn-error');
    setTimeout(function () { btn.classList.remove('hp-spotify-btn-error'); }, 600);
  }

  function post(action, btn) {
    fetch(CONTROL_BASE + '/' + action, { method: 'POST', mode: 'cors' })
      .then(function (r) {
        if (!r.ok) {
          r.json().then(function (b) { console.warn('spotify control failed:', action, r.status, b.error); }).catch(function () {});
          flash(btn);
        }
      })
      .catch(function (e) {
        console.warn('spotify control unreachable:', action, e.message);
        flash(btn);
      });
  }

  function button(label, title, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'hp-spotify-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  function build() {
    var bar = document.createElement('div');
    bar.id = 'hp-spotify-controls';
    bar.setAttribute('aria-label', 'Spotify playback controls');

    var toggle = button('⏸', 'Play / pause', function (b) {
      post(isPlaying(lastRoot) ? 'pause' : 'play', b);
    });
    toggle.id = 'hp-spotify-toggle';

    bar.appendChild(button('⏮', 'Previous track', function (b) { post('previous', b); }));
    bar.appendChild(toggle);
    bar.appendChild(button('⏭', 'Next track', function (b) { post('next', b); }));

    document.body.appendChild(bar);
    return bar;
  }

  function position(bar) {
    if (!lastRoot || !lastRoot.isConnected) { bar.style.display = 'none'; return; }

    var artist = findFieldTile(lastRoot, 'ARTIST');
    var status = findFieldTile(lastRoot, 'STATUS');
    if (!artist || !status) { bar.style.display = 'none'; return; }

    var rootRect = lastRoot.getBoundingClientRect();
    var artistRect = artist.getBoundingClientRect();
    var statusRect = status.getBoundingClientRect();

    var left = artistRect.left;
    var right = statusRect.right;
    var top = rootRect.top;
    var bottom = Math.min(artistRect.top, statusRect.top);

    if (right <= left || bottom <= top) { bar.style.display = 'none'; return; }

    bar.style.display = 'flex';
    bar.style.position = 'fixed';
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
    bar.style.width = (right - left) + 'px';
    bar.style.height = (bottom - top) + 'px';
  }

  function tick() {
    var header = findHeader();
    var bar = document.getElementById('hp-spotify-controls');

    if (!header) {
      if (bar) bar.remove();
      lastHeader = null;
      lastRoot = null;
      return;
    }

    if (header !== lastHeader) {
      if (bar) bar.remove();
      lastHeader = header;
      lastRoot = findCardRoot(header);
      bar = build();
    }

    var toggle = document.getElementById('hp-spotify-toggle');
    if (toggle) toggle.textContent = isPlaying(lastRoot) ? '⏸' : '▶';

    position(bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();

  setInterval(tick, 1000);
  window.addEventListener('resize', tick);
  window.addEventListener('scroll', tick, true);
})();
