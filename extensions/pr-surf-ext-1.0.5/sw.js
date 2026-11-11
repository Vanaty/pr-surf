// The engine of the extension (Manifest V3 service worker): the same work as the Android app's engine, in the person's own Chrome.
// It asks the site for a pack of sites, shows them one after another in a window of its own (one tab), counts the seconds each page was
// on the screen (and the seconds its video really played, without an advertisement) from what the page script reports every second,
// and sends what it showed with the request of the next pack. Chrome may put this worker to sleep between events: everything it needs
// to go on lives in chrome.storage, and an alarm wakes it for a wait longer than half a minute. A pack cut short (the window was closed,
// minimised, the screen locked) is reported as it is; a report the site did not get waits in storage and goes first next time.
// It looks after itself: a site that does not answer is asked again after pauses that grow (a few minutes at most), no internet is
// waited out without asking, a tab whose page crashed or hung is made new, a loop that went quiet is started again by a watch (an alarm
// every minute), and the work goes on by itself after Chrome or the extension started again. What it caught and got over is kept and
// told to the site between packs.
import { API_BASE, SITE_BASE, VERSION_CODE } from './config.js';
import { ready, t, tb } from './words.js';

const ORIGIN = API_BASE.replace(/\/api\/surf-app$/, '');
const STAGE = chrome.runtime.getURL('stage.html');
const store = chrome.storage.local;
const get = async (k) => (await store.get(k))[k];
const put = (o) => store.set(o);
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- how the sites are shown, as the site's settings say ---------------- */
// config.show: the sound of a video, the scrolling of a page, the seconds a page may stay silent before it counts as hung, how often an
// open popup asks the site, whether the sites go on by themselves after Chrome or the extension started again, how many sites in a row
// that did not open make the tab new. What the site does not send (an older site) keeps the extension's own default, so a new number
// there never needs a new version.
const SHOW = { mute: true, scroll: true, hung_sec: 30, idle_sec: 60, resume: true, fail_renew: 4, lowq: true };
function showOf(c) {
  const s = (c && c.show) || {}, o = Object.assign({}, SHOW);
  for (const k of ['mute', 'scroll', 'resume', 'lowq']) if (typeof s[k] === 'boolean' || s[k] === 0 || s[k] === 1) o[k] = !!s[k];
  const n = (k, lo, hi) => { const v = Number(s[k]); if (s[k] != null && s[k] !== '' && Number.isFinite(v)) o[k] = Math.min(hi, Math.max(lo, Math.round(v))); };
  n('hung_sec', 10, 120); n('idle_sec', 30, 3600); n('fail_renew', 2, 20);
  return o;
}
const show = async () => showOf(await get('config'));

/* ---------------- the site's API ---------------- */
// A request waits 25 seconds at most: Chrome stops a worker that waits longer than 30 seconds for an answer, and a site that answers
// that slowly is busy anyway.
const CALL_MS = 25000;
async function call(method, path, body) {
  const key = await get('key');
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), CALL_MS);
  try {
    const r = await fetch(API_BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Surf-Client': 'ext/' + VERSION_CODE }, key ? { Authorization: 'Bearer ' + key } : {}),
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ac.signal });
    const text = await r.text(); // an answer that trickles in is cut by the same 25 seconds
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!j || typeof j !== 'object') j = null;
    const ok = r.ok && !!j;
    // the site's own code, or what the answer says itself: too many requests (BUSY), the site's trouble or an answer that is not the
    // site's (SERVER), a refusal (REFUSED)
    return { ok, status: r.status, code: (j && j.code) || (ok ? '' : r.status === 429 ? 'BUSY' : r.status >= 500 || r.ok ? 'SERVER' : 'REFUSED'), body: j };
  } catch (e) {
    // no answer at all: the browser has no network (OFFLINE), the site took too long (TIMEOUT), or no connection to it (NETWORK)
    return { ok: false, status: 0, code: !navigator.onLine ? 'OFFLINE' : ac.signal.aborted ? 'TIMEOUT' : 'NETWORK', body: null };
  } finally { clearTimeout(timer); }
}
const absolute = (url) => (String(url).startsWith('/') ? ORIGIN + url : url);
// what a request that failed makes the person wait for: no internet, no connection to the site, or the site busy (too many requests,
// its trouble, no answer in time)
const whyOf = (code) => (code === 'OFFLINE' ? 'offline' : code === 'NETWORK' ? 'network' : 'busy');

/* ---------------- this browser ---------------- */
async function install() {
  let id = await get('install');
  if (!id) { id = crypto.randomUUID().replace(/-/g, ''); await put({ install: id }); }
  return id;
}
// What the extension tells the site of the browser; the signs of automation are judged by the site (a program that runs Chrome sets
// navigator.webdriver; a headless Chrome names itself).
async function device() {
  const ua = navigator.userAgent || '', d = navigator.userAgentData;
  const brand = d && d.brands ? (d.brands.find((b) => /Edge|Opera|Yandex|YaBrowser|Brave|Vivaldi/i.test(b.brand)) || d.brands.find((b) => /Chrome|Chromium/i.test(b.brand)) || {}) : {};
  const os = osOf();
  const emu = [];
  if (navigator.webdriver) emu.push('webdriver');
  if (/HeadlessChrome/.test(ua)) emu.push('headless');
  return { kind: 'browser', install: await install(), maker: '', model: ((brand.brand || 'Chrome') + ' ' + (brand.version || '')).trim() + (os ? ' · ' + os : ''), os, version: VERSION_CODE,
    signals: { emu, root: [], sig: chrome.runtime.id, debug: !('update_url' in chrome.runtime.getManifest()) } };
}
function osOf() {
  const ua = navigator.userAgent || '', d = navigator.userAgentData;
  return (d && d.platform) || (/Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '');
}
// The browser with its whole version and the system, as a fault is told to the site ("Chrome 141.0.7390.54 · macOS")
async function modelOf() {
  const d = navigator.userAgentData;
  let list = (d && d.brands) || [];
  try { const h = await d.getHighEntropyValues(['fullVersionList']); if (h.fullVersionList && h.fullVersionList.length) list = h.fullVersionList; } catch (e) { /* the short version */ }
  const b = list.find((x) => /Edge|Opera|Yandex|YaBrowser|Brave|Vivaldi/i.test(x.brand)) || list.find((x) => /Chrome|Chromium/i.test(x.brand)) || {};
  const os = osOf();
  return ((String(b.brand || 'Chrome').replace(/^Google /, '')) + ' ' + (b.version || '')).trim().concat(os ? ' · ' + os : '').slice(0, 60);
}

