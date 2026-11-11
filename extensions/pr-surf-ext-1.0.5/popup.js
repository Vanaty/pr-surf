// The popup. Not connected: the code, one click on the site, why the site refused it when it did. Connected: today's money with the
// bars of the week, the key that opens the window of the sites (and, while they go, what happens now with the keys that act on it),
// what stops the work when something does (a blocked browser, a restricted account, an old version, surfing closed), the statistics,
// the limits, the last sites with the reason of each one that did not count, the admin's message. It draws what the engine (sw.js)
// keeps in chrome.storage and asks it by messages; it is drawn again when the storage changes. Whatever holds the sites (no internet,
// pr.social busy, the window closed, minimised or covered, the screen locked, "are you there?" not answered) is said in plain words with
// the one key that acts on it, and when the next try comes.
import { ready, t, tb, tn, ltr, piece, isRtl, langOf } from './words.js';
import { VERSION_CODE, SITE_BASE } from './config.js';

const $app = document.getElementById('app');
const send = (m) => chrome.runtime.sendMessage(m).catch(() => ({ ok: false, code: 'NO_WORKER' }));
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a sum is one left-to-right piece, its sign with it: a right-to-left page never shows "$0.12+". As the site's Tools shows it (tm4): four
// places under a dollar, so every site counted moves the figure ($0.0412, not $0.04); two from a dollar up
const money = (usd, sign) => { const v = Number(usd) || 0; return ltr((sign || '') + (v >= 1 ? '$' + v.toFixed(2) : v >= 0.00005 ? '$' + v.toFixed(4) : v > 0 ? '<$0.0001' : '$0')); };
// the digits of the money are Latin in every language: the other numbers keep them too
const lc = () => langOf() + '-u-nu-latn';
const clock = (ms) => piece(new Date(ms).toLocaleTimeString(lc(), { hour: '2-digit', minute: '2-digit' }));
const num = (n) => new Intl.NumberFormat(lc()).format(n);
const dur = (s) => (s >= 3600 ? t('dur.hm', { h: Math.floor(s / 3600), m: String(Math.floor((s % 3600) / 60)).padStart(2, '0') }) : s >= 60 ? t('dur.ms', { m: Math.floor(s / 60), s: s % 60 }) : t('dur.s', { s }));
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
let S = {}, open = null, askedAt = 0, note = '', noteT = 0, tickT = 0, asking = false;
let skipAsk = false, skipWhy = ''; // Skip pressed: the question with its reasons, in place of the keys

