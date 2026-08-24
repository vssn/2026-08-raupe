/* Flügelhunger – ein Raupen-Spiel in 2.5D  (three.js r149) */
import * as THREE from 'three';

(function () {
'use strict';
var T = THREE;

/* ============================== KONFIGURATION ============================== */
var GRID = 25;                    // Felder pro Seite – ein kleiner Park statt einer Stube
var HALF = (GRID - 1) / 2;
var START_TIME = 100;             // Sekunden – etwas mehr Zeit fuer den groesseren Park
var GOAL = 20;                    // Punkte bis zur Verpuppung
var STEP_BASE = 0.185;            // Sekunden pro Feld
var TRAIL_STEP = 0.12;            // Abstand der Spurpunkte
var ITEMS_ON_FIELD = 6;

var FOOD = {
  klee:   { pts: 1, secs: 0, weight: 58, color: 0x5bbf4e, emoji: '🍀', label: 'Klee' },
  bluete: { pts: 2, secs: 0, weight: 24, color: 0xf2749f, emoji: '🌸', label: 'Blüte' },
  beere:  { pts: 3, secs: 3, weight: 13, color: 0x6d7ee8, emoji: '🫐', label: 'Beere' },
  gold:   { pts: 5, secs: 0, weight: 5,  color: 0xf7b733, emoji: '✨', label: 'Goldblatt' }
};
var FOOD_KEYS = Object.keys(FOOD);

/* ================================ HELFER ================================== */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t * t; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function wx(gx) { return (gx - HALF); }
function wz(gz) { return (gz - HALF); }
function key(c) { return c.x + ':' + c.z; }

/* Toon-Verlaufskarte: harte Lichtstufen für den Kinderbuch-Look */
function gradientMap(steps) {
  var data = new Uint8Array(steps);
  for (var i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  var tex = new T.DataTexture(data, steps, 1, T.RedFormat);
  tex.minFilter = tex.magFilter = T.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
var GRAD3, GRAD4;

function toon(color, opts) {
  var m = new T.MeshToonMaterial({ color: color, gradientMap: GRAD3 });
  if (opts) for (var k in opts) {
    if (m[k] && m[k].isColor) m[k].set(opts[k]); else m[k] = opts[k];
  }
  return m;
}
var OUTLINE_MAT = null;
function addOutline(mesh, k) {          /* Kontur als Kind: erbt die Skalierung des Elternteils */
  var o = new T.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.setScalar(k || 1.14);
  mesh.add(o);
  return mesh;
}
function outlineFor(mesh, thickness) {
  var o = new T.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.multiplyScalar(thickness || 1.13);
  o.renderOrder = -1;
  return o;
}

/* ============================== AUDIO (WebAudio) ========================== */
var Audio2 = {
  ctx: null, on: true,
  boot: function () {
    if (!this.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.on && this.ctx) Music.start();
  },
  tone: function (freq, dur, type, vol, delay) {
    if (!this.on || !this.ctx) return;
    var c = this.ctx, t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  eat: function (kind) {
    var base = { klee: 520, bluete: 620, beere: 700, gold: 840 }[kind] || 520;
    this.tone(base, 0.09, 'triangle', 0.14);
    this.tone(base * 1.5, 0.12, 'triangle', 0.11, 0.07);
    if (kind === 'gold') this.tone(base * 2.25, 0.2, 'sine', 0.1, 0.15);
  },
  bump: function () {
    this.tone(150, 0.16, 'square', 0.11);
    this.tone(96, 0.26, 'sawtooth', 0.08, 0.05);
  },
  pupate: function () {
    [392, 494, 587, 784].forEach(function (f, i) { Audio2.tone(f, 0.7, 'sine', 0.09, i * 0.14); });
  },
  win: function () {
    [523, 659, 784, 1046, 1318].forEach(function (f, i) {
      Audio2.tone(f, 0.5, 'triangle', 0.12, i * 0.11);
    });
  },
  tick: function () { this.tone(880, 0.06, 'sine', 0.07); }
};

/* ================================ MUSIK ==================================== */
/* Ein leises, freundliches Loop-Stueckchen im Hintergrund: eine weiche
   Akkorddecke (I – vi – IV – V, klassisch und immer konsonant) unter einer
   kleinen Melodie in Dur-Pentatonik. Alles ueber WebAudio geplant, kein
   Audiofile noetig – passt zum Rest der Klangkulisse. */
var Music = {
  playing: false, timer: null,
  tempo: 96,
  scale: [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25], // C4-Dur bis C5
  chords: [
    [130.81, 164.81, 196.00],   // C
    [110.00, 130.81, 164.81],   // Am
    [174.61, 220.00, 261.63],   // F
    [196.00, 246.94, 293.66]    // G
  ],
  pattern: [0, 2, 4, 2, 3, 2, 1, 0, 2, 4, 7, 4, 3, 2, 1, null],

  start: function () {
    if (this.playing || !Audio2.ctx) return;
    this.playing = true;
    this.scheduleLoop(Audio2.ctx.currentTime + 0.12);
  },
  stop: function () {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  },

  pad: function (t, dur, freqs) {
    var c = Audio2.ctx;
    freqs.forEach(function (f) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.032, t + dur * 0.35);
      g.gain.setValueAtTime(0.032, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    });
  },
  pluck: function (t, freq, dur) {
    var c = Audio2.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.065, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },

  scheduleLoop: function (t0) {
    if (!this.playing) return;
    var beat = 60 / this.tempo, i;
    for (i = 0; i < 4; i++) this.pad(t0 + i * beat * 8, beat * 8 * 1.02, this.chords[i]);
    for (i = 0; i < 32; i++) {
      var step = this.pattern[i % 16];
      if (step !== null) this.pluck(t0 + i * beat, this.scale[step], beat * 0.85);
    }
    var loopLen = beat * 32, self = this;
    this.timer = setTimeout(function () { self.scheduleLoop(t0 + loopLen); }, (loopLen - 0.2) * 1000);
  }
};

/* ============================ RENDERER & SZENE ============================ */
var canvas = document.getElementById('scene');
if (T.ColorManagement) T.ColorManagement.legacyMode = false;
var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputEncoding = T.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;

GRAD3 = gradientMap(3); GRAD4 = gradientMap(4);
OUTLINE_MAT = new T.MeshBasicMaterial({ color: 0x244a1c, side: T.BackSide });

var scene = new T.Scene();
scene.background = new T.Color(0x9fdcf5);
scene.fog = new T.Fog(0xa9e2f7, 46, 96);

var shake = 0;
var camera = new T.PerspectiveCamera(46, 1, 0.1, 200);
var camTarget = new T.Vector3(0, 0, 0.6);
var camState = { tilt: 58, dist: 30, yaw: 0, target: camTarget.clone() };
/* Waehrend des Spiels haengt die Kamera dicht an der Raupe – man sieht nur
   einen Ausschnitt des Parks und muss nach Blaettern und dem Kokon suchen.
   Die Uebersicht (baseDist) bleibt dem Start- und dem Ende-Bildschirm vorbehalten. */
var PLAY_DIST = 10.5, PLAY_TILT = 50;

function placeCamera(now) {
  var a = camState.tilt * Math.PI / 180, y = camState.yaw || 0;
  var horiz = Math.cos(a) * camState.dist;
  var sx = 0, sy = 0;
  if (shake > 0) { sx = Math.sin((now || 0) * 47) * shake * 0.3; sy = Math.cos((now || 0) * 39) * shake * 0.22; }
  camera.position.set(camState.target.x + Math.sin(y) * horiz + sx,
                      camState.target.y + Math.sin(a) * camState.dist + sy,
                      camState.target.z + Math.cos(y) * horiz);
  camera.lookAt(camState.target);
}

var baseDist = 30;
function resize() {
  var w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  /* Im Hochformat begrenzt die Breite den Ausschnitt. Ein weiterer Blickwinkel
     holt die Kamera naeher heran, sonst wirkt die Wiese flach wie ein Teleobjektiv. */
  camera.fov = camera.aspect < 1 ? clamp(46 + (1 - camera.aspect) * 26, 46, 62) : 46;
  var R = HALF + 2.2;                             // halbe Feldbreite inkl. Hecke
  var vfov = camera.fov * Math.PI / 180;
  var needV = R / Math.tan(vfov / 2) * 0.92;      // Vertikale ist durch die Neigung gestaucht
  var needH = R / Math.tan(Math.atan(Math.tan(vfov / 2) * camera.aspect));
  baseDist = Math.max(needV, needH) * 1.06;
  if (state === 'menu' || state === 'timeup') camState.dist = baseDist;
  camera.updateProjectionMatrix();
  placeCamera();
}
addEventListener('resize', resize);

/* --------------------------------- Licht -------------------------------- */
var sun = new T.DirectionalLight(0xfff4d6, 1.7);
sun.position.set(-8.5, 13.5, 6.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 48;
sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
scene.add(new T.HemisphereLight(0xcdefff, 0x6d9a4a, 0.35));
scene.add(new T.AmbientLight(0xffffff, 0.18));

/* -------------------------------- Wiese --------------------------------- */
function grassTexture() {
  var s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  var g = c.getContext('2d');
  g.fillStyle = '#a7d977'; g.fillRect(0, 0, s, s);
  var i, x, y, r;
  for (i = 0; i < 2600; i++) {                    // Farbtupfer
    x = Math.random() * s; y = Math.random() * s; r = 2 + Math.random() * 12;
    g.fillStyle = ['rgba(190,225,145,.5)', 'rgba(150,200,105,.45)',
                   'rgba(205,232,160,.4)', 'rgba(133,187,95,.3)'][(Math.random() * 4) | 0];
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (i = 0; i < 900; i++) {                     // Grashalme
    x = Math.random() * s; y = Math.random() * s;
    g.strokeStyle = 'rgba(120,175,85,' + (0.25 + Math.random() * 0.3) + ')';
    g.lineWidth = 1 + Math.random();
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + rnd(-4, 4), y - 7, x + rnd(-7, 7), y - 13); g.stroke();
  }
  var tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(20, 20);
  tex.encoding = T.sRGBEncoding;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

var ground = new T.Mesh(
  new T.PlaneGeometry(120, 120),
  new T.MeshLambertMaterial({ map: grassTexture(), color: 0xffffff })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

/* Sanftes Schachbrett – hilft beim Abschätzen der Felder, ohne laut zu sein */
(function mowStripes() {
  var geo = new T.PlaneGeometry(1, 1);
  var mat = new T.MeshBasicMaterial({ color: 0x3f7f36, transparent: true, opacity: 0.09 });
  var mesh = new T.InstancedMesh(geo, mat, Math.ceil(GRID * GRID / 2));
  var m = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0));
  var s = new T.Vector3(1, 1, 1), p = new T.Vector3(), n = 0;
  for (var gx = 0; gx < GRID; gx++) for (var gz = 0; gz < GRID; gz++) {
    if ((gx + gz) % 2) continue;
    p.set(wx(gx), 0.005, wz(gz));
    m.compose(p, q, s); mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
})();

/* --------------------------- Hecke & Dekoration -------------------------- */
var BUSH_GEO = new T.SphereGeometry(1, 12, 9);
var hedgeMats = [toon(0x3f8f3d), toon(0x357f36), toon(0x4aa04a)];

function bush(x, z, r, matIdx) {
  var b = new T.Mesh(BUSH_GEO, hedgeMats[matIdx % 3]);
  b.position.set(x, r * 0.62, z);
  b.scale.set(r, r * 0.95, r);
  b.castShadow = true; b.receiveShadow = true;
  return b;
}

(function hedge() {
  var g = new T.Group(), n = 0, lim = HALF + 1;
  function ring(radius, minR, maxR, y) {
    for (var i = -radius; i <= radius; i += 0.5) {
      var spots = [[i, -radius], [i, radius], [-radius, i], [radius, i]];
      for (var t = 0; t < 4; t++) {
        var r = rnd(minR, maxR);
        var b = bush(spots[t][0] + rnd(-0.12, 0.12), spots[t][1] + rnd(-0.12, 0.12), r, n++);
        b.position.y = r * y + rnd(-0.05, 0.12);
        g.add(b);
      }
    }
  }
  ring(lim + 0.65, 0.66, 0.95, 0.42);   // hintere, hoehere Reihe
  ring(lim, 0.5, 0.74, 0.5);            // vordere Reihe
  scene.add(g);
})();

/* Blumen, Pilze, Steine ausserhalb des Spielfelds */
(function decor() {
  var g = new T.Group();
  var stemGeo = new T.CylinderGeometry(0.045, 0.06, 1, 6);
  var petalGeo = new T.SphereGeometry(0.16, 8, 6);
  var capGeo = new T.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  var stalkGeo = new T.CylinderGeometry(0.11, 0.14, 0.42, 8);
  var rockGeo = new T.DodecahedronGeometry(0.3, 0);
  var stemMat = toon(0x4f9b46), rockMat = toon(0xb9b1a4),
      capMat = toon(0xe0574f), stalkMat = toon(0xfaf3e2);
  var flowerCols = [0xffd447, 0xf58ec1, 0xfff1f5, 0x9d7ae0, 0xff9a55];
  var lim = HALF + 1.9;

  var decorCount = Math.round(190 * (HALF / 9));
  for (var i = 0; i < decorCount; i++) {
    var a = Math.random() * Math.PI * 2, d = lim + Math.pow(Math.random(), 0.6) * 18;
    var x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) < lim && Math.abs(z) < lim) continue;
    var kind = Math.random();
    if (kind < 0.55) {
      var h = rnd(0.5, 0.95), f = new T.Group();
      var st = new T.Mesh(stemGeo, stemMat);
      st.scale.y = h; st.position.y = h / 2; f.add(st);
      var col = toon(pick(flowerCols));
      for (var p = 0; p < 5; p++) {
        var pe = new T.Mesh(petalGeo, col);
        pe.position.set(Math.cos(p / 5 * 7) * 0.17, h, Math.sin(p / 5 * 7) * 0.17);
        pe.scale.set(1, 0.6, 1); f.add(pe);
      }
      var mid = new T.Mesh(petalGeo, toon(0xfff0a8));
      mid.position.y = h + 0.04; mid.scale.setScalar(0.62); f.add(mid);
      f.position.set(x, 0, z); f.rotation.y = Math.random() * 7;
      f.children.forEach(function (c) { c.castShadow = true; });
      g.add(f);
    } else if (kind < 0.78) {
      var mu = new T.Group();
      var stalk = new T.Mesh(stalkGeo, stalkMat); stalk.position.y = 0.2; mu.add(stalk);
      var cap = new T.Mesh(capGeo, capMat); cap.position.y = 0.4; mu.add(cap);
      mu.scale.setScalar(rnd(0.7, 1.25));
      mu.position.set(x, 0, z);
      mu.children.forEach(function (c) { c.castShadow = true; });
      g.add(mu);
    } else {
      var ro = new T.Mesh(rockGeo, rockMat);
      ro.position.set(x, 0.1, z);
      ro.scale.set(rnd(0.6, 1.3), rnd(0.4, 0.8), rnd(0.6, 1.3));
      ro.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      ro.castShadow = true; ro.receiveShadow = true;
      g.add(ro);
    }
  }
  scene.add(g);
})();

/* Ein paar hohe Bäume am Horizont */
(function trees() {
  var trunkGeo = new T.CylinderGeometry(0.34, 0.5, 3.2, 8);
  var trunkMat = toon(0x8a6141);
  var crownGeo = new T.IcosahedronGeometry(1, 0);
  var treeCount = Math.round(18 * (HALF / 9));
  for (var i = 0; i < treeCount; i++) {
    var a = Math.random() * Math.PI * 2, d = rnd(HALF + 10, HALF + 18);
    var t = new T.Group();
    var tr = new T.Mesh(trunkGeo, trunkMat); tr.position.y = 1.6; t.add(tr);
    var cm = toon([0x3d8b3a, 0x49a044, 0x2f7a34][(Math.random() * 3) | 0]);
    for (var b = 0; b < 4; b++) {
      var cr = new T.Mesh(crownGeo, cm);
      cr.position.set(rnd(-0.8, 0.8), rnd(3.1, 4.4), rnd(-0.8, 0.8));
      cr.scale.setScalar(rnd(0.9, 1.7));
      cr.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      t.add(cr);
    }
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.scale.setScalar(rnd(0.85, 1.4));
    scene.add(t);
  }
})();

/* ============================== FUTTER-MODELLE ============================ */
var BLOB_GEO = new T.SphereGeometry(1, 12, 9);
var STEM_GEO = new T.CylinderGeometry(0.035, 0.05, 1, 6);

function leafGeometry() {
  var sh = new T.Shape();
  sh.moveTo(0, -0.5);
  sh.quadraticCurveTo(0.52, -0.12, 0, 0.62);
  sh.quadraticCurveTo(-0.52, -0.12, 0, -0.5);
  var geo = new T.ExtrudeGeometry(sh, {
    depth: 0.07, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2, curveSegments: 10
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  return geo;
}
var LEAF_GEO = leafGeometry();

function makeKlee() {
  var g = new T.Group(), mat = toon(0x46b02e), dark = toon(0x2f7d24);
  var st = new T.Mesh(STEM_GEO, dark);
  st.scale.y = 0.42; st.position.y = 0.21; g.add(st);
  for (var i = 0; i < 3; i++) {
    var a = i / 3 * Math.PI * 2;
    var l = new T.Mesh(LEAF_GEO, mat);
    l.position.set(Math.cos(a) * 0.26, 0.44, Math.sin(a) * 0.26);
    l.rotation.set(-0.22, -a + Math.PI / 2, 0);
    l.scale.set(0.62, 0.62, 0.62);
    l.castShadow = true;
    addOutline(l, 1.13);
    g.add(l);
  }
  return g;
}

function makeBluete() {
  var g = new T.Group();
  var petal = toon(0xf2749f), core = toon(0xffe06b), stemM = toon(0x4f9b46);
  var st = new T.Mesh(STEM_GEO, stemM);
  st.scale.y = 0.45; st.position.y = 0.22; g.add(st);
  for (var i = 0; i < 6; i++) {
    var p = new T.Mesh(BLOB_GEO, petal);
    var a = i / 6 * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.2, 0.46, Math.sin(a) * 0.2);
    p.scale.set(0.19, 0.1, 0.24);
    p.rotation.y = -a;
    p.castShadow = true;
    addOutline(p, 1.12);
    g.add(p);
  }
  var c = new T.Mesh(BLOB_GEO, core);
  c.position.y = 0.5; c.scale.set(0.14, 0.11, 0.14); c.castShadow = true;
  g.add(c);
  return g;
}

function makeBeere() {
  var g = new T.Group();
  var berry = toon(0x6d7ee8), leafM = toon(0x4f9b46), shine = new T.MeshBasicMaterial({ color: 0xd7dcff });
  var b = new T.Mesh(BLOB_GEO, berry);
  b.position.y = 0.34; b.scale.setScalar(0.32); b.castShadow = true;
  addOutline(b, 1.1);
  g.add(b);
  var b2 = new T.Mesh(BLOB_GEO, berry);
  b2.position.set(0.22, 0.26, 0.12); b2.scale.setScalar(0.2); b2.castShadow = true;
  g.add(b2);
  var s = new T.Mesh(BLOB_GEO, shine);
  s.position.set(-0.1, 0.48, 0.12); s.scale.setScalar(0.07);
  g.add(s);
  var l = new T.Mesh(LEAF_GEO, leafM);
  l.position.set(-0.16, 0.56, -0.12); l.scale.setScalar(0.42);
  l.rotation.set(0.2, 0.6, 0.3);
  g.add(l);
  return g;
}

function makeGold() {
  var g = new T.Group();
  var goldM = toon(0xf7b733, { emissive: 0x6b4a00 });
  var l = new T.Mesh(LEAF_GEO, goldM);
  l.position.y = 0.42; l.scale.setScalar(0.95); l.castShadow = true;
  l.rotation.z = 0.35;
  addOutline(l, 1.1);
  g.add(l);
  var ring = new T.Mesh(new T.RingGeometry(0.36, 0.46, 20),
    new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.75, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  g.add(ring);
  g.userData.ring = ring;
  for (var i = 0; i < 3; i++) {
    var sp = new T.Mesh(BLOB_GEO, new T.MeshBasicMaterial({ color: 0xfff3c4 }));
    sp.scale.setScalar(0.055);
    sp.userData.a = i / 3 * Math.PI * 2;
    g.add(sp);
    (g.userData.sparks = g.userData.sparks || []).push(sp);
  }
  return g;
}

var MAKERS = { klee: makeKlee, bluete: makeBluete, beere: makeBeere, gold: makeGold };
var FOOD_SCALE = { klee: 1.5, bluete: 1.4, beere: 1.35, gold: 1.3 };

/* ============================== KOKON-MODELL ============================= */
function makeCocoon() {
  var g = new T.Group();
  var twigMat = toon(0x8a6141), leafMat = toon(0x46b02e);

  var twig = new T.Mesh(new T.CylinderGeometry(0.075, 0.1, 1.7, 7), twigMat);
  twig.position.set(-0.32, 0.85, 0); twig.rotation.z = 0.06;
  twig.castShadow = true; g.add(twig);
  var arm = new T.Mesh(new T.CylinderGeometry(0.05, 0.075, 0.95, 7), twigMat);
  arm.position.set(0.05, 1.6, 0); arm.rotation.z = -1.15;
  arm.castShadow = true; g.add(arm);
  for (var i = 0; i < 2; i++) {                       /* zwei Blaetter am Ast */
    var lf = new T.Mesh(LEAF_GEO, leafMat);
    lf.position.set(-0.45 + i * 0.16, 1.15 + i * 0.42, i ? 0.24 : -0.26);
    lf.rotation.set(-0.5, i ? 1.1 : -0.9, 0.4);
    lf.scale.setScalar(0.5);
    lf.castShadow = true;
    addOutline(lf, 1.12);
    g.add(lf);
  }

  var shell = new T.Group();
  var body = new T.Mesh(BLOB_GEO, toon(0x9ad95c, { emissive: 0x2a4a12 }));
  body.scale.set(0.3, 0.44, 0.3); body.castShadow = true;
  addOutline(body, 1.09);
  shell.add(body);
  var tip = new T.Mesh(new T.ConeGeometry(0.2, 0.34, 12), toon(0xb6e878));
  tip.position.y = -0.44; tip.rotation.x = Math.PI; shell.add(tip);
  var crown = new T.Mesh(new T.TorusGeometry(0.23, 0.045, 7, 16), toon(0xf7d24b));
  crown.rotation.x = Math.PI / 2; crown.position.y = 0.32; shell.add(crown);
  shell.position.set(0.42, 1.0, 0);
  g.add(shell);
  g.userData.shell = shell;

  /* Lichtsaeule + Ring, damit das Ziel von oben sofort auffaellt */
  var beam = new T.Mesh(new T.CylinderGeometry(0.52, 0.72, 3.2, 18, 1, true),
    new T.MeshBasicMaterial({ color: 0xffe067, transparent: true, opacity: 0.2,
      side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
  beam.position.set(0.42, 1.6, 0);
  g.add(beam);
  g.userData.beam = beam;

  var halo = new T.Mesh(new T.RingGeometry(0.52, 0.86, 30),
    new T.MeshBasicMaterial({ color: 0xffcf3d, transparent: true, opacity: 0.85,
      side: T.DoubleSide, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.set(0.42, 0.05, 0);
  g.add(halo);
  g.userData.halo = halo;

  g.userData.orbit = [];
  for (var k = 0; k < 5; k++) {
    var sp = new T.Mesh(BLOB_GEO, new T.MeshBasicMaterial({ color: 0xfff3c4 }));
    sp.scale.setScalar(0.07);
    sp.userData.a = k / 5 * Math.PI * 2;
    g.add(sp);
    g.userData.orbit.push(sp);
  }
  return g;
}

/* ============================ SPIELFELD & HINDERNISSE ===================== */
/* Ein kleiner Park statt einer leeren Stube: Teiche, Buesche, Felsen und
   Baeumchen blockieren einzelne Feldergruppen. Ihre Kollisionsflaeche wird
   einmal beim Laden berechnet (Set aus "x:z"-Schluesseln) und bleibt fuer die
   ganze Sitzung stehen – der Park hat eine wiedererkennbare Form, so wie ein
   echter Park nicht bei jedem Besuch umgebaut wird. */
var Obstacles = new Set();
var Reachable = null;
var SPAWN = { x: HALF | 0, z: HALF | 0 };

function blockCell(gx, gz) {
  if (gx >= 0 && gx < GRID && gz >= 0 && gz < GRID) Obstacles.add(key({ x: gx, z: gz }));
}
function isBlocked(c) { return Obstacles.has(key(c)); }
function isReachable(c) { return !!Reachable && Reachable.has(key(c)); }

/* Rund um den Start bleibt immer Platz: dort liegt der Anfangskoerper, und
   dort soll die Raupe losfahren koennen, ohne sofort vor etwas zu stehen. */
function inSafeZone(gx, gz) {
  return gx >= SPAWN.x - 11 && gx <= SPAWN.x + 6 && gz >= SPAWN.z - 3 && gz <= SPAWN.z + 3;
}

/* Sucht eine freie Stelle fuer ein Feature mit gegebenem Radius, haelt Abstand
   zu bereits platzierten Features, zum Spawn und zum Feldrand. */
var featureSpots = [];
function findSpot(extent, minGap) {
  var margin = Math.ceil(extent) + 1;
  for (var tries = 0; tries < 250; tries++) {
    var gx = margin + Math.floor(Math.random() * (GRID - margin * 2));
    var gz = margin + Math.floor(Math.random() * (GRID - margin * 2));
    if (inSafeZone(gx, gz)) continue;
    var ok = true;
    for (var i = 0; i < featureSpots.length; i++) {
      var f = featureSpots[i];
      if (Math.hypot(gx - f.x, gz - f.z) < extent + f.r + minGap) { ok = false; break; }
    }
    if (!ok) continue;
    featureSpots.push({ x: gx, z: gz, r: extent });
    return { x: gx, z: gz };
  }
  return null;
}

/* -------------------------------- Teiche --------------------------------- */
/* Organische Blob-Kontur: ein Kreis, den mehrere Sinuswellen verbeulen. Fuer
   Wasserflaeche und Uferrand wird dieselbe Kontur zweimal leicht anders
   skaliert verwendet, damit der Rand wie ein schmaler Streifen Ufer wirkt. */
function blobShape(seed, irregularity) {
  var n = 22, pts = [];
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2;
    var r = 1 + irregularity * (
      Math.sin(a * 3 + seed) * 0.55 + Math.sin(a * 5 + seed * 1.7) * 0.28 + Math.sin(a * 2 + seed * 0.6) * 0.35
    );
    pts.push(new T.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  var sh = new T.Shape();
  sh.moveTo(pts[0].x, pts[0].y);
  sh.splineThru(pts.slice(1).concat([pts[0]]));
  return sh;
}

var WATER_MAT = new T.MeshPhysicalMaterial({
  color: 0x3f8fc9, transparent: true, opacity: 0.86,
  roughness: 0.22, metalness: 0.04, clearcoat: 0.55, clearcoatRoughness: 0.35,
  side: T.DoubleSide
});

function buildPond(cx, cz, rx, rz, seed) {
  var g = new T.Group();

  var bankGeo = new T.ShapeGeometry(blobShape(seed, 0.16), 20);
  bankGeo.rotateX(-Math.PI / 2);
  var bank = new T.Mesh(bankGeo, toon(0x8d9a5c));
  bank.scale.set(rx * 1.24, 1, rz * 1.24);
  bank.position.set(wx(cx), 0.012, wz(cz));
  bank.receiveShadow = true;
  g.add(bank);

  var waterGeo = new T.ShapeGeometry(blobShape(seed + 0.6, 0.13), 20);
  waterGeo.rotateX(-Math.PI / 2);
  var water = new T.Mesh(waterGeo, WATER_MAT);
  water.scale.set(rx * 1.05, 1, rz * 1.05);
  water.position.set(wx(cx), 0.026, wz(cz));
  g.add(water);
  g.userData.water = water;

  var padCount = 1 + Math.round(Math.min(rx, rz));
  for (var i = 0; i < padCount; i++) {
    var a = Math.random() * Math.PI * 2, d = Math.random() * Math.min(rx, rz) * 0.5;
    var pad = new T.Mesh(new T.CircleGeometry(0.2, 10), toon(0x4c9a4a));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(wx(cx) + Math.cos(a) * d * rx / Math.min(rx, rz),
                     0.033, wz(cz) + Math.sin(a) * d * rz / Math.min(rx, rz));
    g.add(pad);
    if (Math.random() < 0.6) {
      var fl = new T.Mesh(BLOB_GEO, toon(0xfffaf0));
      fl.position.set(pad.position.x, 0.062, pad.position.z);
      fl.scale.set(0.07, 0.045, 0.07);
      g.add(fl);
    }
  }

  var reedMat = toon(0x5a9a4a);
  for (var r = 0; r < 3; r++) {
    var ra = Math.random() * Math.PI * 2;
    var rx2 = wx(cx) + Math.cos(ra) * rx * 1.16, rz2 = wz(cz) + Math.sin(ra) * rz * 1.16;
    for (var k = 0; k < 3; k++) {
      var reed = new T.Mesh(new T.CylinderGeometry(0.018, 0.03, rnd(0.5, 0.85), 5), reedMat);
      reed.position.set(rx2 + rnd(-0.12, 0.12), reed.geometry.parameters.height / 2, rz2 + rnd(-0.12, 0.12));
      reed.rotation.z = rnd(-0.12, 0.12);
      reed.castShadow = true;
      g.add(reed);
    }
  }

  scene.add(g);
  g.userData.seed = seed;
  return g;
}

var ponds = [];
function placePond(rx, rz, seed) {
  var spot = findSpot(Math.max(rx, rz), 2.2);
  if (!spot) return;
  for (var gx = Math.floor(spot.x - rx); gx <= Math.ceil(spot.x + rx); gx++)
    for (var gz = Math.floor(spot.z - rz); gz <= Math.ceil(spot.z + rz); gz++) {
      var dx = (gx - spot.x) / rx, dz = (gz - spot.z) / rz;
      if (dx * dx + dz * dz <= 1) blockCell(gx, gz);
    }
  ponds.push(buildPond(spot.x, spot.z, rx, rz, seed));
}

/* ---------------------- Buesche, Felsen, kleine Baeume -------------------- */
/* Kleine Blob-Muster (2–4 Felder), zufaellig gedreht/gespiegelt platziert –
   das wirkt gewachsen statt gerastert. */
var BUSH_PATTERNS = [
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [-1, 0], [0, 1]],
  [[0, 0], [1, 0], [-1, 0]]
];
var ROCK_PATTERNS = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]]];
var TREE_PATTERNS = [[[0, 0]]];

function transformPattern(pat, rot, mirror) {
  return pat.map(function (p) {
    var x = p[0], z = p[1];
    if (mirror) x = -x;
    for (var r = 0; r < rot; r++) { var nx = -z, nz = x; x = nx; z = nz; }
    return [x, z];
  });
}
function placeCluster(patterns, extent, minGap) {
  var spot = findSpot(extent, minGap);
  if (!spot) return null;
  var pat = transformPattern(pick(patterns), (Math.random() * 4) | 0, Math.random() < 0.5);
  var cells = pat.map(function (p) {
    var c = { x: spot.x + p[0], z: spot.z + p[1] };
    blockCell(c.x, c.z);
    return c;
  });
  return { center: spot, cells: cells };
}

var PARK_BUSH_MATS = [toon(0x3a8f52), toon(0x2f7a45), toon(0x4aa060)];
function buildBushCluster(feature) {
  var g = new T.Group();
  feature.cells.forEach(function (cell) {
    var n = 1 + ((Math.random() * 2) | 0);
    for (var k = 0; k < n; k++) {
      var r = rnd(0.42, 0.68);
      var b = bush(wx(cell.x) + rnd(-0.26, 0.26), wz(cell.z) + rnd(-0.26, 0.26), r, k);
      b.material = pick(PARK_BUSH_MATS);
      b.position.y = r * 0.55 + rnd(-0.04, 0.08);
      g.add(b);
      if (Math.random() < 0.4) {
        for (var berry = 0; berry < 3; berry++) {
          var be = new T.Mesh(BLOB_GEO, toon(0xd3435a));
          var a = Math.random() * Math.PI * 2;
          be.position.set(b.position.x + Math.cos(a) * r * 0.75, b.position.y + rnd(0, r * 0.6),
                          b.position.z + Math.sin(a) * r * 0.75);
          be.scale.setScalar(0.055);
          g.add(be);
        }
      }
    }
  });
  scene.add(g);
}

var ROCK_GEO = new T.DodecahedronGeometry(1, 0);
var PARK_ROCK_MATS = [toon(0xb9b1a4), toon(0xa39c8f), toon(0xc4beae)];
function buildRockCluster(feature) {
  var g = new T.Group();
  feature.cells.forEach(function (cell) {
    var sx = rnd(0.55, 0.85), sy = rnd(0.4, 0.62), sz = rnd(0.55, 0.85);
    var ro = new T.Mesh(ROCK_GEO, pick(PARK_ROCK_MATS));
    ro.scale.set(sx, sy, sz);
    ro.position.set(wx(cell.x) + rnd(-0.15, 0.15), sy * 0.5, wz(cell.z) + rnd(-0.15, 0.15));
    ro.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    ro.castShadow = true; ro.receiveShadow = true;
    g.add(ro);
    if (Math.random() < 0.5) {
      var msy = sy * 0.5;
      var mini = new T.Mesh(ROCK_GEO, pick(PARK_ROCK_MATS));
      mini.scale.set(sx * 0.45, msy, sz * 0.45);
      mini.position.set(ro.position.x + rnd(-0.32, 0.32), msy * 0.5, ro.position.z + rnd(-0.32, 0.32));
      mini.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mini.castShadow = true;
      g.add(mini);
    }
  });
  scene.add(g);
}

function buildParkTree(cx, cz) {
  var g = new T.Group();
  var h = rnd(1.5, 2.1);
  var trunk = new T.Mesh(new T.CylinderGeometry(0.14, 0.19, h, 8), toon(0x8a6141));
  trunk.position.y = h / 2; trunk.castShadow = true;
  g.add(trunk);
  var crownCol = toon(pick([0x4aa044, 0x3d8b3a, 0x5bb84f]));
  var blossom = Math.random() < 0.4;
  var n = 3 + ((Math.random() * 2) | 0);
  for (var i = 0; i < n; i++) {
    var cr = new T.Mesh(new T.IcosahedronGeometry(1, 0), crownCol);
    cr.position.set(rnd(-0.35, 0.35), h + rnd(0.15, 0.55), rnd(-0.35, 0.35));
    cr.scale.setScalar(rnd(0.5, 0.8));
    cr.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    cr.castShadow = true;
    g.add(cr);
    if (blossom) {
      for (var b = 0; b < 4; b++) {
        var bl = new T.Mesh(BLOB_GEO, toon(0xf6a9c9));
        bl.position.set(cr.position.x + rnd(-0.4, 0.4), cr.position.y + rnd(-0.3, 0.3), cr.position.z + rnd(-0.4, 0.4));
        bl.scale.setScalar(0.06);
        g.add(bl);
      }
    }
  }
  g.position.set(wx(cx), 0, wz(cz));
  scene.add(g);
}

/* -------------------------------- Aufbau ---------------------------------- */
(function buildPark() {
  var ponds2 = [{ rx: 2.6, rz: 1.9 }, { rx: 1.6, rz: 1.3 }];
  ponds2.forEach(function (p, i) { placePond(p.rx, p.rz, i * 3.7 + 1.2); });

  for (var i = 0; i < 4; i++) {
    var b = placeCluster(BUSH_PATTERNS, 1.5, 1.6);
    if (b) buildBushCluster(b);
  }
  for (i = 0; i < 5; i++) {
    var r = placeCluster(ROCK_PATTERNS, 1.0, 1.3);
    if (r) buildRockCluster(r);
  }
  for (i = 0; i < 6; i++) {
    var t = placeCluster(TREE_PATTERNS, 0.9, 1.2);
    if (t) buildParkTree(t.center.x, t.center.z);
  }

  /* Ueberschwemmungspruefung: nur Felder, die von der Startzelle aus
     erreichbar sind, gelten fuer Futter- und Kokon-Spawn als frei. So
     entstehen nie Inseln, auf denen ein Blatt liegt, das nie erreichbar ist. */
  var seen = new Set(), q = [SPAWN];
  seen.add(key(SPAWN));
  while (q.length) {
    var c = q.pop();
    var nbrs = [{ x: c.x + 1, z: c.z }, { x: c.x - 1, z: c.z }, { x: c.x, z: c.z + 1 }, { x: c.x, z: c.z - 1 }];
    for (var ni = 0; ni < 4; ni++) {
      var n = nbrs[ni];
      if (n.x < 0 || n.x >= GRID || n.z < 0 || n.z >= GRID) continue;
      var k = key(n);
      if (seen.has(k) || isBlocked(n)) continue;
      seen.add(k); q.push(n);
    }
  }
  Reachable = seen;
})();

function animatePark(now, dt) {
  for (var i = 0; i < ponds.length; i++) {
    var w = ponds[i].userData.water;
    w.position.y = 0.026 + Math.sin(now * 1.1 + ponds[i].userData.seed) * 0.006;
    w.material.opacity = 0.8 + Math.sin(now * 1.7 + ponds[i].userData.seed) * 0.05;
  }
}


/* ================================= RAUPE ================================= */
var MAT_BODY_A = toon(0x6fd23c);
var MAT_BODY_B = toon(0x4aa62c);
var MAT_HEAD   = toon(0xff9a33);
var MAT_DARK   = toon(0x3c5c22);
var MAT_EYE    = new T.MeshBasicMaterial({ color: 0xffffff });
var MAT_PUPIL  = new T.MeshBasicMaterial({ color: 0x2a2118 });
var MAT_CHEEK  = new T.MeshBasicMaterial({ color: 0xf27b6a, transparent: true, opacity: 0.75 });
var LEG_GEO    = new T.SphereGeometry(1, 8, 6);

function makeSegment(i) {
  var g = new T.Group();
  var body = new T.Mesh(BLOB_GEO, i % 2 ? MAT_BODY_B : MAT_BODY_A);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  g.add(outlineFor(body, 1.16));
  if (i % 2 === 1) {
    g.userData.legs = [];
    for (var s = -1; s <= 1; s += 2) {
      var leg = new T.Mesh(LEG_GEO, MAT_DARK);
      leg.position.set(s * 0.88, -0.5, 0);
      leg.scale.setScalar(0.2);
      leg.userData.side = s;
      g.add(leg);
      g.userData.legs.push(leg);
    }
  }
  return g;
}

function makeHead() {
  var g = new T.Group();
  var skull = new T.Mesh(BLOB_GEO, MAT_HEAD);
  skull.castShadow = true; skull.receiveShadow = true;
  g.add(skull);
  g.add(outlineFor(skull, 1.13));

  var eyes = new T.Group();
  for (var s = -1; s <= 1; s += 2) {
    var w = new T.Mesh(BLOB_GEO, MAT_EYE);
    w.position.set(s * 0.42, 0.3, 0.78); w.scale.set(0.3, 0.34, 0.24);
    var p = new T.Mesh(BLOB_GEO, MAT_PUPIL);
    p.position.set(s * 0.44, 0.3, 0.96); p.scale.set(0.15, 0.19, 0.14);
    var sh = new T.Mesh(BLOB_GEO, MAT_EYE);
    sh.position.set(s * 0.5, 0.4, 1.03); sh.scale.setScalar(0.06);
    var ch = new T.Mesh(BLOB_GEO, MAT_CHEEK);
    ch.position.set(s * 0.66, -0.06, 0.7); ch.scale.set(0.19, 0.13, 0.1);
    eyes.add(w, p, sh, ch);
  }
  g.add(eyes);

  var mouth = new T.Mesh(BLOB_GEO, MAT_PUPIL);
  mouth.position.set(0, -0.33, 0.9); mouth.scale.set(0.17, 0.09, 0.08);
  g.add(mouth);
  g.userData.mouth = mouth;

  for (var t = -1; t <= 1; t += 2) {
    var stalk = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.75, 5), MAT_DARK);
    stalk.position.set(t * 0.3, 0.95, 0.15);
    stalk.rotation.z = -t * 0.42; stalk.rotation.x = -0.25;
    var ball = new T.Mesh(BLOB_GEO, toon(0xf2749f));
    ball.position.set(t * 0.44, 1.3, 0.06); ball.scale.setScalar(0.15);
    g.add(stalk, ball);
  }
  return g;
}

var Cat = {
  group: new T.Group(),
  segs: [],
  head: null,
  cells: [],          // [0] = aktuelles Kopffeld, danach der Schwanz
  dir: { x: 1, z: 0 },
  thickness: 0.27,
  thickTarget: 0.27,
  count: 6,
  phase: 0,
  chew: 0,
  hurt: 0,
  peek: null,        // Richtung, in die sie schaut, aber nicht kann

  init: function () {
    this.head = makeHead();
    this.group.add(this.head);
    scene.add(this.group);
    this.reset();
  },

  reset: function () {
    this.cells.length = 0;
    var c = { x: (HALF | 0), z: (HALF | 0) };
    for (var i = 0; i < 14; i++) this.cells.push({ x: c.x - i, z: c.z });
    this.dir = { x: 1, z: 0 };
    this.count = 6; this.phase = 0; this.chew = 0; this.hurt = 0;
    this.thickness = this.thickTarget = 0.27;
    this.peek = null;
    this.setCount(6);
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.resetTrail();
    this.layout();
  },

  setCount: function (n) {
    this.count = n;
    while (this.segs.length < n) {
      var s = makeSegment(this.segs.length);
      this.segs.push(s);
      this.group.add(s);
    }
    for (var i = 0; i < this.segs.length; i++) this.segs[i].visible = i < n;
  },

  spacing: function () { return this.thickness * 1.28; },
  headSize: function () { return this.thickness * 1.36; },
  /* Der Kopfmittelpunkt liegt so weit hinter der Spurspitze, dass die
     Schnauze genau auf der Spitze sitzt – gedreht wird also um die Nase. */
  headBack: function () { return this.headSize() * 0.86; },
  /* Abstand von der Spurspitze bis zum ersten Koerperring */
  neck: function () { return this.headSize() * 1.5; },
  bodyLength: function () { return this.neck() + this.spacing() * (this.count - 1); },
  /* Wie viele Felder der Koerper wirklich belegt.
     Die Schnauze steht auf der Mitte von cells[0], nach hinten reicht der Koerper
     bodyLength plus Schwanzradius. Ein Feld zaehlt, sobald der Koerper ueber
     dessen Mitte hinausragt – deshalb runden, nicht aufrunden. Frueher standen
     hier drei Reservefelder, die unsichtbar mitblockiert haben. */
  cellsNeeded: function () {
    return Math.round(this.bodyLength() + this.thickness * 0.66) + 1;
  },

  occupies: function (c, skipHead) {
    var n = Math.min(this.cells.length, this.cellsNeeded());
    for (var i = skipHead ? 1 : 0; i < n; i++)
      if (this.cells[i].x === c.x && this.cells[i].z === c.z) return true;
    return false;
  },

  free: function (c) {
    return c.x >= 0 && c.x < GRID && c.z >= 0 && c.z < GRID &&
           !this.occupies(c, false) && !isBlocked(c);
  },

  grow: function (extra, fatten) {
    this.setCount(Math.min(this.count + extra, 46));
    this.thickTarget = Math.min(0.27 + fatten, 0.62);
    this.chew = 1;
  },

  /* Das Feld vor dem Kopf, falls es frei ist – sonst null */
  canGo: function (dir) {
    var t = { x: this.cells[0].x + dir.x, z: this.cells[0].z + dir.z };
    return this.free(t) ? t : null;
  },

  /* Schritt abschliessen: der Kopf steht jetzt auf dem neuen Feld */
  commit: function (cell) {
    this.cells.unshift(cell);
    var keep = this.cellsNeeded();
    while (this.cells.length > keep) this.cells.pop();
    return cell;
  },

  /* Nur fuer den Menue-Modus: einfach geradeaus weiter */
  advance: function () {
    var t = this.canGo(this.dir);
    return t ? this.commit(t) : null;
  },

  /* Nach einem Aufprall eine begehbare Richtung suchen */
  escape: function () {
    var opts = [{ x: this.dir.z, z: -this.dir.x }, { x: -this.dir.z, z: this.dir.x },
                { x: this.dir.x, z: this.dir.z }, { x: -this.dir.x, z: -this.dir.z }];
    for (var i = 0; i < opts.length; i++) {
      var c = { x: this.cells[0].x + opts[i].x, z: this.cells[0].z + opts[i].z };
      if (this.free(c)) { this.dir = opts[i]; return; }
    }
  },

  /* Ist wirklich keine der vier Richtungen begehbar? Kann durch eine enge
     Kombination aus Hindernissen und eigenem Koerper passieren. */
  boxedIn: function () {
    return !this.canGo({ x: 0, z: -1 }) && !this.canGo({ x: 0, z: 1 }) &&
           !this.canGo({ x: -1, z: 0 }) && !this.canGo({ x: 1, z: 0 });
  },

  /* Rettung aus einer Sackgasse: der Koerper wird in Schlangenlinien in die
     Schutzzone rund um den Startpunkt zurueckgelegt – dort ist garantiert
     nichts im Weg, auch nicht fuer eine sehr lange Raupe. Groesse, Punkte,
     Zeit und Gegenstaende bleiben unangetastet, nur der Ort aendert sich. */
  recenter: function () {
    this.cells.length = 0;
    var n = this.cellsNeeded(), ox = HALF | 0, oz = HALF | 0, width = 12;
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / width), col = i % width;
      var xx = (row % 2 === 0) ? ox - col : ox - (width - 1 - col);
      this.cells.push({ x: xx, z: oz + row });
    }
    this.dir = { x: 1, z: 0 };
    this.peek = null;
    this.hurt = 0;
    this.rebuildTrailFromCells();
    this.layout();
  },

  /* Baut die Zeichenspur direkt aus den Gitterfeldern auf, statt sie geradeaus
     zu extrapolieren – dadurch stimmen auch die Ecken der Schlangenlinie. */
  rebuildTrailFromCells: function () {
    while (this.trail.length) this._spare.push(this.trail.pop());
    for (var i = 0; i < this.cells.length; i++) {
      var p = this._spare.pop() || new T.Vector3();
      p.set(wx(this.cells[i].x), 0, wz(this.cells[i].z));
      this.trail.push(p);
    }
    this.visHead.copy(this.trail[0]);
    this.headAngle = Math.atan2(this.dir.x, this.dir.z);
  },

  /* ---- Darstellung: die Kette laeuft auf einer fortlaufenden Spur ----
     Der Kopf folgt dem Gitterziel gedaempft und hinterlaesst Brotkrumen, die
     Segmente sitzen in festen Abstaenden darauf. Dadurch entstehen runde
     Kurven statt harter 90-Grad-Spruenge. */
  trail: [], _spare: [], _cum: [],
  visHead: new T.Vector3(),
  headAngle: 0,
  _log: new T.Vector3(),

  logicalHead: function (progress) {
    var c = this.cells[0];
    var nx = c.x + this.dir.x, nz = c.z + this.dir.z;
    var ok = nx >= 0 && nx < GRID && nz >= 0 && nz < GRID;
    this._log.set(lerp(wx(c.x), wx(ok ? nx : c.x), progress), 0,
                  lerp(wz(c.z), wz(ok ? nz : c.z), progress));
    return this._log;
  },

  resetTrail: function () {
    while (this.trail.length) this._spare.push(this.trail.pop());
    var h = this.logicalHead(0);
    this.visHead.copy(h);
    this.headAngle = Math.atan2(this.dir.x, this.dir.z);
    for (var i = 0; i < 40; i++) {
      var p = this._spare.pop() || new T.Vector3();
      p.set(h.x - this.dir.x * i * TRAIL_STEP, 0, h.z - this.dir.z * i * TRAIL_STEP);
      this.trail.push(p);
    }
  },

  pushTrail: function () {
    var guard = 0, d, p;
    while ((d = this.trail[0].distanceTo(this.visHead)) >= TRAIL_STEP && guard++ < 12) {
      p = this._spare.pop() || new T.Vector3();
      p.lerpVectors(this.trail[0], this.visHead, TRAIL_STEP / d);
      this.trail.unshift(p);
    }
    var need = Math.ceil((this.bodyLength() + 1.5) / TRAIL_STEP) + 3;
    while (this.trail.length > need) this._spare.push(this.trail.pop());
    while (this.trail.length < need) {          /* Schwanz nach hinten verlaengern */
      var last = this.trail[this.trail.length - 1];
      var prev = this.trail[this.trail.length - 2] || last;
      p = this._spare.pop() || new T.Vector3();
      p.subVectors(last, prev);
      if (p.lengthSq() < 1e-8) p.set(-this.dir.x, 0, -this.dir.z);
      p.normalize().multiplyScalar(TRAIL_STEP).add(last);
      this.trail.push(p);
    }
  },

  layout: function () {
    var th = this.thickness, sp = this.spacing();
    var tr = this.trail, n = tr.length, cum = this._cum, i;
    cum.length = n; cum[0] = 0;
    for (i = 1; i < n; i++) cum[i] = cum[i - 1] + tr[i - 1].distanceTo(tr[i]);
    /* Punkt 0 der Messung ist die Nase (visHead), danach folgt die Spur */
    this._d0 = this.visHead.distanceTo(tr[0]);
    this._idx = 0;

    var wave = this.phase;
    var shakeX = this.hurt > 0 ? Math.sin(this.hurt * 46) * 0.09 * this.hurt : 0;
    var hScale = this.headSize();
    var out = this._out;

    /* Kopf: Mittelpunkt ein Stueck hinter der Nase, Blickrichtung = Spurrichtung.
       Beides kommt aus derselben Kurve, deshalb dreht nichts um den Nacken. */
    this.atDist(this.headBack(), out);
    var yaw = Math.atan2(this.visHead.x - out.x, this.visHead.z - out.z);
    if (this.peek !== null) {   /* blockiert: sie schaut in die Richtung, kann aber nicht */
      var pd = ((this.peek - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      yaw += clamp(pd * 0.6, -0.75, 0.75);     /* hoechstens gut 40 Grad – kein Genickbruch */
    }
    var diff = ((yaw - this.headAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.headAngle += diff * 0.5;
    var chew = this.chew > 0 ? Math.sin(this.chew * 22) * 0.16 * this.chew : 0;
    this.head.position.set(out.x + shakeX, hScale * 0.8 + Math.sin(wave) * th * 0.1, out.z);
    this.head.rotation.set(Math.sin(wave) * 0.06, this.headAngle, shakeX * 2);
    this.head.scale.set(hScale * (1 + chew), hScale * (1 - chew * 0.8), hScale * (1.06 + chew * 0.4));
    this.head.userData.mouth.scale.set(0.17 + chew, 0.09 + chew * 1.6, 0.08);

    /* Koerpersegmente auf derselben Spur */
    var neck = this.neck();
    for (i = 0; i < this.count; i++) {
      this.atDist(neck + i * sp, out);
      var taper = 1 - 0.34 * Math.pow(i / Math.max(1, this.count - 1), 2.2);
      var hump = Math.abs(Math.sin(wave - i * 0.52)) * th * 0.24;
      var r = th * taper;
      var seg = this.segs[i];
      seg.position.set(out.x, r * 0.86 + hump, out.z);
      seg.scale.set(r * (1 + hump * 0.25), r * (1 - hump * 0.1), r);
      seg.rotation.set(0, this._yaw, 0);
      if (seg.userData.legs) {
        var sw = Math.sin(wave - i * 0.52);
        for (var k = 0; k < 2; k++) {
          var leg = seg.userData.legs[k];
          leg.position.z = sw * 0.3 * leg.userData.side;
          leg.position.y = -0.5 - Math.max(0, sw * leg.userData.side) * 0.12;
        }
      }
    }
  },

  /* Punkt im Abstand d hinter der Nase; setzt nebenbei _yaw auf die Laufrichtung.
     Die Aufrufe erfolgen mit wachsendem d, daher wandert _idx nur vorwaerts. */
  _out: new T.Vector3(),
  _d0: 0, _idx: 0, _yaw: 0,
  atDist: function (d, out) {
    var tr = this.trail, cum = this._cum, n = tr.length;
    if (d <= this._d0) {
      var f0 = this._d0 > 1e-6 ? d / this._d0 : 0;
      out.set(lerp(this.visHead.x, tr[0].x, f0), 0, lerp(this.visHead.z, tr[0].z, f0));
      this._yaw = Math.atan2(this.visHead.x - tr[0].x, this.visHead.z - tr[0].z);
      return out;
    }
    var rest = d - this._d0, i = this._idx;
    while (i < n - 2 && cum[i + 1] < rest) i++;
    this._idx = i;
    var a = tr[i], b = tr[i + 1];
    var segLen = cum[i + 1] - cum[i];
    var f = segLen > 1e-6 ? clamp((rest - cum[i]) / segLen, 0, 1) : 0;
    out.set(lerp(a.x, b.x, f), 0, lerp(a.z, b.z, f));
    this._yaw = Math.atan2(a.x - b.x, a.z - b.z);
    return out;
  },

  pose: function (progress, dt) {
    var target = this.logicalHead(progress);
    this.visHead.lerp(target, dt > 0 ? 1 - Math.exp(-24 * dt) : 1);
    this.pushTrail();
    this.layout();
  },

  update: function (dt) {
    this.thickness += (this.thickTarget - this.thickness) * Math.min(1, dt * 4);
    if (this.chew > 0) this.chew = Math.max(0, this.chew - dt * 3.2);
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt * 1.6);
  }
};
Cat.init();

/* ============================== SCHMETTERLING ============================= */
function wingShape(kind) {
  var sh = new T.Shape();
  if (kind === 'fore') {
    sh.moveTo(0, 0);
    sh.bezierCurveTo(0.12, 0.95, 1.02, 1.32, 1.28, 0.52);
    sh.bezierCurveTo(1.46, 0.0, 0.86, -0.16, 0, 0);
  } else {
    sh.moveTo(0, 0);
    sh.bezierCurveTo(0.18, -0.55, 1.0, -0.82, 1.02, -0.24);
    sh.bezierCurveTo(1.04, 0.06, 0.42, 0.1, 0, 0);
  }
  return sh;
}
var WING_FORE = new T.ShapeGeometry(wingShape('fore'), 24);
var WING_HIND = new T.ShapeGeometry(wingShape('hind'), 24);
WING_FORE.rotateX(-Math.PI / 2);
WING_HIND.rotateX(-Math.PI / 2);

/* Mischt man die Blattfarben roh, kommt Grau heraus. Deshalb bestimmt die
   haeufigste Sorte den Ton, die zweithaeufigste faerbt nur ein. */
var WING_COLORS = { klee: 0x7fd94a, bluete: 0xf2749f, beere: 0x6d7ee8, gold: 0xf7b733 };
var WING_WEIGHT = { klee: 1.0, bluete: 1.8, beere: 2.0, gold: 2.6 };
function wingColor(counts) {
  var list = FOOD_KEYS.map(function (k) {
    return { c: WING_COLORS[k], w: (counts[k] || 0) * WING_WEIGHT[k] };
  }).sort(function (a, b) { return b.w - a.w; });
  var main = new T.Color(list[0].w > 0 ? list[0].c : WING_COLORS.klee);
  if (list[1].w > 0) {
    var share = list[1].w / (list[0].w + list[1].w);
    main.lerp(new T.Color(list[1].c), clamp(share * 0.55, 0, 0.26));
  }
  var hsl = {};
  main.getHSL(hsl);
  main.setHSL(hsl.h, clamp(hsl.s * 1.25, 0.66, 1), clamp(hsl.l, 0.46, 0.62));
  return main;
}

/* Farbe und Musterung entstehen aus dem, was die Raupe gefressen hat */
function makeButterfly(counts) {
  var g = new T.Group();
  var main = wingColor(counts);
  var edge  = main.clone().offsetHSL(0.01, 0.14, -0.4);
  var inner = main.clone().offsetHSL(-0.02, -0.04, 0.11);
  var spotCol = (counts.gold || 0) > 0 ? new T.Color(0xffe680) : main.clone().offsetHSL(0.5, 0.25, 0.3);
  var matMain  = toon(main.getHex(),  { side: T.DoubleSide });
  var matEdge  = toon(edge.getHex(),  { side: T.DoubleSide });
  var matInner = toon(inner.getHex(), { side: T.DoubleSide });
  var matSpot  = toon(spotCol.getHex(), { side: T.DoubleSide });
  var spots = clamp(1 + Math.round(((counts.gold || 0) * 2 + (counts.beere || 0)) / 2), 1, 4);

  /* Ein Fluegelpaar: dunkler Rand, Flaeche, helles Innenfeld, Tupfen */
  function halfWing(sign) {
    var w = new T.Group();
    var layers = [
      { geo: WING_FORE, y: 0.03, scale: 1.0,  spotZ: -0.5 },
      { geo: WING_HIND, y: 0.0,  scale: 0.92, spotZ: 0.4 }
    ];
    layers.forEach(function (L) {
      var rim = new T.Mesh(L.geo, matEdge);
      rim.scale.setScalar(L.scale * 1.15);
      rim.position.y = L.y - 0.02;
      w.add(rim);

      var face = new T.Mesh(L.geo, matMain);
      face.scale.setScalar(L.scale);
      face.position.y = L.y;
      face.castShadow = true;
      w.add(face);

      var band = new T.Mesh(L.geo, matInner);
      band.scale.setScalar(L.scale * 0.54);
      band.position.set(0.06, L.y + 0.012, 0);
      w.add(band);

      for (var i = 0; i < spots; i++) {
        var sp = new T.Mesh(new T.CircleGeometry(0.11, 14), matSpot);
        sp.rotation.x = -Math.PI / 2;
        sp.scale.set(1, 1, 1.35);
        sp.position.set(0.62 + i * 0.19, L.y + 0.02, L.spotZ * L.scale + (i % 2 ? 0.13 : -0.11));
        w.add(sp);
      }
    });
    w.scale.x = sign;
    return w;
  }

  var right = halfWing(1), left = halfWing(-1);
  g.add(right, left);
  g.userData.wings = [right, left];

  var bodyMat = toon(0x3d3026);
  var parts = [[0.095, 0.0, -0.36], [0.115, 0.0, -0.04], [0.09, 0.0, 0.3], [0.065, 0.0, 0.58]];
  parts.forEach(function (p, i) {
    var b = new T.Mesh(BLOB_GEO, bodyMat);
    b.position.set(0, p[1], p[2]);
    b.scale.set(p[0], p[0] * (i === 0 ? 1 : 0.9), p[0] * (i === 3 ? 1.5 : 1.25));
    b.castShadow = true;
    g.add(b);
  });
  for (var s = -1; s <= 1; s += 2) {
    var stalk = new T.Mesh(new T.CylinderGeometry(0.016, 0.02, 0.42, 5), bodyMat);
    stalk.position.set(s * 0.07, 0.1, -0.44); stalk.rotation.set(0.6, 0, -s * 0.4);
    g.add(stalk);
    var ball = new T.Mesh(BLOB_GEO, toon(spotCol.getHex()));
    ball.position.set(s * 0.14, 0.24, -0.6); ball.scale.setScalar(0.045);
    g.add(ball);
    var eye = new T.Mesh(BLOB_GEO, MAT_PUPIL);
    eye.position.set(s * 0.08, 0.03, -0.38); eye.scale.setScalar(0.04);
    g.add(eye);
  }
  return g;
}

/* ================================ FUNKEN ================================= */
var SPARK_MAT = new T.MeshBasicMaterial({ color: 0xfff6cf, transparent: true });
var sparks = [];
function spark(pos, spread, count, color) {
  for (var i = 0; i < count; i++) {
    var m = new T.Mesh(BLOB_GEO, color ? new T.MeshBasicMaterial({ color: color, transparent: true })
                                       : SPARK_MAT.clone());
    m.position.copy(pos);
    m.scale.setScalar(rnd(0.05, 0.13));
    scene.add(m);
    sparks.push({ m: m, life: 1, v: new T.Vector3(rnd(-spread, spread), rnd(0.9, 2.4), rnd(-spread, spread)) });
  }
}
function updateSparks(dt) {
  for (var i = sparks.length - 1; i >= 0; i--) {
    var s = sparks[i];
    s.life -= dt * 1.3;
    s.v.y -= dt * 2.4;
    s.m.position.addScaledVector(s.v, dt);
    s.m.material.opacity = clamp(s.life, 0, 1);
    s.m.scale.multiplyScalar(1 - dt * 0.5);
    if (s.life <= 0) { scene.remove(s.m); sparks.splice(i, 1); }
  }
}

/* ================================ ZUSTAND ================================ */
var state = 'menu';                 // menu | playing | paused | pupate | win | timeup
var time = START_TIME, score = 0, leaves = 0;
var tally = { klee: 0, bluete: 0, beere: 0, gold: 0 };
var items = [], cocoon = null, cocoonCell = null, cocoonReady = false;
var stepAcc = 0, lastTick = 99;
var striding = false;      // laeuft gerade ein Schritt?
var rolled = false;        // war sie in Bewegung?
var bumpDir = null;        // Richtung, an der sie zuletzt anstiess
var strideTarget = null;   // Zielfeld des laufenden Schritts

var el = {
  hud: document.getElementById('hud'),
  time: document.getElementById('time'),
  timePill: document.querySelector('.hud-time'),
  score: document.getElementById('score'),
  bar: document.getElementById('bar'),
  tally: document.getElementById('tally'),
  toast: document.getElementById('toast'),
  hint: document.getElementById('hint'),
  dpad: document.getElementById('dpad'),
  flash: document.getElementById('flash')
};

function show(id) {
  var s = document.querySelectorAll('.screen');
  for (var i = 0; i < s.length; i++) s[i].classList.remove('show');
  if (id) document.getElementById(id).classList.add('show');
}
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.remove('go');
  void el.toast.offsetWidth;
  el.toast.classList.add('go');
}
/* Hinweis auf die Steuerung – verschwindet, sobald sie das erste Mal laeuft */
var hintOn = false, hintTimer = 0;
function showHint() {
  el.hint.textContent = isTouch ? 'Finger auf die Wiese legen und ziehen'
                                : 'Richtungstaste gedrückt halten';
  el.hint.classList.remove('hidden', 'fade');
  clearTimeout(hintTimer);
  hintOn = true;
}
function hideHint() {
  if (!hintOn) return;
  hintOn = false;
  el.hint.classList.add('fade');
  hintTimer = setTimeout(function () { el.hint.classList.add('hidden'); }, 500);
}

function updateHUD() {
  el.time.textContent = Math.ceil(time);
  el.score.textContent = score;
  el.bar.style.width = Math.min(100, score / GOAL * 100) + '%';
  var html = '';
  FOOD_KEYS.forEach(function (k) {
    if (tally[k]) html += '<span>' + FOOD[k].emoji + '<b>' + tally[k] + '</b></span>';
  });
  el.tally.innerHTML = html;
  el.tally.classList.toggle('empty', !html);
  el.timePill.classList.toggle('warn', time <= 10 && state === 'playing');
}

/* ================================ FUTTER ================================= */
function randomKind() {
  var total = 0, k;
  for (k in FOOD) total += FOOD[k].weight;
  var r = Math.random() * total;
  for (k in FOOD) { r -= FOOD[k].weight; if (r <= 0) return k; }
  return 'klee';
}
function cellTaken(c) {
  if (isBlocked(c) || !isReachable(c)) return true;
  if (Cat.occupies(c, false)) return true;
  if (cocoonCell && cocoonCell.x === c.x && cocoonCell.z === c.z) return true;
  for (var i = 0; i < items.length; i++)
    if (items[i].cell.x === c.x && items[i].cell.z === c.z) return true;
  return false;
}
function freeCell(minDistFromHead) {
  var head = Cat.cells[0];
  for (var tries = 0; tries < 400; tries++) {
    var c = { x: (Math.random() * GRID) | 0, z: (Math.random() * GRID) | 0 };
    if (cellTaken(c)) continue;
    if (Math.abs(c.x - head.x) + Math.abs(c.z - head.z) < minDistFromHead) continue;
    return c;
  }
  return null;
}
function spawnItem() {
  var c = freeCell(4);
  if (!c) return;
  var kind = randomKind();
  var g = MAKERS[kind]();
  g.position.set(wx(c.x), 0, wz(c.z));
  g.userData.kind = kind;
  g.userData.born = performance.now() / 1000;
  g.userData.spin = rnd(0.4, 1.1) * (Math.random() < 0.5 ? -1 : 1);
  g.userData.base = FOOD_SCALE[kind];
  g.userData.off = Math.random() * 6;
  scene.add(g);
  items.push({ kind: kind, cell: c, obj: g });
}
function clearItems() {
  items.forEach(function (it) { scene.remove(it.obj); });
  items.length = 0;
}
function animateItems(now, dt) {
  for (var i = 0; i < items.length; i++) {
    var o = items[i].obj, u = o.userData;
    var pop = clamp((now - u.born) * 4, 0, 1);
    o.scale.setScalar(u.base * easeOut(pop) * (1 + Math.sin(pop * Math.PI) * 0.12));
    o.position.y = Math.sin(now * 2 + u.off) * 0.07 + 0.06;
    o.rotation.y += dt * u.spin;
    if (u.ring) { u.ring.rotation.z += dt * 1.4; u.ring.material.opacity = 0.45 + Math.sin(now * 4) * 0.3; }
    if (u.sparks) {
      for (var s = 0; s < u.sparks.length; s++) {
        var sp = u.sparks[s], a = sp.userData.a + now * 1.6;
        sp.position.set(Math.cos(a) * 0.5, 0.45 + Math.sin(now * 3 + s) * 0.18, Math.sin(a) * 0.5);
      }
    }
  }
}

/* =========================== KOKON IM SPIEL ============================== */
function spawnCocoon() {
  var c = freeCell(6) || freeCell(2);
  if (!c) return;
  cocoonCell = c;
  if (!cocoon) { cocoon = makeCocoon(); scene.add(cocoon); }
  cocoon.position.set(wx(c.x), 0, wz(c.z));
  cocoon.visible = true;
  cocoon.scale.setScalar(0.001);
  cocoonReady = true;
  spark(new T.Vector3(wx(c.x), 0.6, wz(c.z)), 1.2, 16, 0xfff0a8);
  toast('Kokon-Ast!');
  Audio2.tone(660, 0.5, 'sine', 0.13);
  Audio2.tone(880, 0.6, 'sine', 0.1, 0.12);
}

function animateCocoon(now, dt) {
  if (!cocoon || !cocoon.visible) return;
  var sc = cocoon.scale.x;
  cocoon.scale.setScalar(sc + (1 - sc) * Math.min(1, dt * 6));
  var u = cocoon.userData;
  if (state !== 'pupate') u.shell.rotation.z = Math.sin(now * 1.8) * 0.13;
  u.halo.material.opacity = 0.55 + Math.sin(now * 3) * 0.3;
  u.halo.scale.setScalar(1 + Math.sin(now * 3) * 0.09);
  u.beam.material.opacity = 0.14 + Math.sin(now * 2.2) * 0.07;
  u.beam.rotation.y += dt * 0.4;
  for (var i = 0; i < u.orbit.length; i++) {
    var sp = u.orbit[i], a = sp.userData.a + now * 1.3;
    sp.position.set(0.42 + Math.cos(a) * 0.75, 0.5 + Math.sin(now * 2 + i) * 0.4 + 0.5, Math.sin(a) * 0.75);
  }
}

/* =============================== SPIELZUG ================================ */
function stepTime() { return clamp(STEP_BASE + (Cat.count - 6) * 0.0017, 0.155, 0.235); }

function eat(idx) {
  var it = items[idx], f = FOOD[it.kind];
  score += f.pts; leaves++; tally[it.kind]++;
  if (f.secs) time = Math.min(START_TIME + 30, time + f.secs);
  Cat.grow(f.pts > 2 ? 2 : 1, leaves * 0.0125);
  spark(new T.Vector3(wx(it.cell.x), 0.4, wz(it.cell.z)), 0.9, f.pts > 2 ? 12 : 6, f.color);
  Audio2.eat(it.kind);
  toast('+' + f.pts + (f.secs ? '  +' + f.secs + 's' : ''));
  scene.remove(it.obj);
  items.splice(idx, 1);
  spawnItem();
  if (!cocoonReady && score >= GOAL) spawnCocoon();
  updateHUD();
}

/* Vor Hecke und eigenem Koerper ist Schluss. Da sie jetzt gar nicht mehr
   hineinlaufen kann, gibt es dafuer keine Zeitstrafe – sie bleibt stehen,
   und die Uhr laeuft weiter. */
function blocked(dir) {
  Cat.peek = Math.atan2(dir.x, dir.z);
  var repeat = bumpDir && bumpDir.x === dir.x && bumpDir.z === dir.z;
  bumpDir = { x: dir.x, z: dir.z };
  if (!rolled || repeat) { rolled = false; return; }
  rolled = false;
  Cat.hurt = 0.7;
  shake = 0.22;
  Audio2.bump();
}

/* Beginnt einen Schritt in die gehaltene Richtung – aber nur, wenn das Zielfeld
   frei ist. Dadurch laeuft die Raupe nie sichtbar in etwas hinein. */
function beginStride() {
  var want = heldDir();
  if (!want) { rolled = false; Cat.peek = null; return false; }
  var target = Cat.canGo(want);
  if (!target) { blocked(want); return false; }
  Cat.dir = want;
  Cat.peek = null;
  strideTarget = target;
  bumpDir = null;
  return true;
}

/* Schritt ist zu Ende: fressen, Kokon pruefen */
function arrive() {
  var c = Cat.commit(strideTarget);
  rolled = true;
  if (hintOn) hideHint();
  for (var i = 0; i < items.length; i++)
    if (items[i].cell.x === c.x && items[i].cell.z === c.z) { eat(i); break; }
  if (cocoonReady && cocoonCell && cocoonCell.x === c.x && cocoonCell.z === c.z) startPupation(true);
}

/* Raeumt Gegenstaende und Kokon weg, die nach einer Rettung nun im Koerper
   der Raupe liegen wuerden, und platziert sie neu. */
function resolveOverlaps() {
  for (var i = items.length - 1; i >= 0; i--) {
    if (Cat.occupies(items[i].cell, false)) {
      scene.remove(items[i].obj);
      items.splice(i, 1);
    }
  }
  while (items.length < ITEMS_ON_FIELD) spawnItem();
  if (cocoonReady && cocoonCell && Cat.occupies(cocoonCell, false)) {
    cocoonCell = null; cocoonReady = false;
    if (cocoon) cocoon.visible = false;
    spawnCocoon();
  }
}

/* Ein voll umschlossenes Kopffeld ist eine Sackgasse, aus der sie sich nicht
   selbst befreien kann – egal ob durch Hindernisse, die Hecke oder den
   eigenen Koerper. Nach drei Sekunden in dieser Lage kehrt sie zum
   Startpunkt zurueck, ohne Punkte, Zeit oder Fortschritt zu verlieren. */
var stuckTimer = 0;
function updateStuckWatch(dt) {
  if (!Cat.boxedIn()) { stuckTimer = 0; return; }
  stuckTimer += dt;
  if (stuckTimer < 3) return;
  stuckTimer = 0;
  if (state === 'menu') { Cat.reset(); return; }
  Cat.recenter();
  resolveOverlaps();
  striding = false; rolled = false; bumpDir = null; strideTarget = null; stepAcc = 0;
  shake = 0.3;
  toast('Feststeckt – zurück zum Start!');
  Audio2.tone(392, 0.18, 'sine', 0.12);
  Audio2.tone(294, 0.28, 'sine', 0.10, 0.12);
}

/* Im Menue laeuft sie von allein, im Spiel nur, solange eine Richtung gehalten wird. */
function updateWalk(dt) {
  updateStuckWatch(dt);
  var st = stepTime();

  if (state === 'menu') {
    stepAcc += dt;
    while (stepAcc >= st) {
      stepAcc -= st;
      if (Math.random() < 0.22) {
        var turn = Math.random() < 0.5 ? { x: Cat.dir.z, z: -Cat.dir.x } : { x: -Cat.dir.z, z: Cat.dir.x };
        if (Cat.canGo(turn)) Cat.dir = turn;
      }
      if (!Cat.advance()) Cat.escape();
    }
    Cat.pose(clamp(stepAcc / st, 0, 1), dt);
    return;
  }

  if (striding) {
    stepAcc += dt;
    while (stepAcc >= st) {
      stepAcc -= st;
      arrive();
      if (state !== 'playing') return;
      striding = beginStride();            /* haelt der Spieler weiter, geht es nahtlos weiter */
      if (!striding) { stepAcc = 0; break; }
    }
  } else {
    striding = beginStride();
    stepAcc = striding ? Math.min(dt, st * 0.5) : 0;
  }
  Cat.pose(striding ? clamp(stepAcc / st, 0, 1) : 0, dt);
}

/* =============================== VERPUPPUNG ============================== */
var pup = { t: 0, bonus: 0, bfly: null, target: new T.Vector3(), scaleGoal: 1 };
var TMP_V = new T.Vector3();

function shellWorld() {
  var v = new T.Vector3();
  cocoon.userData.shell.getWorldPosition(v);
  return v;
}

function startPupation(withBonus) {
  state = 'pupate';
  pup.t = 0;
  pup.fromDist = camState.dist; pup.fromTilt = camState.tilt;
  pup.bonus = withBonus ? Math.round(time * 0.4) : 0;
  if (!cocoon) { cocoon = makeCocoon(); scene.add(cocoon); cocoon.visible = true; cocoon.scale.setScalar(1); }
  if (!withBonus) {                       // Zeit abgelaufen: sie verpuppt sich, wo sie steht
    cocoon.position.set(wx(Cat.cells[0].x), 0, wz(Cat.cells[0].z));
    cocoon.scale.setScalar(1);
  }
  cocoon.userData.shell.scale.setScalar(1);
  cocoon.userData.shell.visible = true;
  cocoon.userData.beam.visible = true;
  cocoon.userData.halo.visible = true;
  pup.target.copy(shellWorld());
  clearItems();
  el.hud.classList.add('hidden');
  el.dpad.classList.add('hidden');
  hideHint();
  var total = score + pup.bonus;
  pup.scaleGoal = 0.5 + clamp(total, 0, 70) / 70 * 0.75;
  if (pup.bfly) { scene.remove(pup.bfly); pup.bfly = null; }
}

function updatePupation(dt, now) {
  pup.t += dt;
  var t = pup.t, shell = cocoon.userData.shell;

  /* Kamera fährt heran */
  var k = clamp(t / 1.6, 0, 1);
  camState.dist = lerp(pup.fromDist, 8.5, smooth(k));
  camState.target.lerp(TMP_V.set(cocoon.position.x + 0.42, pup.t > 4.05 ? -0.65 : 1.0, cocoon.position.z), Math.min(1, dt * 2.2));
  camState.tilt = lerp(pup.fromTilt, 26, smooth(k));

  if (t < 1.15) {                                    /* A – die Raupe rollt sich ein */
    var c = easeIn(clamp(t / 1.15, 0, 1));
    Cat.pose(0, dt);
    for (var i = 0; i < Cat.count; i++) {
      var s = Cat.segs[i];
      s.position.lerp(pup.target, c * 0.96);
      s.scale.multiplyScalar(1 - c * 0.55);
    }
    Cat.head.position.lerp(pup.target, c * 0.96);
    Cat.head.scale.multiplyScalar(1 - c * 0.5);
    shell.scale.setScalar(0.001 + c * 0.2);
  } else if (t < 3.6) {                              /* B – der Kokon zittert */
    if (Cat.group.visible) {
      Cat.group.visible = false;
      Audio2.pupate();
      spark(pup.target, 0.7, 18, 0xdaf7b0);
    }
    var b = clamp((t - 1.15) / 0.5, 0, 1);
    shell.scale.setScalar(lerp(0.2, 1, easeOut(b)) * (1 + Math.sin((t - 1.15) * 14) * 0.05 * (1 - b)));
    shell.rotation.z = Math.sin(t * 9) * 0.09 * clamp((3.6 - t) / 1.4, 0, 1);
    if (Math.random() < dt * 6) spark(pup.target, 0.5, 1, 0xfff0a8);
  } else if (t < 4.05) {                             /* C – Blitz */
    var f = (t - 3.6) / 0.45;
    el.flash.style.opacity = Math.sin(f * Math.PI);
    shell.scale.setScalar(1 + f * 0.5);
    shell.material && (shell.material.opacity = 1 - f);
    if (f > 0.5 && shell.visible) {
      shell.visible = false;
      pup.bfly = makeButterfly(tally);
      pup.bfly.position.copy(pup.target);
      pup.bfly.rotation.y = Math.PI;
      pup.bfly.scale.setScalar(0.001);
      scene.add(pup.bfly);
      spark(pup.target, 1.4, 26, 0xffffff);
      cocoon.userData.beam.visible = false;
      cocoon.userData.halo.visible = false;
      Audio2.win();
    }
  } else {                                           /* D – der Falter entfaltet sich */
    el.flash.style.opacity = 0;
    var d = clamp((t - 4.05) / 1.5, 0, 1);
    var b2 = pup.bfly;
    if (b2) {
      b2.scale.setScalar(lerp(0.05, pup.scaleGoal, easeOut(d)));
      b2.position.y = pup.target.y + easeOut(d) * 1.75 + Math.sin(now * 2.4) * 0.06;
      var amp = easeOut(d) * 0.55;
      b2.rotation.x = -0.16 * easeOut(d);
      var flap = Math.sin(now * (5 + d * 3)) * amp - 0.1 * amp;
      b2.userData.wings[0].rotation.z = flap;
      b2.userData.wings[1].rotation.z = -flap;
      b2.rotation.y = Math.PI + Math.sin(now * 0.8) * 0.25;
      if (Math.random() < dt * 4) spark(b2.position, 0.6, 1, 0xfff6cf);
    }
    camState.dist = lerp(8.5, 8.6, d);
    camState.tilt = lerp(26, 44, smooth(d));
    if (t > 5.5 && state === 'pupate') showWin();
  }
}

function animateWinButterfly(dt, now) {
  var b = pup.bfly;
  if (!b) return;
  var flap = Math.sin(now * 5.2) * 0.5 - 0.05;
  b.userData.wings[0].rotation.z = flap;
  b.userData.wings[1].rotation.z = -flap;
  b.position.x = pup.target.x + Math.sin(now * 0.42) * 0.7;
  b.position.y = pup.target.y + 1.75 + Math.sin(now * 1.5) * 0.16;
  b.position.z = pup.target.z + Math.sin(now * 0.31) * 0.28;
  b.rotation.y = Math.PI + Math.sin(now * 0.6) * 0.32;
  b.rotation.x = -0.16 + Math.sin(now * 1.5) * 0.05;
  b.rotation.z = Math.sin(now * 0.8) * 0.06;
  if (Math.random() < dt * 1.2) spark(b.position, 0.45, 1, 0xfff6cf);
  /* Blick etwas unter den Falter legen, damit er im oberen Bilddrittel schwebt */
  camState.target.lerp(TMP_V.set(b.position.x, b.position.y - 2.4, b.position.z), Math.min(1, dt * 1.5));
  camState.dist = 8.6;
  camState.tilt = 44 + Math.sin(now * 0.22) * 2.5;
}

/* ============================== ERFOLGS-BILD ============================= */
var RANKS = [
  { min: 52, name: 'Goldener Falter' },
  { min: 34, name: 'Prächtiger Falter' },
  { min: 0,  name: 'Zarter Falter' }
];
function dominantKind() {
  var best = 'klee', bv = -1;
  FOOD_KEYS.forEach(function (k) {
    var v = tally[k] * FOOD[k].pts;
    if (v > bv) { bv = v; best = k; }
  });
  return best;
}
var FLAVOUR = {
  klee: 'Der viele Klee hat ihm frische, grüne Flügel gegeben.',
  bluete: 'Die Blütenblätter färben seine Flügel rosa wie den Abendhimmel.',
  beere: 'Von den Beeren schimmern seine Flügel tiefblau.',
  gold: 'Die seltenen Goldblätter lassen seine Flügel in der Sonne funkeln.'
};
function statBox(v, l) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; }

function showWin() {
  state = 'win';
  var total = score + pup.bonus;
  var span = (3.2 + score * 0.3 + leaves * 0.2).toFixed(1);
  var rank = RANKS[RANKS.length - 1];
  for (var r = 0; r < RANKS.length; r++) if (total >= RANKS[r].min) { rank = RANKS[r]; break; }
  document.getElementById('win-rank').textContent = rank.name;
  document.getElementById('win-lead').textContent =
    'Aus deiner dicken Raupe ist ein Schmetterling geworden. ' + FLAVOUR[dominantKind()];
  document.getElementById('win-stats').innerHTML =
    statBox(leaves, 'Blätter gefressen') +
    statBox(score, 'Punkte') +
    statBox('+' + pup.bonus, 'Zeit-Bonus') +
    statBox(span + ' cm', 'Flügelspannweite');
  show('scr-win');
}

function showTimeup() {
  state = 'timeup';
  camState.dist = baseDist; camState.tilt = 58; camState.yaw = 0;
  el.hud.classList.add('hidden');
  el.dpad.classList.add('hidden');
  hideHint();
  document.getElementById('timeup-stats').innerHTML =
    statBox(leaves, 'Blätter gefressen') +
    statBox(score, 'Punkte') +
    statBox(GOAL - score, 'Punkte gefehlt');
  Audio2.tone(330, 0.5, 'sine', 0.12);
  Audio2.tone(247, 0.8, 'sine', 0.1, 0.2);
  show('scr-timeup');
}

/* ============================== NEUES SPIEL ============================== */
var isTouch = matchMedia('(pointer: coarse)').matches;

function newGame() {
  time = START_TIME; score = 0; leaves = 0; lastTick = 99;
  FOOD_KEYS.forEach(function (k) { tally[k] = 0; });
  clearItems();
  if (cocoon) cocoon.visible = false;
  cocoonCell = null; cocoonReady = false;
  if (pup.bfly) { scene.remove(pup.bfly); pup.bfly = null; }
  sparks.forEach(function (s) { scene.remove(s.m); }); sparks.length = 0;
  Cat.reset();
  stepAcc = 0; shake = 0;
  clearHeld(); striding = false; rolled = false; bumpDir = null; strideTarget = null; stuckTimer = 0;
  for (var i = 0; i < ITEMS_ON_FIELD; i++) spawnItem();
  camState.tilt = PLAY_TILT; camState.dist = PLAY_DIST; camState.yaw = 0;
  camState.target.set(0, 0, 0.4);
  el.hud.classList.remove('hidden');
  el.dpad.classList.toggle('hidden', !isTouch);
  el.flash.style.opacity = 0;
  showHint();
  updateHUD();
  show(null);
  state = 'playing';
  Audio2.boot();
}

function bindButton(id, fn) {
  var b = document.getElementById(id);
  b.onclick = function () { b.blur(); fn(); };
}
bindButton('btn-start', newGame);
bindButton('btn-retry', newGame);
bindButton('btn-again', newGame);
bindButton('btn-resume', function () { togglePause(false); });
bindButton('btn-restart', newGame);
document.getElementById('sound').onclick = function () {
  Audio2.on = !Audio2.on;
  this.textContent = Audio2.on ? '🔊' : '🔇';
  this.blur();
  if (Audio2.on) Audio2.boot(); else Music.stop();
};

/* ================================ PAUSE ================================= */
function togglePause(wantPause) {
  var to = wantPause === undefined ? state === 'playing' : wantPause;
  if (to && state === 'playing') {
    state = 'paused';
    clearHeld();
    striding = false;
    document.getElementById('pause-stats').innerHTML =
      statBox(Math.ceil(time) + ' s', 'Zeit übrig') +
      statBox(score + ' / ' + GOAL, 'Punkte') +
      statBox(leaves, 'Blätter');
    show('scr-pause');
  } else if (!to && state === 'paused') {
    show(null);
    state = 'playing';
    stepAcc = 0;
    Audio2.boot();
  }
}
addEventListener('blur', function () { togglePause(true); });
document.addEventListener('visibilitychange', function () {
  if (document.hidden) togglePause(true);
});

/* ============================== STEUERUNG =============================== */
/* Die Raupe laeuft, solange eine Richtung gehalten wird. Gehaltene Richtungen
   liegen als Stapel vor – die zuletzt gedrueckte gewinnt, beim Loslassen
   uebernimmt wieder die darunter liegende. */
var DIRS = {
  up: { x: 0, z: -1 }, down: { x: 0, z: 1 }, left: { x: -1, z: 0 }, right: { x: 1, z: 0 }
};
var held = [];
function pressDir(name) {
  if (!DIRS[name]) return;
  var i = held.indexOf(name);
  if (i >= 0) held.splice(i, 1);
  held.push(name);
}
function releaseDir(name) {
  var i = held.indexOf(name);
  if (i >= 0) held.splice(i, 1);
}
function clearHeld() { held.length = 0; }
function heldDir() { return held.length ? DIRS[held[held.length - 1]] : null; }
function dirName(d) {
  if (d.x > 0) return 'right';
  if (d.x < 0) return 'left';
  if (d.z > 0) return 'down';
  return 'up';
}

/* Tastenzuordnung ueber key, code und keyCode – manche Browser liefern nur eines davon */
var KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Up: 'up', Down: 'down', Left: 'left', Right: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right'
};
var CODEMAP = { 38: 'up', 40: 'down', 37: 'left', 39: 'right',
                87: 'up', 83: 'down', 65: 'left', 68: 'right' };
function dirFromEvent(e) {
  return KEYMAP[e.key] || KEYMAP[e.code] || CODEMAP[e.keyCode || e.which] || null;
}

addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key, code = e.code;
  if (k === 'Escape' || code === 'Escape' || e.keyCode === 27) {
    e.preventDefault(); togglePause(); return;
  }
  var d = dirFromEvent(e);
  if (d) {
    e.preventDefault();
    if (state === 'playing') pressDir(d);
    Audio2.boot();
    return;
  }
  var isGo = k === ' ' || k === 'Spacebar' || k === 'Enter' ||
             code === 'Space' || code === 'Enter' || e.keyCode === 32 || e.keyCode === 13;
  if (isGo) {
    if (state === 'paused') { e.preventDefault(); togglePause(false); }
    else if (state !== 'playing' && state !== 'pupate') { e.preventDefault(); newGame(); }
  }
}, { capture: true, passive: false });

addEventListener('keyup', function (e) {
  var d = dirFromEvent(e);
  if (d) { e.preventDefault(); releaseDir(d); }
}, { capture: true, passive: false });

/* Geht der Fokus verloren, klemmt sonst eine Taste fest */
addEventListener('blur', clearHeld);

/* Steuerkreuz: gedrueckt halten. Der Pointer wird eingefangen, damit das
   Loslassen auch dann ankommt, wenn der Finger vom Knopf rutscht. */
Array.prototype.forEach.call(el.dpad.querySelectorAll('button'), function (b) {
  var name = b.dataset.dir;
  b.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (b.setPointerCapture) b.setPointerCapture(e.pointerId);
    pressDir(name);
    Audio2.boot();
  });
  var off = function () { releaseDir(name); };
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
});

/* Auf der Wiese: Finger auflegen und die Raupe laeuft geradeaus weiter,
   ziehen lenkt sie – wie ein kleiner Joystick unter dem Daumen. */
(function stick() {
  var id = null, ox = 0, oy = 0, current = null;
  function set(name) {
    if (name === current) return;
    if (current) releaseDir(current);
    current = name;
    if (name) pressDir(name);
  }
  canvas.addEventListener('pointerdown', function (e) {
    Audio2.boot();
    if (state !== 'playing') return;
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(id);
    set(dirName(Cat.dir));
  });
  canvas.addEventListener('pointermove', function (e) {
    if (id === null || e.pointerId !== id) return;
    var dx = e.clientX - ox, dy = e.clientY - oy;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
    set(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    ox = e.clientX; oy = e.clientY;
  });
  var end = function (e) {
    if (id === null || (e && e.pointerId !== id)) return;
    set(null); id = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
})();

/* ============================== HAUPTSCHLEIFE ============================ */
var prev = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  var dt = Math.min(0.05, (nowMs - prev) / 1000);
  prev = nowMs;
  var now = nowMs / 1000;

  Cat.update(dt);
  Cat.phase += dt * (state === 'playing' ? (striding ? 7.5 : 2.0) : 4.5);
  animateItems(now, dt);
  animateCocoon(now, dt);
  animatePark(now, dt);
  updateSparks(dt);

  if (state === 'menu' || state === 'playing') updateWalk(dt);

  if (state === 'playing') {
    time -= dt;
    var whole = Math.ceil(time);
    if (whole !== lastTick) {
      lastTick = whole;
      updateHUD();
      if (whole <= 5 && whole > 0) Audio2.tick();
    }
    if (time <= 0) {
      time = 0;
      updateHUD();
      if (score >= GOAL) startPupation(false); else showTimeup();
    }
    var h = Cat.head.position;
    camState.target.lerp(TMP_V.set(h.x, 0, h.z + 0.35), Math.min(1, dt * 2.4));
  }

  if (state === 'menu') camState.yaw = Math.sin(now * 0.12) * 0.5;
  if (state === 'pupate') updatePupation(dt, now);
  if (state === 'win') animateWinButterfly(dt, now);

  if (shake > 0) shake = Math.max(0, shake - dt * 2);
  placeCamera(now);
  renderer.render(scene, camera);
}

/* ================================= START ================================= */
resize();
newGame();
state = 'menu';
clearItems();
el.hud.classList.add('hidden');
el.dpad.classList.add('hidden');
show('scr-start');
requestAnimationFrame(frame);

/* Debug-Zugriff (nur zum Feinjustieren in der Konsole) */
window.__g = { scene: scene, renderer: renderer, camera: camera, sun: sun, Cat: Cat,
  newGame: newGame, pupate: startPupation, cam: camState,
  state: function (v) { if (v) state = v; return state; },
  bfly: function (counts, scale) {
    var b = makeButterfly(counts || { klee: 8, bluete: 3, beere: 2, gold: 1 });
    b.position.set(0, 1.6, 0); b.scale.setScalar(scale || 1.2); b.rotation.y = Math.PI;
    scene.add(b); return b;
  },
  setTime: function (v) { time = v; updateHUD(); },
  held: function () { return held.slice(); },
  walk: function (dt, n) { for (var i = 0; i < (n || 1); i++) { Cat.update(dt); updateWalk(dt); } return Cat.cells[0]; },
  park: function () { return { obstacles: Obstacles.size, reachable: Reachable.size, grid: GRID*GRID, spawn: SPAWN }; },
  isBlocked: isBlocked, isReachable: isReachable,
  music: function () { return { playing: Music.playing, ctxState: Audio2.ctx ? Audio2.ctx.state : 'kein Context' }; },
  items: function () { return items.map(function (it) { return it.cell; }); },
  cocoonCell: function () { return cocoonCell; },
  hold: function (n) { pressDir(n); },
  letGo: function (n) { if (n) releaseDir(n); else clearHeld(); },
  cheat: function (n) { score = n; leaves = n; tally.klee = n; updateHUD(); if (!cocoonReady && score >= GOAL) spawnCocoon(); } };
})();