/* ---------------- what went wrong, kept for the site ---------------- */
// What the engine caught and got over (a broken answer, a loop that went quiet, a tab that crashed or hung) is kept in storage and told
// to the site between packs (POST /crash), as the Android app does: the owner sees it in Admin → Surfing App, "What went wrong". A fault
// is known by a fingerprint of its kind and the place in the extension's code it came from, so one fault in many browsers is one line
// with its count; at most twenty lines wait.
const FAULTS_MAX = 20;
let faultsQ = Promise.resolve(); // the list is changed one change after another (two at once would lose one)
function fault(where, e) {
  const err = e instanceof Error ? e : new Error(String(e && e.message || e));
  console.warn('[surf] ' + where + ':', err.message);
  // Chrome closing while the sites go is not a fault: everything goes on when it starts again
  if (/browser is shutting down|extension context invalidated/i.test(err.message)) return faultsQ;
  faultsQ = faultsQ.then(() => keepFault(where, err)).catch(() => {});
  return faultsQ;
}
// the frames of the extension's own code a fault went through (Chrome's own frames say little): its function, file and line
function ownFrames(stack) {
  const out = [];
  for (const l of String(stack || '').split('\n')) {
    const m = /at (?:async )?(?:([^\s(]+) \()?chrome-extension:\/\/[^/]+\/([\w.-]+\.js):(\d+):\d+/.exec(l);
    if (m) out.push({ fn: m[1] || 'anonymous', file: m[2], line: m[3] });
  }
  return out;
}
async function sha1(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
async function keepFault(where, e) {
  const own = ownFrames(e.stack);
  const h = await sha1(where + '|' + e.name + '|' + own.slice(0, 3).map((f) => f.file + ':' + f.fn).join('|'));
  const msg = (e.name + ': ' + String(e.message || '').slice(0, 300) + (own.length ? ' · at ' + own.slice(0, 4).map((f) => f.fn + ' ' + f.file + ':' + f.line).join(' < ') : ''))
    .replace(/[\t\r\n]+/g, ' ').slice(0, 600);
  const list = (await get('faults')) || [];
  const was = list.find((f) => f.h === h && f.w === where);
  if (was) was.n += 1; else if (list.length < FAULTS_MAX) list.push({ h, w: where, n: 1, m: msg });
  await put({ faults: list });
}
// Tells the site what was kept, one request a line; what it did not take stays for the next time.
let telling = false;
async function tellFaults() {
  if (telling) return;
  telling = true;
  try {
    const list = (await get('faults')) || [];
    if (!list.length || !(await get('key'))) return;
    const model = await modelOf(), took = [];
    for (const f of list) {
      const r = await call('POST', '/crash', { hash: f.h, where: f.w, n: f.n, msg: f.m, version: VERSION_CODE, model });
      if (r.ok || r.status === 400) took.push(f); // a line the site refuses as it is would be refused forever
      else break;                                  // the site cannot hear now: the rest waits
    }
    if (!took.length) return;
    // what the site took goes; a fault that came again while it was being told keeps the times the site has not heard yet
    faultsQ = faultsQ.then(async () => {
      const cur = (await get('faults')) || [];
      await put({ faults: cur.map((f) => { const x = took.find((y) => y.h === f.h && y.w === f.w); return x ? Object.assign({}, f, { n: f.n - x.n }) : f; }).filter((f) => f.n > 0) });
    }).catch(() => {});
    await faultsQ;
  } finally { telling = false; }
}
// a fault nothing caught (a listener that threw): the worker goes on, the fault is kept like the others
self.addEventListener('unhandledrejection', (ev) => { if (!(ev.reason instanceof Wake)) fault('engine', ev.reason); });
self.addEventListener('error', (ev) => fault('engine', ev.error || ev.message));

/* ---------------- what the popup reads ---------------- */
let uiAt = 0, uiPending = null;
// the state the popup draws: written at most once a second (a counter of seconds would otherwise write storage four times a second)
function ui(o) {
  uiPending = Object.assign(uiPending || {}, o);
  const wait = Math.max(0, 1000 - (now() - uiAt));
  if (ui.t) return;
  ui.t = setTimeout(async () => { ui.t = 0; uiAt = now(); const cur = (await get('ui')) || {}; const next = Object.assign(cur, uiPending); uiPending = null; await put({ ui: next }); badge(next); }, wait);
}
// The icon says the state at a glance: the seconds a site has left while it is on the screen (the person sees the time without opening
// the popup), ▶ the sites go, … a wait, ❚❚ a pause, ? "are you there?", ! the work stopped and needs the person (a blocked browser,
// a restricted account, an old version, a browser disconnected); the words of the state are its tooltip.
function badge(u) {
  const ph = u.phase || 'idle', run = !['idle', 'stopped'].includes(ph);
  const stop = !run && (['blocked', 'restricted', 'update'].includes(u.gate) || (ph === 'stopped' && u.why === 'off'));
  const ask = ph === 'check' || (ph === 'paused' && u.why === 'check_missed');
  const left = ph === 'showing' && !u.loading && u.b ? Math.max(0, u.b - (u.a || 0)) : -1;
  chrome.action.setBadgeText({ text: stop ? '!' : !run ? '' : ask ? '?' : ph === 'paused' ? '❚❚' : ph === 'waiting' ? '…' : left >= 0 ? String(left) : '▶' });
  chrome.action.setBadgeBackgroundColor({ color: stop || ask ? '#dc2626' : ph === 'paused' || ph === 'waiting' ? '#6b7280' : '#f05a1a' });
  ready().then(() => { const s = said(u); chrome.action.setTitle({ title: s ? 'PR Surf: ' + s : 'PR Surf' }); }).catch(() => {});
}
// the state in a few words (the popup says the same at length)
function said(u) {
  const ph = u.phase || 'idle', w = u.why || '';
  if (['blocked', 'update'].includes(u.gate)) return t('ext.gate.' + u.gate);
  if (u.gate === 'restricted') return t('gate.restricted');
  if (ph === 'stopped' && w === 'off') return t('ext.off');
  if (ph === 'showing') return u.domain || '';
  if (ph === 'asking' || ph === 'gap') return t(ph === 'gap' ? 'show.next' : 'show.asking');
  if (ph === 'waiting') return t(w === 'offline' ? 'pause.no_internet' : 'wait.' + (w || 'empty'));
  if (ph === 'paused') return t(w === 'person' || w === 'check_missed' ? 'pause.' + w : 'ext.pause.' + w);
  if (ph === 'check') return t('check.title');
  return '';
}

/* ---------------- connecting ---------------- */
async function pair() {
  const r = await call('POST', '/pair', { device: await device() });
  if (!r.ok) { await put({ pairing: { err: r.code, wait: (r.body && r.body.wait) || 0 } }); return { ok: false, code: r.code }; }
  const p = { code: r.body.code, pt: r.body.pt, link: SITE_BASE + '/tools?connect=' + r.body.code, until: now() + r.body.expires_in * 1000 };
  await put({ pairing: p });
  chrome.alarms.create('pair', { periodInMinutes: 0.5 });
  pollPair();
  return { ok: true, pairing: p };
}
// asked every three seconds while the popup is open (its messages keep this worker awake) and by an alarm every half a minute when it is not
let polling = false;
async function pollPair() {
  if (polling) return; polling = true;
  try {
    for (let i = 0; i < 6; i++) {
      const p = await get('pairing');
      if (!p || !p.pt) break;
      if (now() > p.until) { await put({ pairing: { over: true } }); chrome.alarms.clear('pair'); break; }
      const r = await call('GET', '/pair/' + p.pt);
      if (r.ok && r.body.state === 'ok') { await put({ key: r.body.key, user: r.body.user || '', pairing: null }); chrome.alarms.clear('pair'); ui({ phase: 'idle', user: r.body.user || '' }); config(); break; }
      if (r.ok && r.body.state === 'gone') { await put({ pairing: { over: true } }); chrome.alarms.clear('pair'); break; }
      // the site refused the code as entered (the person, or this browser): the popup says why, the code still waits
      if (r.ok && r.body.state === 'wait' && r.body.refused && r.body.refused !== p.refused) await put({ pairing: Object.assign({}, p, { refused: r.body.refused, need: r.body.need || 0, max: r.body.max || 0 }) });
      await sleep(3000);
    }
  } finally { polling = false; }
}

/* ---------------- the site's settings for this browser ---------------- */
// what stops the work, as the settings say it: the account restricted, a version too old, surfing closed for this account
const gateOf = (c) => (c.restricted ? 'restricted' : (c.min_version || 0) > VERSION_CODE ? 'update' : c.open === false ? 'closed' : null);
let refused = null; // the site refused the settings themselves: 'blocked' (this browser), or null
async function config() {
  const r = await call('GET', '/config');
  refused = r.code === 'BLOCKED' ? 'blocked' : null;
  if (!r.ok) {
    if (r.code === 'NO_KEY' || r.code === 'OFF') await forget('off');
    else if (refused) ui({ gate: 'blocked' });
    else ui({ net: whyOf(r.code) }); // the popup says the numbers may be old
    return null;
  }
  const c = r.body;
  await put({ config: c, configAt: now(), user: c.user || (await get('user')) || '' });
  const gate = gateOf(c); // said at once on the popup (blocked comes as a refusal, above)
  // the week is the days before today as the site wrote them plus today as it is counted now (the popup adds them)
  ui({ today: c.stats && c.stats.today, before: c.stats && c.stats.before, day: c.stats && c.stats.day, user: c.user, msg: c.msg || null, latest: c.latest || null, minVersion: c.min_version, gate, net: null });
  return c;
}
async function forget(why) {
  // the journal belongs to the connection: another account connected here never sees the earlier one's sites
  await store.remove(['key', 'pending', 'pack', 'config', 'journal', 'until', 'retry', 'reportAt', 'reportN']);
  chrome.alarms.clear('report');
  await stopRun(why === 'off' ? 'off' : why);
  ui({ phase: 'stopped', why });
}

/* ---------------- the window of the sites ---------------- */
let fresh = false; // this worker is the first since Chrome or the extension started (not one woken from sleep)
// The window of the sites: the one kept when it is still there, else a new one. After Chrome or the extension started again its window
// may be left with one empty tab (an update closes the extension's own page in it): that tab is taken again instead of a new window.
async function surfWindow(focus) {
  const w = await get('win');
  if (w) {
    try {
      const win = await chrome.windows.get(w.win, { populate: true });
      if (win && win.tabs && win.tabs.some((x) => x.id === w.tab)) return w;
      if (fresh && win && win.tabs && win.tabs.length === 1 && /^(chrome:\/\/newtab|about:blank|chrome-extension:)/.test(win.tabs[0].url || win.tabs[0].pendingUrl || '')) {
        const o = { win: win.id, tab: win.tabs[0].id };
        await chrome.tabs.update(o.tab, { url: STAGE });
        await put({ win: o });
        return o;
      }
    } catch (e) { /* closed */ }
  }
  // a window of the sites Chrome opened again with the others (it shows the extension's own page)
  const [left] = await chrome.tabs.query({ url: STAGE }).catch(() => []);
  if (left) {
    const win = await chrome.windows.get(left.windowId, { populate: true }).catch(() => null);
    if (win && win.type === 'normal' && win.tabs.length === 1) { const o = { win: win.id, tab: left.id }; await put({ win: o }); return o; }
  }
  // where the person last put the window and how big they made it (a corner, small, while they work in other windows); the first time a
  // window of a comfortable size, not the whole screen. Bounds Chrome refuses (a monitor that is gone) give way to the plain size.
  const b = await get('bounds'), size = { width: 880, height: 660 };
  const at = b && b.width >= 320 && b.height >= 320 ? { left: b.left, top: b.top, width: b.width, height: b.height } : size;
  const win = await chrome.windows.create(Object.assign({ url: STAGE, type: 'normal', focused: !!focus }, at))
    .catch(() => chrome.windows.create(Object.assign({ url: STAGE, type: 'normal', focused: !!focus }, size)));
  const o = { win: win.id, tab: win.tabs[0].id };
  await put({ win: o });
  return o;
}
// The tab of the sites made new (its page crashed or hung): a new tab in the same window first, then the old one goes, so the window
// stays where the person put it. → the window, or null when there is none
async function renewTab() {
  const w = await get('win');
  if (!w) return null;
  let tab;
  try { tab = await chrome.tabs.create({ windowId: w.win, url: STAGE, active: true }); } catch (e) { return null; }
  const o = { win: w.win, tab: tab.id };
  await put({ win: o }); // first: the old tab's going is then not taken for the person's closing
  try { await chrome.tabs.remove(w.tab); } catch (e) { /* gone already */ }
  return o;
}
// whether the page of a tab still answers within a few seconds (a crashed tab refuses, a hung one never answers)
async function answers(tabId) {
  try {
    return await Promise.race([chrome.scripting.executeScript({ target: { tabId }, func: () => 1, injectImmediately: true }).then((r) => !!(r && r[0] && r[0].result === 1)), sleep(5000).then(() => false)]);
  } catch (e) { return false; }
}
// whether the window's page between the sites is on the screen (Chrome tells its visibility; a window under others is hidden);
// true when it cannot say (a site is in the tab, or the page is not there yet)
async function stageSeen() {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const st = list.find((c) => c.url.startsWith(STAGE));
    return !st || st.visibilityState === 'visible';
  } catch (e) { return true; }
}
// why the sites may not go now: the person's pause, the window closed by the person or minimised or covered, the screen locked; null
// when they may. While a site is shown its page itself says whether it is seen (showItem), so the page between the sites is asked only
// between them.
async function blocker(inSite) {
  const s = await store.get(['personPause', 'winClosed', 'win']);
  if (s.personPause) return 'person';
  if (s.winClosed || closedAt) return 'closed';
  try { if ((await chrome.idle.queryState(60)) === 'locked') return 'locked'; } catch (e) { /* not known */ }
  if (s.win) {
    try { const win = await chrome.windows.get(s.win.win); if (win.state === 'minimized') return 'hidden'; } catch (e) { return null; } // gone without the person: made again
    if (!inSite && !(await stageSeen())) return 'covered';
  }
  return null;
}
// The window of the sites (or its tab) closed: by the person (the sites wait, one key of the popup brings the window back), or by Chrome
// quitting (nothing is kept then: the sites go on when Chrome starts again). The two look the same at first; Chrome quitting stops this
// worker within a moment, so the person's closing is kept only when the worker is still here a few seconds later.
let closedAt = 0;
async function closedByPerson() {
  await store.remove('win');
  if (!(await get('running'))) return;
  closedAt = now(); item = null; // from now on the sites wait in this worker
  wake();
  loopSafe();
  const at = closedAt;
  await sleep(3000);
  if (closedAt !== at) return; // the window was shown again meanwhile
  try { await chrome.windows.getAll(); } catch (e) { return; } // Chrome is quitting
  await put({ winClosed: true });
}
// the screen kept on while the sites go (a page counts only while it is on the screen), let go in a pause
let awakeOn = null;
function awake(on) {
  if (awakeOn === on) return;
  awakeOn = on;
  try { if (on) chrome.power.requestKeepAwake('display'); else chrome.power.releaseKeepAwake(); } catch (e) { /* not allowed */ }
}

/* ---------------- running ---------------- */
async function startRun() {
  closedAt = 0;
  await put({ running: true, personPause: false, winClosed: false });
  await store.remove(['until', 'retry']);
  awake(true);
  const w = await surfWindow(true);
  try { await chrome.windows.update(w.win, { focused: true }); } catch (e) { /* closed meanwhile */ }
  chrome.alarms.create('watch', { periodInMinutes: 1 });
  ui({ phase: 'asking', why: '', note: null });
  loopSafe();
}
async function stopRun(why) {
  loopNo++; closedAt = 0; // the loop that runs leaves at its next step
  const was = await get('running');
  await put({ running: false, personPause: false, winClosed: false });
  await store.remove(['until', 'retry', 'check']);
  awake(false);
  for (const a of ['wake', 'watch', 'check']) chrome.alarms.clear(a);
  chrome.notifications.clear('check');
  if (was && why !== 'off') await report();
  const w = await get('win');
  if (w) { try { await chrome.tabs.update(w.tab, { url: STAGE }); } catch (e) { /* closed */ } }
  const gate = ['blocked', 'restricted', 'update'].includes(why) ? why : undefined;
  ui(Object.assign({ phase: why === 'off' || gate ? 'stopped' : 'idle', why: why || '', note: null }, gate ? { gate } : {}));
  // the person stopped: the statistics and the limits are read again (one request)
  if (why === 'person' && (await get('key'))) config();
}
// a report sent on its own (a stop, a pause): true when the site took it
async function deliver(report, stop) {
  const r = await call('POST', '/next', Object.assign({ version: VERSION_CODE, z: -new Date().getTimezoneOffset() }, report, stop ? { stop: true } : {}));
  if (!r.ok) return false;
  await store.remove('pending');
  if (r.body.result) applyResult(r.body.result);
  return true;
}
// The report kept in storage sent on its own; when the site does not take it, it is sent again by itself later (5 s, 10 s … 5 min),
// even when the sites do not go any more. → true when nothing waits
async function report() {
  const pending = await get('pending');
  if (!pending) return true;
  if (!(await get('key'))) return false;
  const at = await get('reportAt');
  if (at && at > now()) return false;
  if (await deliver(pending, true)) { await store.remove(['reportAt', 'reportN']); chrome.alarms.clear('report'); return true; }
  const n = ((await get('reportN')) || 0) + 1, next = now() + Math.round(Math.min(300000, 5000 * 2 ** (n - 1)) * (1 + Math.random() / 4));
  await put({ reportN: n, reportAt: next });
  chrome.alarms.create('report', { when: Math.max(next, now() + 30000) });
  return false;
}
async function applyResult(res) {
  const j = (await get('journal')) || [];
  const v = res.items || {}, pay = res.pay || {};
  for (const e of j) if (v[e.t] != null) { e.v = v[e.t]; if (pay[e.t] != null) e.e = pay[e.t]; }
  await put({ journal: j });
  if (res.today) {
    ui({ today: res.today });
    // a new day of the site (UTC midnight): the settings are read again, so yesterday moves into the week
    const u = (await get('ui')) || {};
    if (res.today.day && u.day && res.today.day !== u.day) config();
  }
}
async function journalAdd(e) {
  const j = (await get('journal')) || [];
  j.unshift(e); await put({ journal: j.slice(0, 100) });
}

// The loop under a watch. Each loop has its number: the watch or a stop starts another one, and the one before leaves at its next step
// (a step that never came back can never act after it). The loop says how long it may stay quiet (alive): a wait it chose, a request to
// the site; the watch starts a new loop when it was quiet longer, and keeps the fault for the site.
let loopNo = 0, loopOn = 0, beat = { at: 0, quiet: 0, phase: '' };
const alive = (ms, phase) => { beat = { at: now(), quiet: ms, phase: phase || beat.phase }; };
// the sites that wait for the person: their pause, the window they closed, "are you there?" (a key of the popup goes on)
async function held() {
  const s = await store.get(['personPause', 'winClosed', 'check']);
  return !!(s.personPause || s.winClosed || s.check);
}
let offlineSince = 0, askedAt = 0;
async function loop(force) {
  if (loopOn && !force) return;
  const my = ++loopNo; loopOn = my;
  const mine = () => my === loopNo;
  try {
    let pausedAt = 0;
    while (mine() && (await get('running'))) {
      alive(60000, 'asking');
      const b = await blocker();
      if (b) {
        if (!pausedAt) pausedAt = now();
        if (await paused(b, pausedAt)) return;
        continue;
      }
      pausedAt = 0;
      awake(true);
      // no network at all: nothing is asked (it would fail); the loop looks again every few seconds, and once in five minutes it asks
      // anyway (a browser can be wrong about it)
      if (!navigator.onLine && now() - askedAt < 300000) {
        if (!offlineSince) offlineSince = now();
        ui({ phase: 'waiting', why: 'offline', until: 0 });
        await wait(now() - offlineSince < 120000 ? 3000 : 30000, 'waiting');
        continue;
      }
      offlineSince = 0;
      // the site said when to ask again (kept in storage: a worker that slept or started again keeps the wait)
      const until = await get('until');
      if (until && until.at > now()) {
        ui({ phase: 'waiting', why: until.why, until: until.at });
        await wait(until.at - now(), 'waiting');
        continue;
      }
      ui({ phase: 'asking' });
      const pending = await get('pending'), checkId = await get('checkAnswer'); // the person's answer to "are you there?" goes with this request
      alive(CALL_MS + 30000, 'asking');
      askedAt = now();
      const r = await call('POST', '/next', Object.assign({ version: VERSION_CODE, z: -new Date().getTimezoneOffset() }, pending || {}, checkId ? { check: { id: checkId } } : {}));
      if (!mine()) return;
      if (!r.ok) {
        if (r.code === 'NO_KEY' || r.code === 'OFF') { await forget('off'); return; }
        if (r.code === 'BLOCKED') { await stopRun('blocked'); return; }
        await later(r.code, r.body && r.body.wait); // the report stays in storage and goes with the next try
        continue;
      }
      await store.remove(['pending', 'checkAnswer', 'retry', 'until', 'reportAt', 'reportN']);
      chrome.alarms.clear('report');
      const body = r.body;
      if (body.result) await applyResult(body.result);
      const c = await get('config');
      // a new message of the admin panel, or settings older than an hour (how the sites are shown may have changed): read again
      if ((body.msg && (!c || !c.msg || c.msg.id !== body.msg)) || now() - ((await get('configAt')) || 0) > 3600000) config();
      tellFaults(); // what went wrong and was got over, told between packs
      if (body.check) {
        const until = now() + (body.check.ttl || 600) * 1000;
        await put({ check: body.check.id });
        ui({ phase: 'check', until });
        awake(false);
        chrome.alarms.create('check', { when: Math.max(until, now() + 30000) });
        await ready();
        chrome.notifications.create('check', { type: 'basic', iconUrl: 'icons/128.png', title: t('check.title'), message: tb('check.sub'), buttons: [{ title: t('check.yes') }], requireInteraction: true, priority: 2 });
        return; // goes on when the person answers (answer())
      }
      if (!body.pack) {
        const why = body.why || 'empty';
        if (why === 'update' || why === 'restricted') { await stopRun(why); return; }
        await put({ until: { at: now() + (body.poll_after || 600) * 1000, why } });
        continue;
      }
      await showPack(body.pack, mine);
    }
  } finally { if (loopOn === my) loopOn = 0; }
}
// The site did not answer: the next try after a pause that grows with each try (2 s, 4 s … 4 min, and a random part of a quarter, so
// that many browsers do not come back at once), kept in storage with its reason. When the site says how long to wait (429 TOO_OFTEN
// with `wait`, in seconds), the next try is never sooner than that.
async function later(code, told) {
  const n = ((await get('retry')) || 0) + 1, base = Math.min(240000, 2000 * 2 ** (n - 1));
  const at = Math.max(now() + base + Math.round(Math.random() * base / 4), now() + Math.min(3600, Number(told) || 0) * 1000);
  await put({ retry: n, until: { at, why: whyOf(code) } });
}
// The sites wait: what was shown is reported (with stop: no new pack comes), the person is told why, the screen may sleep. A pause only
// the person ends (their pause, the window they closed) ends the loop here; the others are looked at again every five seconds for two
// minutes, then every half a minute (the screen unlocked wakes it at once). → true when the loop ends
async function paused(b, since) {
  await report();
  awake(false);
  ui({ phase: 'paused', why: b });
  if (b === 'person' || b === 'closed') return true;
  await wait(now() - since > 120000 ? 30000 : 5000, 'paused');
  return false;
}
// A wait: short ones here (an event may end it sooner: the connection back, the screen unlocked, a key of the person), long ones by an
// alarm (the worker may sleep meanwhile; the alarm starts the loop again).
let wakeUp = null;
function wake() { const w = wakeUp; wakeUp = null; if (w) w(); }
async function wait(ms, phase) {
  alive(Math.max(0, ms) + 30000, phase);
  if (ms <= 25000) { await new Promise((r) => { wakeUp = r; setTimeout(r, Math.max(0, ms)); }); wakeUp = null; return; }
  chrome.alarms.create('wake', { when: now() + ms });
  throw new Wake();
}
class Wake extends Error {}

// The loop under a watch: a fault it did not expect is kept for the site, and the loop starts again by itself after a short pause,
// longer when it repeats; from the third fault in a row the tab of the sites is made new as well. The person sees the sites go on.
let faultRow = { n: 0, at: 0 };
const loopSafe = (force) => (force ? Promise.resolve(false) : held()).then((h) => (h ? null : loop(force))).catch(async (e) => {
  if (e instanceof Wake) return;
  await fault('engine', e);
  faultRow = now() - faultRow.at > 600000 ? { n: 1, at: now() } : { n: faultRow.n + 1, at: now() };
  if (faultRow.n >= 3) await renewTab().catch(() => null);
  const pause = Math.min(60000, 2000 * 2 ** Math.min(faultRow.n, 5));
  alive(pause + 30000, 'fault');
  if (pause <= 25000) setTimeout(() => loopSafe(), pause); else chrome.alarms.create('wake', { when: now() + pause });
});
// Every minute while the sites go: a loop quiet for longer than it said is stuck (a step that never came back): a new one starts and the
// fault is kept for the site (and the tab is made new when it was showing a site). No loop at all (the worker slept, an alarm was lost)
// is started again without a fault.
async function watch() {
  if (!(await get('running'))) { chrome.alarms.clear('watch'); return; }
  if (await held()) return;
  if (loopOn) {
    if (now() - beat.at <= beat.quiet) return;
    // a pause or a wait the loop chose is not a hang: the computer slept through it (its timers stood, its clock did not, 27.10.2026: 28 a
    // week). The loop starts again, with no fault and the tab as it is
    if (beat.phase === 'paused' || beat.phase === 'waiting') { loopSafe(true); return; }
    const e = new Error('the loop was quiet ' + Math.round((now() - beat.at) / 1000) + ' s in ' + (beat.phase || 'its work') + ': started again');
    e.name = 'LoopQuiet';
    await fault('engine', e);
    if (beat.phase === 'showing') await renewTab().catch(() => null);
    loopSafe(true);
    return;
  }
  const a = await chrome.alarms.get('wake');
  if (a && a.scheduledTime > now() - 60000) return; // a wait by an alarm that is not over yet
  loopSafe();
}

/* ---------------- a pack and its sites ---------------- */
let item = null; // the site being shown: what the page script reports goes here
const BROWSER_ERRORS = new Set(['timeout', 'load', 'crash']);
async function showPack(pack, mine) {
  const done = [], sh = await show();
  let streak = 0;
  for (let i = 0; i < pack.items.length; i++) {
    // no network: the rest of the pack goes back as not shown (it is not the sites' fault); the shown part waits for the connection
    if (!mine() || !(await get('running')) || !navigator.onLine || (await blocker())) break;
    const w = await surfWindow(false); // the window of now: its tab may have been made new
    const r = await showItem(w, pack.items[i], i, pack.items.length, pack.load || 20, mine);
    if (!r) break;
    done.push(r);
    await put({ pending: { pack: pack.id, done } }); // kept after each site: a stop or a closed browser still reports what was shown
    // sites that do not open one after another while there is a network: the tab itself may be what broke, it is made new
    streak = r.ok || !BROWSER_ERRORS.has(r.err) ? 0 : streak + 1;
    if (streak >= sh.fail_renew && navigator.onLine) {
      const e = new Error(streak + ' sites in a row did not open (' + r.err + '): a new tab'); e.name = 'SitesFail';
      await fault('viewer', e);
      streak = 0; await renewTab();
    }
    if (i < pack.items.length - 1) {
      ui({ phase: 'gap' });
      alive((pack.gap || 3) * 1000 + 30000, 'gap');
      const g = await get('win');
      try { await chrome.tabs.update(g.tab, { url: STAGE }); } catch (e) { break; }
      await sleep((pack.gap || 3) * 1000);
    }
  }
  const w = await get('win');
  if (w) { try { await chrome.tabs.update(w.tab, { url: STAGE }); } catch (e) { /* closed */ } }
  if (!done.length) await put({ pending: { pack: pack.id, done: [] } });
}

// one site: it loads (at most loadSec), then its seconds run while its page is on the screen; → the report line, or null when it was
// cut short (not reported: its place goes back to its order)
const COVERED_MS = 60000; // a page under other windows this long ends the pack: its sites go back, the sites wait for the window
async function showItem(w, it, index, total, loadSec, mine) {
  const url = absolute(it.url), need = it.seconds * 1000, domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url.slice(0, 40); } })();
  const sh = await show();
  const seq = Math.random().toString(36).slice(2);
  item = { seq, url, t: it.t, kind: it.kind || 'site', need, vis: 0, vid: 0, lastCt: -1, lastTick: 0, loaded: 0, title: '', status: 0, cf: 0, err: '', seen: 0, hidden: 0, gone: 0, still: 0, ytId: '', backs: 0, endAt: 0, reloads: 0 };
  const cur = item;
  const line = async (ok, err, why) => {
    await journalAdd({ at: now(), t: it.t, d: domain, s: it.seconds, k: cur.kind, v: ok ? '' : String(err || 'load').toUpperCase(), e: '' });
    return ok ? { t: it.t, ok: true, vis: cur.vis, vid: cur.vid, title: cur.title.slice(0, 60) } : Object.assign({ t: it.t, ok: false, err: err || 'load' }, why ? { why } : {});
  };
  alive(30000, 'showing');
  ui({ phase: 'showing', domain, kind: cur.kind, a: 0, b: it.seconds, i: index + 1, n: total, loading: true });
  try { await chrome.tabs.update(w.tab, { url, muted: sh.mute }); } catch (e) { return null; } // the window is gone
  let started = now(), last = now(), hiddenSince = 0, askedTab = 0;
  for (;;) {
    alive(30000, 'showing');
    await sleep(500);
    if (item !== cur || !mine()) return null;
    if (!(await get('running'))) return null;
    // a gap in the steps (the computer slept, or Chrome held the worker): the clocks of this site move on by it, so the page gets a
    // fair while to load and to speak again
    const t0 = now(), gap = t0 - last - 500; last = t0;
    if (gap > 5000) { started += gap; if (cur.loaded) cur.loaded += gap; if (cur.lastTick) cur.lastTick += gap; if (hiddenSince) hiddenSince += gap; }
    const b = await blocker(true); if (b) return null; // cut short: not reported, its place goes back to its order
    // a site that did not open while the browser has no network is not the site's fault: it goes back as not shown
    // the person skipped it (Skip in the popup): not counted, never offered to them again; the reason they chose goes to the site
    if (cur.skip !== undefined) return line(false, 'skip', cur.skip || '');
    if (cur.err) return navigator.onLine ? line(false, cur.err) : null;
    if (!cur.loaded) {
      if (now() - started > loadSec * 1000) return navigator.onLine ? line(false, 'timeout') : null;
      continue;
    }
    // the page script stopped speaking: a crashed tab ("Aw, Snap") says so at once (Chrome marks it unloaded); a hung one or a broken page
    // after hung_sec of silence
    const silent = now() - (cur.lastTick || cur.loaded);
    if (silent > 3000 && now() - askedTab > 3000) {
      askedTab = now();
      const tab = await chrome.tabs.get(w.tab).catch(() => null);
      if (tab && tab.status === 'unloaded' && !tab.discarded) return line(false, await broke(w, 'crashed'));
    }
    if (silent > sh.hung_sec * 1000) return line(false, await broke(w, 'hung'));
    if (cur.status >= 400) return line(false, 'http');
    if (cur.cf && now() - cur.loaded > loadSec * 1000) return line(false, 'blocked');
    // a video that cannot play (its own error, YouTube's "video unavailable") ends after two seconds in a row of it; one that has not moved
    // for 25 s on the screen (an advertisement's time aside: before it starts, a stall, an end it could not start over) is not waited for
    // either. While it moves it is waited for: a slow YouTube, a return to the ordered video, its start over at its end
    if (cur.kind === 'video' && (cur.gone >= 2 || cur.still > 25000)) return line(false, 'video');
    // under other windows: the person is told, the seconds wait; long enough, and the pack ends
    if (cur.hidden && cur.lastTick) {
      if (!hiddenSince) hiddenSince = now();
      if (now() - hiddenSince > COVERED_MS) return null;
      if (now() - hiddenSince > 3000) { ui({ phase: 'paused', why: 'covered' }); continue; }
    } else hiddenSince = 0;
    ui({ phase: 'showing', domain, kind: cur.kind, a: Math.min(it.seconds, Math.floor((cur.kind === 'video' ? Math.min(cur.vis, cur.vid) : cur.vis) / 1000)), b: it.seconds, i: index + 1, n: total, loading: false });
    if (cur.vis >= need + 300 && (cur.kind !== 'video' || cur.vid >= need + 300)) return line(true);
    if (cur.kind === 'video' && now() - cur.loaded > need * 2 + 60000) return line(false, 'video'); // a guard only: twice its time and a minute
  }
}
// The page went silent: whether its tab still answers. A crashed tab, or one that does not answer in five seconds (hung), is made new
// and the fault is kept for the site; the site is reported as the browser's trouble ('crash', not counted: the site does not come back
// to this person for a while). A tab that answers had a page that broke itself ('load'). → the reason of the report line
async function broke(w, how) {
  const tab = await chrome.tabs.get(w.tab).catch(() => null);
  if (!tab) return 'load'; // the tab is gone (its window was closed)
  if (how !== 'crashed' && tab.status !== 'unloaded' && (await answers(w.tab))) return 'load';
  const e = new Error(how === 'crashed' || tab.status === 'unloaded' ? 'the page of the sites crashed: a new tab' : 'the page of the sites stopped answering: a new tab');
  e.name = how === 'crashed' || tab.status === 'unloaded' ? 'TabCrashed' : 'TabHung';
  await fault('viewer', e);
  await renewTab();
  return 'crash';
}

