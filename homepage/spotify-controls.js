/* Spotify player controls (play/pause/prev/next) — only rendered on
   home.int.jaan.nexus, never on the public jaan.nexus page.

   Homepage's `customapi` widget type has no native button support, so this
   injects a floating control bar positioned over the Spotify tile, found by
   its configured href (stable across Homepage's internal CSS/class
   changes) rather than by guessing class names. Posts to the LAN-only
   spotify-control.int.jaan.nexus routes added alongside this file; see
   spotify-now-playing's README for the required Spotify OAuth scope. */
(function () {
  'use strict';
  if (location.hostname !== 'home.int.jaan.nexus') return;

  var CONTROL_BASE = 'https://spotify-control.int.jaan.nexus';
  var SPOTIFY_HREF = 'https://open.spotify.com';

  var lastCard = null;

  function findCard() {
    return document.querySelector('a[href="' + SPOTIFY_HREF + '"]');
  }

  function post(action) {
    fetch(CONTROL_BASE + '/' + action, { method: 'POST', mode: 'cors' })
      .catch(function () { /* LAN-only endpoint unreachable/offline; ignore */ });
  }

  function isPlaying(card) {
    return /Playing/.test(card.textContent || '');
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
      onClick();
    });
    return b;
  }

  function build(card) {
    var bar = document.createElement('div');
    bar.id = 'hp-spotify-controls';
    bar.setAttribute('aria-label', 'Spotify playback controls');

    var toggle = button('⏸', 'Play / pause', function () {
      post(isPlaying(card) ? 'pause' : 'play');
    });
    toggle.id = 'hp-spotify-toggle';

    bar.appendChild(button('⏮', 'Previous track', function () { post('previous'); }));
    bar.appendChild(toggle);
    bar.appendChild(button('⏭', 'Next track', function () { post('next'); }));

    document.body.appendChild(bar);
    return bar;
  }

  function position(card, bar) {
    if (!card.isConnected) return;
    var r = card.getBoundingClientRect();
    bar.style.position = 'fixed';
    bar.style.left = r.left + 'px';
    bar.style.top = r.bottom + 'px';
    bar.style.width = r.width + 'px';
    bar.style.display = r.width > 0 ? 'flex' : 'none';
  }

  function tick() {
    var card = findCard();
    var bar = document.getElementById('hp-spotify-controls');

    if (!card) {
      if (bar) bar.remove();
      lastCard = null;
      return;
    }

    if (card !== lastCard) {
      if (bar) bar.remove();
      bar = build(card);
      lastCard = card;
    }

    var toggle = document.getElementById('hp-spotify-toggle');
    if (toggle) toggle.textContent = isPlaying(card) ? '⏸' : '▶';

    position(card, bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();

  setInterval(tick, 1000);
  window.addEventListener('resize', tick);
  window.addEventListener('scroll', tick, true);
})();