async function read() {
  S = await chrome.storage.local.get(['key', 'user', 'pairing', 'ui', 'journal', 'config', 'running', 'msgSeen']);
  draw();
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local') read(); });

/* ---------------- parts ---------------- */
const key = (a, words, cls, extra) => '<button class="key ' + (cls || '') + '" data-a="' + a + '"' + (extra || '') + '><span>' + words + '</span></button>';
const play = '<svg viewBox="0 0 24 24" class="gl"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const pause = '<svg viewBox="0 0 24 24" class="gl"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
const stop = '<svg viewBox="0 0 24 24" class="gl"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>';
const skip = '<svg viewBox="0 0 24 24" class="gl"><path d="M6 6.5v11l8-5.5z"/><rect x="15.5" y="6.5" width="2.6" height="11" rx="1"/></svg>';
const REASONS = ['open', 'video', 'adult', 'scam', 'other'];
const chev = '<svg viewBox="0 0 8 14" class="chev"><path d="M1 1l6 6-6 6"/></svg>';
const line = (title, value, cls) => '<div class="ln' + (cls ? ' ' + cls : '') + '"><b>' + title + '</b><span class="v">' + value + '</span></div>';
function head() {
  return '<div class="hd"><img class="mk" src="icons/128.png" alt=""><div class="sp"><b>PR Surf</b>' + (S.user ? '<small><bdi>@' + esc(S.user) + '</bdi></small>' : '') + '</div></div>';
}

/* ---------------- not connected ---------------- */
function connectView() {
  const p = S.pairing || {}, off = S.ui && S.ui.why === 'off';
  let h = head();
  if (off) h += '<div class="sheet pad"><b class="warn">' + t('ext.off') + '</b><p>' + t('ext.off.sub') + '</p></div>';
  h += '<div><h1>' + t('ext.connect.title') + '</h1><p class="lead">' + t('ext.connect.sub') + '</p></div>';
  if (p.code) {
    const left = Math.max(0, Math.round((p.until - Date.now()) / 1000));
    h += '<div class="sheet pad"><div class="code" title="' + esc(t('connect.copy')) + '" data-a="copy">'
      + p.code.slice(0, 4).split('').map((c) => '<i>' + c + '</i>').join('') + '<em></em>' + p.code.slice(4).split('').map((c) => '<i>' + c + '</i>').join('') + '</div>'
      + '<div class="bar"><i style="width:' + Math.round(left / 6) + '%"></i></div>'
      + '<p class="small">' + t('ext.connect.wait', { time: Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') }) + '</p>'
      + (p.refused ? '<div class="rule"></div><b class="bad">' + t('ext.connect.refused') + '</b><p>' + esc(t({ NOT_ENOUGH_TASKS: 'ext.connect.no.tasks', TOO_MANY_DEVICES: 'ext.connect.no.devices',
        DEVICE_NOT_ALLOWED: 'ext.connect.no.device', RESTRICTED: 'ext.connect.no.restricted', DEVICE_BLOCKED: 'ext.gate.blocked.sub' }[p.refused] || 'ext.connect.no.off', { need: p.need, max: p.max })) + '</p>' : '')
      + '</div>' + key('open', t('ext.connect.go'), 'primary') + key('pair', t('connect.new'));
  } else {
    if (p.over) h += '<div class="sheet pad"><b class="warn">' + t('connect.expired') + '</b><p>' + t('connect.expired.sub') + '</p></div>';
    if (p.err) h += '<div class="sheet pad"><b class="bad">' + t('connect.fail') + '</b><p>' + (p.err === 'TOO_OFTEN' ? t('connect.fail.often', { min: Math.max(1, Math.ceil((p.wait || 60) / 60)) })
      : p.err === 'BUSY' ? t('connect.fail.busy') : t('ext.connect.fail')) + '</p></div>';
    h += key('pair', t('ext.connect.go'), 'primary');
  }
  return h + '<p class="small">' + t('connect.path') + '</p>';
}

/* ---------------- connected ---------------- */
function weekBars(today, days) {
  const day = today.day || utcDay(Date.now()), base = Date.parse(day + 'T00:00:00Z'), vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base - i * 86400000).toISOString().slice(0, 10);
    vals.push(i === 0 ? Number(today.earned) || 0 : Number(((days || []).find((x) => x.day === d) || {}).earned) || 0);
  }
  const top = Math.max(...vals) || 1, wd = new Intl.DateTimeFormat(lc(), { weekday: 'narrow', timeZone: 'UTC' });
  return '<div class="week" aria-hidden="true"><div class="bars">' + vals.map((v, i) => '<i class="' + (i === 6 ? 'now' : '') + '" style="height:' + Math.max(6, Math.round(v / top * 100)) + '%"></i>').join('')
    + '</div><div class="days">' + vals.map((v, i) => '<span class="' + (i === 6 ? 'now' : '') + '">' + wd.format(new Date(base - (6 - i) * 86400000)) + '</span>').join('') + '</div></div>';
}

function gateCard(gate, cfg) {
  if (gate === 'blocked' || gate === 'restricted') return '<div class="sheet pad"><b class="bad big2">' + t(gate === 'blocked' ? 'ext.gate.blocked' : 'gate.restricted') + '</b><p>'
    + t(gate === 'blocked' ? 'ext.gate.blocked.sub' : 'gate.restricted.sub') + '</p></div>' + key('support', t('gate.support'), 'primary') + key('again', t('gate.again'));
  if (gate === 'update') return '<div class="sheet pad"><b class="warn big2">' + t('ext.gate.update') + '</b><p>' + t('ext.gate.update.sub') + '</p></div>'
    + (cfg.latest && cfg.latest.url ? key('store', t('ext.gate.update.do'), 'primary') : '');
  return '<div class="sheet pad"><b class="big2">' + t('gate.closed') + '</b><p>' + t('ext.gate.closed.sub') + '</p></div>' + key('again', t('gate.now'));
}

// what happens now, said in a few words, and the keys that act on it
function nowCard(u) {
  const ph = u.phase || 'idle';
  const stopKey = key('stop', stop + t('show.stop'), 'dark');
  const left = Math.max(0, Math.round(((u.until || 0) - Date.now()) / 1000));
  if (ph === 'check' && left > 0) {
    return '<div class="sheet pad loud"><img class="mk lg" src="icons/128.png" alt=""><b class="big2">' + t('check.title') + '</b><p>' + tb('check.sub') + '</p><p class="small">'
      + t('check.left', { time: Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') }) + '</p></div>' + key('answer', t('check.yes'), 'primary tall');
  }
  // "are you there?" not answered in its time: the sites wait for Continue (the site still takes the answer)
  if (ph === 'check' || (ph === 'paused' && u.why === 'check_missed')) {
    return '<div class="sheet pad st"><i class="dot wait"></i><div class="tx"><b>' + t('pause.check_missed') + '</b><p>' + tb('pause.check_missed.sub') + '</p></div></div><div class="row">'
      + key('answer', play + t('show.resume'), 'primary') + stopKey + '</div>';
  }
  // Skip: asked first (a site skipped is not counted and never comes back to the person); a reason may be chosen, none is needed
  if (ph === 'showing' && skipAsk) {
    const chips = REASONS.map((w) => '<button class="chip' + (skipWhy === w ? ' on' : '') + '" data-a="skipwhy" data-w="' + w + '" aria-pressed="' + (skipWhy === w) + '">' + t('skip.r.' + w) + '</button>').join('');
    return '<div class="sheet pad"><b class="big2">' + t('skip.title') + '</b><p>' + t('skip.sub') + '</p><p class="small why">' + t('skip.why') + '</p><div class="chips">' + chips + '</div></div>'
      + '<div class="row">' + key('skipno', t('skip.no'), 'dark') + key('skipyes', skip + t('skip.yes'), 'primary') + '</div>';
  }
  if (ph !== 'showing') skipAsk = false;
  let title = '', sub = '', dot = 'go', keys = '';
  if (ph === 'showing') {
    title = u.loading ? t('show.loading', { domain: esc(u.domain) }) : '<em class="kind">' + t('show.kind.' + (u.kind || 'site')) + '</em> ' + esc(u.domain);
    sub = u.loading ? '' : '<div class="bar"><i style="width:' + Math.min(100, Math.round((u.a || 0) / Math.max(1, u.b || 1) * 100)) + '%"></i></div><div class="meta"><span>'
      + t('show.sec', { a: u.a || 0, b: u.b || 0 }) + '</span><span>' + t('show.place', { a: u.i || 1, b: u.n || 1 }) + '</span></div>';
    keys = key('pause', pause + t('show.pause'), 'dark') + stopKey + '</div><div class="row">' + key('skip', skip + t('show.skip'), 'ghost');
  } else if (ph === 'asking' || ph === 'gap') {
    title = t(ph === 'gap' ? 'show.next' : 'show.asking'); keys = key('pause', pause + t('show.pause'), 'dark') + stopKey;
  } else if (ph === 'waiting') {
    const w = u.why || 'empty';
    // no internet: said without a time (the extension looks every few seconds and goes on the moment it is back)
    if (w === 'offline') { title = t('pause.no_internet'); sub = '<p>' + t('ext.wait.offline.sub') + '</p>'; }
    else { title = t('wait.' + w); sub = '<p>' + tb('wait.' + w + '.sub', { time: clock(u.until || Date.now()) }) + '</p>'; }
    dot = 'wait';
    keys = (w === 'hour' || w === 'day' ? '' : key('nudge', t('wait.now'), 'dark', Date.now() - askedAt < 20000 ? ' disabled' : '')) + stopKey;
  } else if (ph === 'paused') {
    // the person's own pause (Continue), the window (Show the window: minimised, under other windows, or closed), the screen locked
    const w = u.why || 'person', app = w === 'person';
    title = t((app ? 'pause.' : 'ext.pause.') + w); sub = '<p>' + tb((app ? 'pause.' : 'ext.pause.') + w + '.sub') + '</p>'; dot = 'wait';
    keys = (app ? key('resume', play + t('show.resume'), 'primary') : ['hidden', 'covered', 'closed'].includes(w) ? key('focus', t('ext.show.window'), 'primary') : '') + stopKey;
  }
  return '<div class="sheet pad st"><i class="dot ' + dot + '"></i><div class="tx"><b>' + title + '</b>' + sub + '</div></div><div class="row">' + keys + '</div>';
}

function startCard(u) {
  return (u.why === 'restart' ? '<p class="small warn">' + t('ext.stopped.restart') + '</p>' : '')
    + '<button class="start" data-a="start" aria-label="' + esc(t('home.start')) + '"><span class="face">' + play + '<b>' + t('home.start') + '</b></span></button><p class="small">' + t('ext.start.hint') + '</p>';
}

function statsSheet(cfg, u, today) {
  const st = cfg.stats || {}, before = u.before || st.before || { visits: 0, earned: 0 }, month = st.month || { visits: 0, earned: 0 };
  const j = (S.journal || []).filter((e) => utcDay(e.at) === (today.day || utcDay(Date.now())));
  const failed = j.filter((e) => e.v && e.v !== 'OK').length, shown = j.filter((e) => e.v === 'OK').reduce((a, e) => a + (e.s || 0), 0);
  const week = { visits: (before.visits || 0) + (today.visits || 0), earned: (Number(before.earned) || 0) + (Number(today.earned) || 0) };
  let h = '<h2>' + t('stats.title') + '</h2><div class="sheet">'
    + line(t('stats.counted'), tn('sites', today.visits || 0))
    + line(t('stats.failed'), '<span class="' + (failed ? 'warn' : 'q') + '">' + num(failed) + '</span>')
    + line(t('stats.time'), dur(shown))
    + line(t('stats.week'), money(week.earned) + ' · ' + tn('sites', week.visits))
    + line(t('stats.month'), money(month.earned) + ' · ' + tn('sites', month.visits || 0)) + '</div>';
  const L = st.limits;
  if (L && L.hour && L.day && L.hour.cap > 0 && L.day.cap > 0) {
    const lim = (title, hint, x) => { const f = Math.min(1, x.used / x.cap);
      return '<div class="lim"><div class="lt"><div><b>' + title + '</b><small>' + hint + '</small></div><span class="v ' + (f >= 1 ? 'bad' : f >= 0.85 ? 'warn' : '') + '">'
        + t('limits.of', { a: num(x.used), b: num(x.cap) }) + '</span></div><div class="bar thick"><i style="width:' + Math.round(f * 100) + '%"></i></div></div>'; };
    h += '<h2>' + t('limits.title') + '</h2><div class="sheet">' + lim(t('limits.hour'), t('ext.limits.hour.hint'), L.hour) + lim(t('limits.day'), t('limits.day.hint'), L.day) + '</div>';
  }
  return h;
}

function journal() {
  const j = (S.journal || []).slice(0, 8);
  if (!j.length) return '';
  return '<h2>' + t('ext.journal') + '</h2><div class="sheet">' + j.map((e) => {
    const failed = e.v && e.v !== 'OK', why = failed ? tb('why.' + e.v) : '';
    const verdict = e.v === 'OK' ? '<span class="ok">' + money(e.e, '+') + '</span>' : !e.v ? '<span class="q">' + t('journal.wait') + '</span>'
      : '<span class="' + (['SHORT', 'VIDEO_SHORT', 'EARLY', 'NOT_SHOWN'].includes(e.v) ? 'warn' : 'bad') + '">' + esc(t('v.' + e.v).startsWith('v.') ? t('v.OTHER') : t('v.' + e.v)) + '</span>' + chev;
    return '<div class="jr' + (failed ? ' can' : '') + (open === e.t ? ' open' : '') + '"' + (failed ? ' data-a="why" data-t="' + esc(e.t) + '"' : '') + '><div class="jl"><div><b>' + esc(e.d) + '</b><small>'
      + t('show.kind.' + (e.k || 'site')) + ' · ' + t('unit.sec', { n: e.s }) + ' · ' + clock(e.at) + '</small></div>' + verdict + '</div>'
      + (failed && open === e.t ? '<p class="why">' + esc(why.startsWith('why.') ? t('why.OTHER') : why) + '</p>' : '') + '</div>';
  }).join('') + '</div>';
}

function mainView() {
  const u = S.ui || {}, cfg = S.config || {}, today = u.today || (cfg.stats && cfg.stats.today) || { visits: 0, earned: 0 };
  let h = head();
  const msg = cfg.msg;
  if (msg && msg.id !== S.msgSeen) {
    const text = langOf() === 'ru' ? msg.ru : msg.en;
    // the message is English or Russian: it keeps its own direction in a right-to-left popup (its full stop stays at its end)
    if (text) h += '<div class="msg"><p dir="auto">' + esc(text) + '</p><button data-a="msg" aria-label="' + esc(t('common.close')) + '">✕</button></div>';
  }
  // a newer version is out (Admin → Surfing App → Versions, the newest one): offered, this one keeps working; the least version, which
  // stops this one, is the gate below instead (the owner, 25.10.2026: an update forced or only offered)
  const lt = cfg.latest;
  if (lt && Number(lt.version) > VERSION_CODE && lt.url && !(Number(cfg.min_version) > VERSION_CODE))
    h += '<div class="msg upd"><p>' + t('ext.update.ready') + '</p>' + key('store', t('ext.gate.update.do'), 'small') + '</div>';
  h += '<div class="money"><div><div class="ey">' + t('home.today') + '</div><div class="big">' + money(today.earned) + '</div></div>' + weekBars(today, cfg.stats && cfg.stats.days) + '</div>';
  const gate = u.gate || null, running = !!S.running;
  // pr.social could not be asked when the popup opened: the numbers are the last ones it gave
  if (!running && !gate && u.net) h += '<p class="small warn">' + t('ext.net.stale') + '</p>';
  if (gate) h += gateCard(gate, cfg);
  else h += running ? nowCard(u) : startCard(u);
  // the sites went on by themselves after Chrome or the extension started again: said for two minutes
  if (running && u.note === 'resumed' && Date.now() - (u.noteAt || 0) < 120000) h += '<p class="small">' + t('show.resumed') + '</p>';
  h += statsSheet(cfg, u, today) + journal() + '<p class="small">' + t('ext.money') + '</p>';
  return h + '<div class="ft"><span>' + ltr('v' + esc(chrome.runtime.getManifest().version) + ' (' + VERSION_CODE + ')') + '</span>' + (S.key ? '<button data-a="disconnect">' + t('settings.disconnect.short') + '</button>' : '') + '</div>'
    + (note ? '<div class="toast">' + esc(note) + '</div>' : '');
}

function draw() {
  $app.innerHTML = S.key ? mainView() : connectView();
  clearTimeout(tickT);
  // the countdown of a code (and the question to the site while the popup is open), and the clock of "are you there?"
  if (!S.key && S.pairing && S.pairing.code) tickT = setTimeout(() => { send({ type: 'poll' }); draw(); }, 1000);
  else if (S.key && S.ui && S.ui.phase === 'check' && (S.ui.until || 0) > Date.now() - 2000) tickT = setTimeout(draw, 1000);
  else if (S.key && Date.now() - askedAt < 21000) tickT = setTimeout(draw, 1000);
}
function say(text) { note = text; clearTimeout(noteT); noteT = setTimeout(() => { note = ''; draw(); }, 2600); draw(); }

$app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled || asking) return;
  const a = b.dataset.a;
  if (a === 'pair') { asking = true; b.disabled = true; const r = await send({ type: 'pair' }); asking = false; if (r && r.ok && r.pairing) chrome.tabs.create({ url: r.pairing.link }); read(); }
  else if (a === 'open') { if (S.pairing && S.pairing.link) chrome.tabs.create({ url: S.pairing.link }); }
  else if (a === 'copy') { try { await navigator.clipboard.writeText(S.pairing.code); say(t('toast.copied')); } catch (x) { /* not allowed */ } }
  else if (a === 'start') {
    // the one permission the work needs, asked at the moment it is needed (Chrome asks only from a click of the person)
    const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    if (!ok) { say(t('ext.perm.why')); return; }
    b.disabled = true; await send({ type: 'start' });
  }
  else if (a === 'skip') { skipAsk = true; skipWhy = ''; draw(); return; }
  else if (a === 'skipwhy') { skipWhy = skipWhy === b.dataset.w ? '' : b.dataset.w; draw(); return; }
  else if (a === 'skipno') { skipAsk = false; draw(); return; }
  else if (a === 'skipyes') { skipAsk = false; const r = await send({ type: 'skip', why: skipWhy }); if (r && r.ok) say(t('skip.done')); }
  else if (a === 'stop') await send({ type: 'stop' });
  else if (a === 'pause') await send({ type: 'pause' });
  else if (a === 'resume') await send({ type: 'resume' });
  else if (a === 'focus') await send({ type: 'focus' });
  else if (a === 'nudge') { askedAt = Date.now(); await send({ type: 'nudge' }); }
  else if (a === 'answer') await send({ type: 'answer' });
  else if (a === 'msg') await send({ type: 'msg-closed' });
  else if (a === 'support') chrome.tabs.create({ url: SITE_BASE + '/support' });
  else if (a === 'store') { const c = S.config || {}; if (c.latest && c.latest.url) chrome.tabs.create({ url: c.latest.url }); }
  else if (a === 'again') { asking = true; const r = await send({ type: 'again' }); asking = false; say(r && r.ok ? (r.gate ? t('toast.still.' + r.gate) : t('toast.ok.again')) : t('toast.offline')); }
  else if (a === 'why') { open = open === b.dataset.t ? null : b.dataset.t; draw(); return; }
  else if (a === 'disconnect') { if (confirm(t('ext.disconnect.ask', { user: S.user || '' }))) await send({ type: 'disconnect' }); }
  read();
});

// While the popup is open and the sites do not go, the site is asked again every idle_sec (config.show; a minute until the site says):
// a browser disconnected, blocked or restricted on pr.social, or surfing open again, shows at once.
const idleSec = () => { const v = Number(((S.config || {}).show || {}).idle_sec); return v > 0 ? Math.min(3600, Math.max(30, Math.round(v))) : 60; };
function idleAsk() { setTimeout(() => { if (S.key && !S.running) send({ type: 'config' }); idleAsk(); }, idleSec() * 1000); }

(async () => {
  await ready();
  document.documentElement.lang = langOf();
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  await read();
  // the site's settings and today's numbers, fresh each time the popup opens
  if (S.key) send({ type: 'config' });
  idleAsk();
})();