// the page of the site finished loading in the window's tab: the page script goes in and starts reporting
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !item) return;
  const w = await get('win'); if (!w || w.tab !== tabId) return;
  if (!/^https?:/.test(tab.url || '')) { if (/^chrome-error:/.test(tab.url || '')) item.err = 'load'; return; }
  const cur = item;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'] });
    const sh = await show();
    await chrome.scripting.executeScript({ target: { tabId }, func: (o) => window.__prsSurf && window.__prsSurf.start(o), args: [{ seq: cur.seq, kind: cur.kind, scroll: sh.scroll }] });
    cur.lowq = !!sh.lowq; // a YouTube video at its lowest quality (the tick asks the player)
    if (!cur.loaded) cur.loaded = now();
  } catch (e) { cur.err = 'load'; } // a page the extension may not enter (an error page of Chrome, the store)
});

// A YouTube video at its lowest quality (the site's settings, show.lowq, 28.10.2026: the person's data; a view counts the same): the player's
// own calls, run in the page's own world (a content script cannot reach them). 'ok' once it holds the lowest.
function lowQuality() {
  try {
    const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!p || typeof p.setPlaybackQualityRange !== 'function' || typeof p.getAvailableQualityLevels !== 'function') return 'wait';
    const l = (p.getAvailableQualityLevels() || []).filter((x) => x && x !== 'auto');
    if (!l.length) return 'wait';
    const low = l[l.length - 1];
    if (typeof p.getPlaybackQuality === 'function' && p.getPlaybackQuality() === low) return 'ok';
    p.setPlaybackQualityRange(low, low); if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(low);
    return 'set';
  } catch (e) { return 'err'; }
}
// the video of a YouTube page (watch?v=…, /shorts/…), '' for any other page
function ytIdOf(h) {
  try { const u = new URL(h); if (!/(^|\.)youtube\.com$/.test(u.hostname)) return ''; return u.searchParams.get('v') || (u.pathname.match(/^\/shorts\/([\w-]{6,})/) || [])[1] || ''; } catch (e) { return ''; }
}
// what the page script reports every second: whether the page is seen, its title, its video
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m && m.type === 'tick') {
    const cur = item;
    if (cur && m.seq === cur.seq) {
      const t = now(), dt = cur.lastTick ? Math.min(t - cur.lastTick, 1500) : 0;
      cur.lastTick = t;
      if (m.vis) cur.vis += dt;
      cur.hidden = m.vis ? 0 : 1;
      cur.title = m.title || cur.title; cur.status = m.status || 0; cur.cf = m.cf ? 1 : 0;
      cur.gone = m.x ? (cur.gone || 0) + 1 : 0; // seconds in a row the page said its video cannot play
      let moved = false;
      if (m.v) {
        cur.seen = 1;
        // what the video moved since the last second; when it starts over (its own loop, its restart at its end) the part to its end and
        // the part from its beginning (a Short of two seconds counted only half its time without it)
        let dct = m.v.ct - cur.lastCt;
        if (cur.lastCt >= 0 && dct < 0 && m.v.d > 0 && cur.lastCt > m.v.d - 2.5) dct = m.v.d - cur.lastCt + m.v.ct;
        if (!m.v.p && !m.v.ad && m.vis && cur.lastCt >= 0 && dct > 0) { cur.vid += Math.min(dct * 1000, 1600); moved = true; }
        cur.lastCt = m.v.ct;
        // the lowest quality while a YouTube video plays: asked each second until it holds, then every five (an ad first, a new video)
        if (cur.lowq && sender.tab && ytIdOf(sender.tab.url || '') && t >= (cur.lowqAt || 0)) {
          cur.lowqAt = t + (cur.lowqOk ? 5000 : 1000);
          chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: lowQuality }).then((r) => { cur.lowqOk = !!(r && r[0] && r[0].result === 'ok'); }).catch(() => {});
        }
      }
      // on the screen and not an advertisement: the time the video has not moved (before it starts, a stall, an end it could not start over)
      if (m.vis && !(m.v && m.v.ad)) cur.still = moved ? 0 : (cur.still || 0) + dt;
      // its end before its seconds: the page starts it over at once; when it does not move again within 4 s (YouTube's player on a computer
      // can hold its end), the page of the ordered video opens again and it plays from the beginning, twice at most
      const atEnd = m.v && !m.v.l && (m.v.e || (m.v.p && m.v.d > 0 && m.v.ct >= m.v.d - 0.25));
      if (atEnd && cur.vid < cur.need) {
        if (!cur.endAt) cur.endAt = t;
        else if (t - cur.endAt > 4000 && cur.reloads < 2 && sender.tab) { cur.reloads++; cur.endAt = 0; cur.lastCt = -1; cur.still = 0; chrome.tabs.update(sender.tab.id, { url: cur.url }).catch(() => {}); }
      } else cur.endAt = 0;
      // YouTube moved on to another video by itself (its next video, a playlist): back to the ordered one, twice at most
      const yt = ytIdOf(m.h);
      if (yt && !cur.ytId) cur.ytId = yt;
      else if (yt && yt !== cur.ytId && cur.backs < 2 && sender.tab) { cur.backs++; cur.lastCt = -1; cur.still = 0; chrome.tabs.update(sender.tab.id, { url: cur.url }).catch(() => {}); }
    }
    return;
  }
  booted.then(() => handle(m)).then(reply, (e) => reply({ ok: false, code: e instanceof Wake ? 'WAIT' : 'ERROR' }));
  return true; // the answer comes later
});

