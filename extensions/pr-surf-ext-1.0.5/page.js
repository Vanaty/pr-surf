// The page script: it goes into the site shown in the window of the extension (sw.js) and reports every second whether the page is
// seen, its title, the answer of the server (an error page counts as not shown), and its main video — the largest — with whether it
// plays and where it is, and whether an advertisement plays in its place (YouTube marks its player .ad-showing). A video that does not
// play is started, as a person would start it; a page is scrolled slowly at the pace of reading. Nothing else of the page is touched.
(() => {
  if (window.__prsSurf) return;
  const S = (window.__prsSurf = { timer: 0, scroll: 0, opts: null, lastPlay: 0, lastStart: 0 });
  function mainVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(), a = Math.max(0, r.width) * Math.max(0, r.height); if (a > area) { area = a; best = v; } }
    return best;
  }
  // A video that cannot play: its own error, or YouTube's screen of a video that is gone (deleted, private, restricted): the watch page
  // of the computer marks itself player-unavailable, m.youtube.com lays an error over the player. Checked on the live YouTube, 25.10.2026.
  const GONE = 'ytd-watch-flexy[player-unavailable], .ytp-error, .player-error-overlay, .error-screen-interstitial';
  function gone(v) {
    if (v && v.error) return true;
    for (const el of document.querySelectorAll(GONE)) { const r = el.getBoundingClientRect(); if (r.width > 40 && r.height > 40 && getComputedStyle(el).visibility !== 'hidden') return true; }
    return false;
  }
  function play(v) {
    if (Date.now() - S.lastPlay < 3000) return;
    S.lastPlay = Date.now();
    try { const p = v.play(); if (p && p.catch) p.catch(() => { try { v.muted = true; v.play().catch(() => {}); } catch (e) { /* the page does not let it */ } }); } catch (e) { /* no */ }
  }
  // A video shorter than its seconds starts over at its end, as a person watches a short one again: at once, since YouTube on a computer
  // moves on to its next video a few seconds after the end. One with its own loop (YouTube's Shorts) needs nothing.
  function restart(v) {
    if (Date.now() - S.lastStart < 2000) return;
    S.lastStart = Date.now(); S.lastPlay = 0;
    try { v.currentTime = 0; } catch (e) { /* the page does not let it */ }
    play(v);
  }
  function tick() {
    // the extension started again (an update, a reload): this script is left without it and stops, the next site brings a new one
    if (!chrome.runtime || !chrome.runtime.id) { clearInterval(S.timer); clearTimeout(S.scroll); return; }
    const v = mainVideo(), nav = (performance.getEntriesByType('navigation') || [])[0];
    if (v && S.opts.kind === 'video') {
      const atEnd = v.ended || (v.paused && isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.25);
      if (atEnd && !v.loop) restart(v); else if (v.paused) play(v);
    }
    chrome.runtime.sendMessage({ type: 'tick', seq: S.opts.seq, vis: document.visibilityState === 'visible', title: String(document.title || '').slice(0, 120),
      status: (nav && nav.responseStatus) || 0, cf: /^Just a moment/i.test(document.title || ''), x: S.opts.kind === 'video' && gone(v) ? 1 : 0, h: String(location.href).slice(0, 300),
      v: v ? { p: !!v.paused, ct: v.currentTime || 0, d: isFinite(v.duration) ? v.duration : 0, l: !!v.loop, e: !!v.ended, ad: !!document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay') } : null }).catch(() => {});
  }
  // reading: a few hundred pixels every few seconds, back up a little at the end
  function scrollStep() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    const el = document.scrollingElement || document.documentElement, h = el.scrollHeight, vh = window.innerHeight, y = window.scrollY;
    if (h > vh + 40) window.scrollBy({ top: y + vh >= h - 60 ? -(300 + Math.random() * 400) : 180 + Math.random() * Math.max(20, vh * 0.8 - 180), behavior: 'smooth' });
    S.scroll = setTimeout(scrollStep, 2500 + Math.random() * 3500);
  }
  S.start = (o) => {
    S.opts = o; clearInterval(S.timer); clearTimeout(S.scroll);
    S.timer = setInterval(tick, 1000); tick();
    if (o.scroll && o.kind !== 'video') S.scroll = setTimeout(scrollStep, 2500);
  };
})();
