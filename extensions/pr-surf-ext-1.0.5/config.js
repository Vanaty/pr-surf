// Where the extension talks to: the site's API process (api.pr.social). tools/build.js writes the stand's address here for a build of
// the stand (`node tools/build.js stand`); the store build keeps this one.
export const API_BASE = 'https://api.pr.social/api/surf-app';
export const SITE_BASE = 'https://pr.social';
// the number of this version, as the site compares versions (Admin → Surfing App → Versions); it grows with every version of the store
export const VERSION_CODE = 6;