/* ---------------- what the popup asks ---------------- */
async function handle(m) {
  switch (m && m.type) {
    case 'pair': return pair();
    case 'poll': pollPair(); return { ok: true };
    case 'start': await startRun(); return { ok: true };
    case 'stop': await stopRun('person'); return { ok: true };
    case 'pause': await put({ personPause: true }); ui({ phase: 'paused', why: 'person' }); wake(); return { ok: true };
    // Continue: the person's pause is over, and a window of the sites they closed or minimised meanwhile comes back with it (25.10.2026,
    // the owner: the window closed in a pause, Continue did nothing and only Stop got out)
    case 'resume': await put({ personPause: false }); await bringBack(); wake(); loopSafe(); return { ok: true };
    case 'skip': if (!item) return { ok: false }; item.skip = ['open', 'video', 'adult', 'scam', 'other'].includes(m.why) ? m.why : ''; return { ok: true };
    case 'answer': return answer();
    case 'config': return { ok: true, config: await config() };
    case 'disconnect': await call('POST', '/bye'); await forget('person'); await put({ ui: { phase: 'idle' }, user: '' }); return { ok: true };
    case 'msg-closed': { const c = await get('config'); if (c && c.msg) await put({ msgSeen: c.msg.id }); return { ok: true }; }
    // the person asks now (no sites, the site busy, no connection): the wait is over at once
    case 'nudge': chrome.alarms.clear('wake'); await store.remove('until'); offlineSince = 0; askedAt = 0; wake(); loopSafe(); return { ok: true };
    // the window of the sites back on the screen: minimised, under other windows, or closed by the person (a new one opens)
    case 'focus': await bringBack(); wake(); loopSafe(); return { ok: true };
    // "Check again" of what stopped the work: the settings are read; a stop of the site that is over is forgotten
    case 'again': {
      const c = await config(), gate = c ? gateOf(c) : refused;
      if (c && !gate) ui({ phase: 'idle', why: '', gate: null });
      return { ok: !!c || !!refused, gate };
    }
    default: return { ok: false };
  }
}
// the window of the sites back on the screen and in front: minimised, under other windows, or closed by the person (a new one opens)
async function bringBack() {
  closedAt = 0;
  await put({ winClosed: false });
  const w = await surfWindow(true);
  try { const win = await chrome.windows.get(w.win); await chrome.windows.update(w.win, win.state === 'minimized' ? { focused: true, state: 'normal' } : { focused: true }); } catch (e) { /* closed */ }
}
// "Yes, I'm here" (also after its time: the site still takes the answer): it goes with the next request of the loop
async function answer() {
  const id = await get('check');
  chrome.notifications.clear('check');
  chrome.alarms.clear('check');
  if (!id) return { ok: false };
  await store.remove('check');
  await put({ checkAnswer: id });
  loopSafe();
  return { ok: true };
}
// "are you there?" not answered in its time: the sites wait for Continue (the popup and the badge say so)
async function checkOver() { if ((await get('running')) && (await get('check'))) ui({ phase: 'paused', why: 'check_missed' }); }

