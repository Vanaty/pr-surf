// The page of the window of the sites between two sites: what this window is, in the browser's language.
import { ready, t, isRtl, langOf } from './words.js';
ready().then(() => {
  document.documentElement.lang = langOf(); document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  document.getElementById('t').textContent = t('ext.stage.title');
  document.getElementById('s').textContent = t('ext.stage.sub');
});
