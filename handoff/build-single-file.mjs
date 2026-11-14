// Builds handoff/Vortex-SC-App.html: the live app (vortex-app/public/proto.html) as ONE file,
// with every local script, font and image inlined, so it can be opened straight from disk or
// handed to a developer without the rest of the repository.
//
//   node handoff/build-single-file.mjs
//
// Data still comes live from Supabase. The few features that call the club's own server
// (/api/...) and Stroke Lab are pointed at https://vortexswimmingclub.com when the file is
// opened from disk; see handoff/README.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'vortex-app', 'public');
const LIVE = 'https://vortexswimmingclub.com';

let html = readFileSync(join(pub, 'proto.html'), 'utf8');

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const dataUri = (rel) => {
  const p = join(pub, rel);
  if (!existsSync(p)) return null;
  return `data:${mime[extname(p)] || 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}`;
};

// 1. Scripts: <script src="assets/x.js"></script>  ->  inline <script>
const inlinedScripts = [];
html = html.replace(/<script(?: defer)? src="(assets\/[^"]+\.js)"><\/script>/g, (m, rel) => {
  const p = join(pub, rel);
  if (!existsSync(p)) return m;
  inlinedScripts.push(rel);
  // "</script" inside a script body would end the tag early
  return `<script>/* ${rel} */\n${readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`;
});

// 1b. support.js (the app runtime) is loaded by a boot() function that waits for onload. Keep
//     that: embed the source as inert text and hand boot() a blob: URL of it.
const SUPPORT = 'assets/support.js';
const bootFrom = `s.src="${SUPPORT}"`;
if (!html.includes(bootFrom)) throw new Error('support.js boot line not found; proto.html changed');
const supportSrc = readFileSync(join(pub, SUPPORT), 'utf8').replace(/<\/script/gi, '<\\/script');
html = html.replace(bootFrom,
  `s.src=URL.createObjectURL(new Blob([document.getElementById("vx-support-src").textContent],{type:"text/javascript"}))`);
// It must exist before boot() can run, so it goes at the top of <head> (see step 5).
const supportTag = `<script type="text/plain" id="vx-support-src">${supportSrc}</script>`;
inlinedScripts.push(SUPPORT + ' (via blob: URL)');

// 2. The 300 KB background pattern appears 13 times; inlining each copy would add 5 MB. It is
//    stored once: as a CSS custom property for styles in the page, and as a JS global for the
//    three print documents that are built as JS strings (lines starting with +').
const PATTERN = 'assets/pattern-transparent.png';
const patternUri = dataUri(PATTERN);
let patternVar = 0, patternJs = 0;
html = html.split('\n').map((line) => {
  if (!line.includes(PATTERN)) return line;
  if (/^\s*\+'/.test(line)) {
    patternJs++;
    return line.replace(/url\((["']?)assets\/pattern-transparent\.png\1\)/g, `url($1'+window.__VX_PATTERN+'$1)`);
  }
  patternVar++;
  return line.replace(/url\((["']?)assets\/pattern-transparent\.png\1\)/g, 'var(--vx-pattern-img)');
}).join('\n');

// 3. Every other image and font: inline as a data URI wherever it is referenced.
const refs = new Map();
for (const m of html.matchAll(/\/?assets\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|ttf|svg)/g)) {
  const rel = m[0].replace(/^\//, '');
  refs.set(rel, (refs.get(rel) || 0) + 1);
}
const missing = [];
const inlined = [`${PATTERN} ×1 (used ${patternVar} via CSS var, ${patternJs} via JS)`];
for (const [rel, count] of refs) {
  const uri = dataUri(rel);
  if (!uri) { missing.push(rel); continue; }
  inlined.push(`${rel} ×${count}`);
  // match "/assets/x" and "assets/x" in one pass so the leading slash goes too
  html = html.replace(new RegExp('/?' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), uri);
}

// 4. Manifest link is meaningless from disk; icons are already inlined above.
html = html.replace(/<link rel="manifest"[^>]*>/, '');

// 5. Shim, first thing in <head>: when opened from disk, send /api calls and Stroke Lab to the
//    live site instead of file:///api/... . On the real site this does nothing.
const shim = `<style>:root{--vx-pattern-img:url("${patternUri}")}</style>
<script>window.__VX_PATTERN=${JSON.stringify(patternUri)};</script>
<script>/* single-file shim (handoff/build-single-file.mjs) */
(function(){
  if (location.protocol !== 'file:') return;
  var LIVE = ${JSON.stringify(LIVE)};
  window.__VX_SINGLE_FILE = true;
  var f = window.fetch;
  window.fetch = function(u, o){
    if (typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/') u = LIVE + u;
    return f.call(this, u, o);
  };
})();
</script>`;
html = html.replace(/<head>/i, (h) => h + '\n' + shim + '\n' + supportTag);
html = html.replace(/strokeLabSrc:'stroke-lab\//, `strokeLabSrc:(location.protocol==='file:'?'${LIVE}/':'')+'stroke-lab/`);

// 6. The orange "STAGING · TEST COPY" bar shows on any host that isn't the club's domain, and a
//    file opened from disk has no host. This file reads the REAL club database, so the bar
//    would be wrong: treat file: as production.
const stagingFrom = "const h=location.hostname; return !(";
if (!html.includes(stagingFrom)) throw new Error('isStagingEnv line not found; proto.html changed');
html = html.replace(stagingFrom, "const h=location.hostname; if(location.protocol==='file:') return false; return !(");

const out = join(here, 'Vortex-SC-App.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`);
console.log('scripts inlined:', inlinedScripts.join(', '));
console.log('assets inlined:', inlined.join(', '));
if (missing.length) console.log('not files (resolved at runtime from window.VX_PHOTOS):', missing.join(', '));