chrome.notifications.onButtonClicked.addListener((id) => { if (id === 'check') booted.then(answer); });
chrome.notifications.onClicked.addListener((id) => { if (id === 'check') booted.then(answer); });
chrome.alarms.onAlarm.addListener((a) => booted.then(() => {
  if (a.name === 'wake') loopSafe();
  else if (a.name === 'watch') return watch();
  else if (a.name === 'report') return report();
  else if (a.name === 'check') return checkOver();
  else if (a.name === 'pair') pollPair();
}));
chrome.windows.onRemoved.addListener(async (id) => { const w = await get('win'); if (w && w.win === id) closedByPerson(); });
// the window of the sites moved or resized by the person: kept for the next time it opens (not when it is minimised, maximised or full)
chrome.windows.onBoundsChanged.addListener(async (win) => { const w = await get('win'); if (!w || w.win !== win.id || win.state !== 'normal') return;
  await put({ bounds: { left: win.left, top: win.top, width: win.width, height: win.height } }); });
chrome.tabs.onRemoved.addListener(async (id, info) => { if (info.isWindowClosing) return; const w = await get('win'); if (w && w.tab === id) closedByPerson(); });
// the screen unlocked, the network back: a wait for them ends at once
chrome.idle.onStateChanged.addListener((s) => { if (s === 'active') { wake(); booted.then(() => loopSafe()); } });
self.addEventListener('online', () => { offlineSince = 0; wake(); booted.then(() => loopSafe()); });

// The worker starts: Chrome started, the extension was updated or reloaded, or the worker slept and an event woke it. The badge says the
// state again; sites that were going go on. After Chrome or the extension started again (a session of its own: chrome.storage.session
// is empty then) they go on only when the site's settings allow it (config.show.resume), and the popup says they went on by themselves.
const booted = boot().catch((e) => fault('boot', e));
async function boot() {
  const s = await chrome.storage.session.get('on').catch(() => ({ on: 1 }));
  fresh = !s.on;
  if (fresh) await chrome.storage.session.set({ on: 1 }).catch(() => {});
  const st = await store.get(['running', 'ui', 'pending', 'config', 'key']);
  if (st.ui) badge(st.ui);
  if (!st.running) { if (st.pending && st.key) report(); return; }
  if (fresh) {
    if (!showOf(st.config).resume) { await stopRun('restart'); return; }
    ui({ note: 'resumed', noteAt: now() });
  }
  // the watch goes on with its own minute (made again only when Chrome lost it: a worker that starts often would put it off forever)
  if (!(await chrome.alarms.get('watch'))) chrome.alarms.create('watch', { periodInMinutes: 1 });
  if (st.pending) chrome.alarms.clear('report'); // the loop sends it first
  loopSafe();
}
