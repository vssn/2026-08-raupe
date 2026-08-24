#!/usr/bin/env node
'use strict';
/* Entwicklungsserver: buendelt src/game.js (inkl. der npm-Abhaengigkeit
   "three") mit esbuild und liefert das Projektverzeichnis als statische
   Seite aus. Jede Anfrage nach build/game.js baut frisch – kein separater
   Watch-Schritt noetig. */
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8123;

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(ROOT, 'src', 'game.js')],
    bundle: true,
    outfile: path.join(ROOT, 'build', 'game.js'),
    sourcemap: true,
    target: 'es2019',
    logLevel: 'info'
  });

  const served = await ctx.serve({
    servedir: ROOT,
    port: PORT
  });

  console.log('Flügelhunger läuft auf http://localhost:' + served.port + '/index.html');
  console.log('Zum Beenden: Ctrl+C');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
