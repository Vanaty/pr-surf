// The words of the extension. Most of them are the app's own (PR Surf says the same things on a phone and in Chrome): i18n/app/<code>.json,
// the dictionaries the site gives the Android app, packed by the build. A few are the extension's (what only a browser says):
// i18n/ext/<code>.json. The language of the browser chooses; a phrase missing in it is said in English. A count-phrase takes the form
// the language has for the number (Intl.PluralRules): key.one, .two, .few, .many, .zero, falling back to .other.
const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv']);
let words = {}, base = {}, lang = 'en', loading = null;

// the browser's language as the site names its dictionaries (Chrome may still say iw, in, fil, nb)
const codeOf = (tag) => { const c = String(tag || 'en').toLowerCase().split(/[-_]/)[0]; return { iw: 'he', in: 'id', ji: 'yi', fil: 'tl', nb: 'no', nn: 'no' }[c] || c; };
async function file(path) {
  try { const r = await fetch(chrome.runtime.getURL(path)); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

/** Reads the dictionaries once (the popup and the engine each call it before they speak). → the language in use. */
export function ready() {
  if (loading) return loading;
  loading = (async () => {
    const packed = (await file('i18n/langs.json')) || ['en'];
    const want = codeOf((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || (globalThis.navigator && navigator.language));
    lang = packed.includes(want) ? want : 'en';
    const [ae, xe] = await Promise.all([file('i18n/app/en.json'), file('i18n/ext/en.json')]);
    base = Object.assign({}, ae || {}, xe || {});
    if (lang === 'en') words = base;
    else { const [a, x] = await Promise.all([file('i18n/app/' + lang + '.json'), file('i18n/ext/' + lang + '.json')]); words = Object.assign({}, a || {}, x || {}); }
    return lang;
  })();
  return loading;
}

export const langOf = () => lang;
export const isRtl = () => RTL.has(lang);

// a number, a time, a sum of money or a code: one left-to-right piece wherever it stands in a sentence
const numeric = (v) => typeof v === 'number' || (/\d/.test(String(v)) && /^[\d\s.,:+\-$%/\u066b\u066c]+$/.test(String(v)));
/** A number, a time or a sum as one left-to-right piece (isolated): a right-to-left sentence never turns it round. */
export const ltr = (v) => '\u2066' + v + '\u2069';
/** A piece with words of its own (a time with its "AM" or "ص") isolated in the direction of its own first letter: whole in any sentence,
 * and read in the order of its language. */
export const piece = (v) => '\u2068' + v + '\u2069';

/** The phrase of `key` with its {names} filled in. */
export function t(key, args) {
  let s = words[key] != null ? words[key] : base[key] != null ? base[key] : key;
  // a handle (@name) and a number are each one left-to-right piece (isolated), so that a right-to-left sentence does not put the @ after
  // the name, or the minutes of a time before its hours
  for (const k in args || {}) s = String(s).split('@{' + k + '}').join(ltr('@' + args[k])).split('{' + k + '}').join(numeric(args[k]) ? ltr(args[k]) : args[k]);
  return s;
}

/** A phrase of the app that a browser says otherwise ("tap", "the app", "the phone"): the extension's own (ext.<key>) where it has one.
 * A language whose dictionary of the extension lacks it yet says the app's phrase in that language, which is better than English. */
export function tb(key, args) {
  const own = 'ext.' + key;
  return t(words[own] != null ? own : words[key] != null ? key : base[own] != null ? own : key, args);
}

/** A phrase with a number, in the form the language has for that number. A form the language's dictionary lacks (the browser's
 * rules may know one more than the site's) is said in its general form (.other), not in English. */
export function tn(key, n, args) {
  let form = 'other';
  try { form = new Intl.PluralRules(lang).select(n); } catch (e) { /* a language this browser has no rule for: the other form */ }
  const k = [words, base].map((d) => [key + '.' + form, key + '.other'].find((x) => d[x] != null)).find(Boolean) || key + '.other';
  return t(k, Object.assign({ n }, args));
}
