#!/usr/bin/env node
'use strict';
/* Baut aus index.html + style.css + src/game.js (inkl. der npm-Abhaengigkeit
   "three", per esbuild gebuendelt und minimiert) eine einzelne HTML-Datei.

   dist/fluegelhunger.html  – komplette Seite, laeuft per Doppelklick offline
   dist/artifact.html       – nur der Seiteninhalt (fuer Claude-Artifacts, die
                              doctype/head/body selbst ergaenzen)
*/
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE = path.join(ROOT, 'build', 'game.js');

async function bundleGame() {
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'game.js')],
    bundle: true,
    minify: true,
    target: 'es2019',
    outfile: BUNDLE,
    logLevel: 'info'
  });
  return fs.readFileSync(BUNDLE, 'utf8');
}

function buildHtml(game) {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Replacer-Funktionen statt Replacement-Strings: das minifizierte Bundle
  // enthaelt so gut wie sicher "$&" o.ae. (z.B. als Und-Verknuepfung einer
  // $-Variable) - als Replacement-STRING wuerde String.replace() das als
  // Backreference lesen und den Platzhalter mitten im Code wieder einfuegen.
  html = html.replace(
    '<link rel="stylesheet" href="style.css">',
    function () { return '<style>\n' + css + '\n</style>'; }
  );
  html = html.replace(
    '<script src="build/game.js"></script>',
    function () { return '<script>\n' + game + '\n</script>'; }
  );
  return html;
}

function toArtifactInner(html) {
  // Fuer das Artifact nur der Inhalt: doctype/html/head/body liefert der Wrapper.
  let inner = html.replace(/^[\s\S]*?<meta charset="utf-8">\s*/, '');
  inner = inner.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n',
    ''
  );
  inner = inner.replace('</head>\n<body>\n', '');
  inner = inner.replace(/\n<\/body>\n<\/html>\n?$/, '\n');
  return inner;
}

async function main() {
  const game = await bundleGame();

  fs.mkdirSync(DIST, { recursive: true });

  const full = buildHtml(game);
  fs.writeFileSync(path.join(DIST, 'fluegelhunger.html'), full, 'utf8');
  fs.writeFileSync(path.join(DIST, 'artifact.html'), toArtifactInner(full), 'utf8');

  for (const f of ['fluegelhunger.html', 'artifact.html']) {
    const size = fs.statSync(path.join(DIST, f)).size;
    console.log(f.padEnd(22) + (size / 1024).toFixed(0).padStart(7) + ' KB');
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
