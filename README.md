# Flügelhunger

Ein Browserspiel im Snake-Stil: Du führst eine Raupe über einen kleinen Park, sie
wird mit jedem Blatt dicker und länger, und wenn sie dick genug ist, verpuppt sie
sich und schlüpft als Schmetterling. Draufsicht, 2.5D — echte 3D-Modelle (three.js),
aber rein zweidimensionale Steuerung auf einem 25×25-Raster.

Anders als klassisches Snake läuft die Raupe nicht von allein: sie bewegt sich nur,
solange du eine Richtung **gedrückt hältst**. Lässt du los, läuft sie den
angefangenen Schritt zu Ende und bleibt auf dem Feld stehen.

## Spielen

`dist/fluegelhunger.html` im Browser öffnen. Die Datei enthält alles (three.js,
CSS, Spiellogik) und läuft ohne Server und ohne Internet.

Zum Entwickeln oder Neubauen ist ein npm-Projekt eingerichtet, siehe
[Entwickeln](#entwickeln) unten.

## Regeln

| Futter | Punkte | Extra |
|---|---|---|
| 🍀 Klee | 1 | häufig |
| 🌸 Blüte | 2 | |
| 🫐 Beere | 3 | +3 Sekunden |
| ✨ Goldblatt | 5 | selten |

* 90 Sekunden Zeit. Ziel sind **20 Punkte** — dann erscheint der Kokon-Ast.
* Danach darfst du weiterfressen. Je mehr und je edler die Blätter, desto größer
  und bunter der Falter. Wer früh in den Kokon geht, bekommt Zeit-Bonus.
* Läuft die Zeit ab, bevor die 20 Punkte stehen, schläft die Raupe ein.
  Sind die 20 Punkte schon erreicht, verpuppt sie sich dort, wo sie steht —
  dann allerdings ohne Zeit-Bonus.
* Der Park hat zwei Teiche, Büsche, Felsengruppen und kleine Bäume — die sind wie
  Hecke und eigener Körper unbegehbar. Davor bleibt sie stehen, statt hineinzulaufen.
  Hältst du eine Richtung, in die es nicht weitergeht, dreht sie den Kopf dorthin —
  so ist zu sehen, dass die Taste ankommt, der Weg aber versperrt ist.
  Das kostet keine Zeitstrafe — aber die Uhr läuft weiter, auch im Stand.
  Sterben kann die Raupe nicht. Sollte sie sich einmal komplett einschließen (durch
  eine enge Kombination aus Hindernis und eigenem Körper), kehrt sie nach drei
  Sekunden von selbst zum Startpunkt zurück, ohne Punkte oder Zeit zu verlieren.
* Die **Art** der Blätter bestimmt die Flügelfarbe, die **Menge** die Größe.

## Steuerung

Pfeiltasten oder WASD **gedrückt halten**. Sind mehrere Tasten unten, gilt die
zuletzt gedrückte; beim Loslassen übernimmt wieder die darunterliegende.

Die Kamera hängt dicht an der Raupe (Adventure-Perspektive) — man sieht nur einen
Ausschnitt des Parks und muss nach Blättern und dem Kokon-Ast suchen. Nur der
Start- und der „Zeit um"-Bildschirm zeigen den ganzen Park von oben.

Auf dem Touchscreen: Finger auf die Wiese legen — sie läuft in ihre Blickrichtung
weiter — und ziehen, um zu lenken. Das Steuerkreuz unten links funktioniert
genauso per Gedrückthalten.

`Esc` pausiert · `Enter`/`Leertaste` startet eine neue Runde.

## Musik

Eine leise, freundliche Loop-Melodie läuft im Hintergrund — vollständig
prozedural über WebAudio erzeugt (`Music` in `src/game.js`, direkt neben `Audio2`),
kein Audiofile nötig. Eine weiche Akkorddecke im I–vi–IV–V-Schema (C–Am–F–G,
also immer konsonant) unter einer kleinen Melodie in Dur-Pentatonik, 32 Schläge
lang, dann von vorn. Startet automatisch beim ersten Tastendruck/Antippen
(`Audio2.boot()`) und hängt am selben Lautsprecher-Knopf wie die Soundeffekte.

## Entwickeln

Abhängigkeiten sind npm-managed (`three` als normale `dependency`, `esbuild`
als einziger `devDependency` fürs Bündeln). Einmalig installieren:

    npm install

Dann:

    npm run dev      # Entwicklungsserver mit Live-Rebuild, http://localhost:8123
    npm run build     # baut dist/fluegelhunger.html + dist/artifact.html neu

`npm start` ist ein Alias für `npm run dev`.

## Aufbau

    package.json       npm-Projekt: Skripte, "three" als Abhängigkeit
    scripts/dev.js      Entwicklungsserver (esbuild serve, bündelt bei jeder Anfrage frisch)
    scripts/build.js    baut dist/ — bündelt per esbuild und minimiert, dann alles in eine Datei
    index.html          Grundgerüst, HUD und die Overlay-Screens
    style.css           gesamtes UI
    src/game.js         Spiel: Szene, Raupe, Futter, Verpuppung, Falter (ES-Modul, importiert "three")
    build/game.js       Bundle-Ausgabe (generiert, nicht eingecheckt)
    dist/               fluegelhunger.html (fertig) + artifact.html (nur Inhalt)
    node_modules/       generiert, nicht eingecheckt

`src/game.js` beginnt mit `import * as THREE from 'three';` — das ist die einzige
Stelle, an der sich die alte, globale `<script>`-Einbindung von three.js geändert
hat. Der Rest der Datei arbeitet unverändert mit `T = THREE` weiter.

Nach Änderungen an `src/game.js`, `style.css` oder `index.html` reicht
`npm run dev` (Live-Rebuild) zum Ausprobieren, `npm run build` für den fertigen
Offline-Export.

**Falle beim Bauen:** `scripts/build.js` fügt den minimierten Bundle-Code per
`String.replace()` in `index.html` ein — dafür müssen Ersetzungen als
**Funktion**, nicht als Replacement-String übergeben werden. Ein
Replacement-*String* interpretiert `$&`, `` $` `` usw. speziell, und minimierter
Code enthält so gut wie sicher `$&` (z. B. als Und-Verknüpfung einer
`$`-Variable) — als String eingesetzt reißt das den Platzhalter mitten im Bundle
wieder ein. Ist beim Testen schon einmal passiert; die Funktion-als-Replacer-Form
ist dagegen immun.

### Die Kamera

`PLAY_DIST`/`PLAY_TILT` (nahe Werte) gelten waehrend `state==='playing'`; die
Kamera folgt dem Kopf direkt (siehe die `camState.target.lerp(...)`-Zeile in der
Hauptschleife). `baseDist`, berechnet in `resize()` aus der Feldgröße, ist nur
noch für den Start- und den „Zeit um"-Bildschirm da (dort wird sie explizit
gesetzt, nicht automatisch bei jedem Resize). Beim Verpuppen fängt die
Kamerafahrt beim tatsächlichen aktuellen Stand an (`pup.fromDist`/`fromTilt`,
in `startPupation()` festgehalten) statt bei einem festen Weitwinkel-Wert —
sonst würde sie beim Verpuppen erst einmal sichtbar herausspringen.

### Wie ein Schritt abläuft

`beginStride()` prüft das Zielfeld **bevor** der Schritt beginnt — deshalb läuft
die Raupe nie sichtbar in Hecke oder eigenen Körper hinein, sie geht schlicht nicht
los. `arrive()` schließt den Schritt ab (Feld übernehmen, fressen, Kokon prüfen)
und startet sofort den nächsten, solange gehalten wird. Lässt der Spieler mitten im
Schritt los, wird dieser noch zu Ende geführt, damit der Kopf auf einem Feldmittel-
punkt zum Stehen kommt.

### Der Park

`GRID` ist jetzt 25×25 statt 19×19. Rund um den Startpunkt bleibt beim Aufbau ein
fester, obstacle-freier Streifen (`inSafeZone()`) — dort steht der Anfangskörper
und dort fährt die Raupe los. Außerhalb davon platziert `buildPark()` zwei
organisch geformte Teiche (Blob-Kontur aus überlagerten Sinuswellen, siehe
`blobShape()`), ein paar Busch- und Felsen-Cluster (kleine, zufällig gedrehte
2–4-Feld-Muster) und einzelne Bäume. Jedes Feature reserviert Mindestabstand zu
den anderen (`findSpot()`), damit keine Engstellen entstehen.

Die blockierten Felder landen in `Obstacles` (ein Set aus `"x:z"`-Schlüsseln).
Direkt danach läuft eine Breitensuche vom Startfeld aus (`Reachable`) — nur
Felder, die von dort aus erreichbar sind, gelten für Futter- und Kokon-Spawn als
frei. So kann nie ein Blatt auf einer durch Hindernisse abgeschnittenen Insel
liegen. `Cat.free()` prüft Hindernisse genauso wie Hecke und eigenen Körper.

### Wenn sie sich selbst einschließt

Bei einem größeren Park mit echten Hindernissen kann sich die Raupe — vor allem
lang gewachsen — in eine Ecke aus Hindernis und eigenem Körper manövrieren, aus
der keine der vier Richtungen mehr herausführt. `Cat.boxedIn()` prüft das jedes
Bild; steht die Sackgasse drei Sekunden lang (`updateStuckWatch()` in
`src/game.js`), ruft `Cat.recenter()` sie zurück zum Start. Damit das auch für eine
sehr lange Raupe sicher in die Schutzzone passt, legt `recenter()` den Körper
nicht gerade aus, sondern in Schlangenlinien (`width`-Zeilen), und
`rebuildTrailFromCells()` baut die Zeichenspur direkt aus diesen Gitterfeldern
neu auf — sonst würde die Spur, die sonst nur geometrisch extrapoliert, die
Kurven nicht kennen. `resolveOverlaps()` räumt danach Gegenstände oder den
Kokon weg, die jetzt zufällig im Körper läge, und platziert sie neu.

### Wie viel Platz die Raupe belegt

`Cat.cellsNeeded()` sagt, wie viele Felder der Spur-Historie als Körper gelten —
das ist die Kollisionsfläche. Sie muss zum **sichtbaren** Körper passen, sonst
blockiert die Raupe Felder, auf denen nichts zu sehen ist, und einzelne
Richtungstasten wirken kaputt. Die Formel misst deshalb die tatsächliche Länge
(`bodyLength()` plus Schwanzradius) und rundet kaufmännisch: ein Feld zählt, sobald
der Körper über dessen Mitte hinausragt. Die Zeichenspur (`pushTrail`) rechnet ihre
Länge getrennt und darf großzügiger sein.

### Wie die Raupe gezeichnet wird

Die Spiellogik ist klassisches Snake auf einem 25×25-Raster (`Cat.cells`).
Gezeichnet wird sie aber nicht auf dem Raster, sondern auf einer fortlaufenden
Spur: `Cat.visHead` folgt dem Rasterziel gedämpft und hinterlässt alle 0,12
Einheiten einen Punkt (`Cat.trail`). Kopf und Segmente werden per Bogenlänge auf
dieser Spur platziert (`Cat.atDist`). Dadurch entstehen runde Kurven statt harter
90-Grad-Sprünge. Der Kopf sitzt so weit hinter der Spurspitze, dass die Schnauze
genau auf der Spitze liegt — gedreht wird also um die Nase, nicht um den Nacken.

### Debug

Im Browser liegt `window.__g` bereit:

    __g.cheat(20)      Punktestand setzen (spawnt bei ≥20 den Kokon)
    __g.setTime(3)     Restzeit setzen
    __g.pupate(true)   Verpuppung sofort starten
    __g.bfly({gold:5}) einen Falter zum Ansehen in die Szene setzen
    __g.cam            Kamera (tilt, dist, yaw, target)
    __g.hold('down')   Richtung gedrückt halten / __g.letGo() lässt alle los
    __g.walk(1/60, 60) Laufwerk von Hand takten (nützlich, wenn der Tab im
                       Hintergrund liegt und requestAnimationFrame schläft)
    __g.park()         Anzahl blockierter/erreichbarer Felder
    __g.isBlocked(c)   / __g.isReachable(c) — Hindernis-Abfrage fürs Debuggen
    __g.items()        aktuelle Item-Gitterfelder / __g.cocoonCell()
    __g.music()        { playing, ctxState } — Musikstatus
