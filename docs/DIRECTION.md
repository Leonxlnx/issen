# ISSEN 一閃 — direction & build contract

**Logline.** On a ruined sky-fortress above a sea of clouds, a lightning swordsman answers a crimson crystal witch's barrage with a single iaido draw — one flash that cuts through her crystals, the clouds, and the sky itself.

Spec: 1920×1080 @ 60 fps, ~13.5 s, rendered offline frame-by-frame (deterministic), posted on X. Quality bar = the reference stills in `ref/ref1.png … ref8.png` (look at them!). We want the same density of detail, glow, debris, depth and colour — but as a clean, cinematic, *animated* anime shot.

## Look

- Modern TV/film anime compositing (think ufotable / MAPPA "satsuei"): cel-shaded characters & props with clean line art, clean painterly backgrounds, and energy that has **white-hot cores → saturated colour → deep-colour fringe**. Bloom/diffusion is done by the compositor from the emission layer `S.L.emit` — draw crisp bright shapes there; do not fake glow with huge `shadowBlur`.
- **Colour split.** Kai = electric blue/cyan: core `#eafcff`, hot `#7fe8ff`, mid `#2a9cff`, deep `#1840d0`, darkest `#0a1a6e`. Akane = crimson crystal: core `#ffe3ec`, hot `#ff6b8f`, mid `#ff1f4f`, deep `#b0002f`, crystal body `#c8102e → #4a0014`. Moonlight: cool lavender-white from upper-left-back. Left side of frames usually blue-lit, right side red-lit.
- **Line art**: never pure black; `#0d0f22` (dark navy), ~1.5–3 px at on-screen size (scale with pixels-per-metre `p.s` from `cam.project`).
- **Cel shading**: base + hard-edged shadow tone + coloured rim light (see `celFill()` in `src/core/draw.js`; you may write your own variants in your own files).
- **Hand-drawn boil**: effect *shapes* re-randomise on 24 fps steps (`const tb = Math.floor(S.t * 24) / 24` → seeds), while *positions/transforms* move smoothly at 60 fps. Impact moments may hold 2–3 identical frames ("on twos").
- No gore, no blood. No text except the final title (handled by the director).

## Characters

- **Kai** (swordsman, ~1.78 m): black messy spiky hair; glowing cyan eyes; long white coat (open, long flowing tails), black high-collar shirt, black trousers, black belt, black boots; katana with black lacquer saya + blue sageo cord, round dark tsuba with silver rim, white-silver tsuka-ito. Electric blue aura.
- **Akane** (crystal witch, ~1.68 m): long silver-white hair (mid-back, flowing); magenta-pink glowing eyes; very long crimson scarf with long flowing tails; black sleeveless dress with side slit and red sash; long black gloves; black thigh-high boots. Crimson crystal magic.

## World

Floating ruined gothic/roman stone architecture — arches, aqueduct spans, broken fluted pillars, spires, floating rock islands carrying ruins — above an endless cloud sea under a cosmic night sky (nebula, galaxy, planet; rendered by the compositor shader). Stone: cool blue-grey (`#9aa0c8` lit, `#5d6283` base, `#2e3150` shadow, `#171a33` deep), chipped edges, cracks. Main stage: a broken stone bridge/plaza with polished, slightly wet flagstones that reflect the energy colours (see ref7).

## Coordinates & engine contract

- Metres. **x right, y DOWN, z into the screen.** Main stage floor: y = 0. Cloud-sea top around y ≈ +20…+30.
- Camera: `src/core/camera.js` — `cam.project(x,y,z) → {x,y,s,z}` (screen px; `s` = px per metre at that depth), `cam.toLocal(ctx,x,y,z)` sets a transform so you can draw in metres around that point (respects roll/shake), `cam.toScreen(ctx)` for screen-space drawing that should still shake/roll with the camera.
- A *film* module (`src/film.js`, or test films in `src/tests/*.js`) exports `FPS, DURATION, shots:[{name,start,end}], setup?(engine) (async, called once — pre-render sprites here), render(S)`.
- `render(S)` gets a fresh state each (sub)frame: `S.t` seconds, `S.frame`, `S.W/S.H`, `S.cam` (reset each frame), `S.env` (sky/cloud uniforms, see `DEFAULT_ENV` in `src/core/gl.js`), `S.post` (grading / bloom / impact-frame / shockwave uniforms, `DEFAULT_POST`), and 4 layers `S.L`:
  - `S.L.back` — additive emission **behind** everything (black background): sky rift, far explosions.
  - `S.L.scene` — normal alpha layer (ruins, characters, solid fx). Transparent where the sky shows.
  - `S.L.emit` — additive emission **in front** (black background, use `globalCompositeOperation='lighter'`). Values are boosted (×`env.emitGain`, default 2.2) and bloomed.
  - `S.L.ui` — post-tonemap overlay (titles). Rarely needed.
- **Determinism is mandatory**: never `Math.random()`, `Date.now()`, `performance.now()`. Use `RNG`, `hash1/2/3`, `noise2/3`, `fbm2/3` from `src/core/math.js`. Everything is a pure function of `S.t` (and of fixed params).
- Performance: one frame should render in well under ~1 s at 1080p. Pre-render reusable sprites (offscreen canvases via `makeCanvas`) in `setup`/build functions, keep per-frame path work reasonable.
- **Do not edit `src/core/*`, `src/main.js`, `src/film.js`, `render/*` or other builders' files.** If you need a core change, describe it in your final notes.

## Rendering / testing your work

```
node render/render.mjs --film tests/<your_test> --times 0.5,1.5,2.5 --out out/stills/<name>     # PNG stills
node render/render.mjs --film tests/<your_test> --video out/tests/<name>.mp4 --scale 0.5          # quick motion check
ffmpeg -y -i out/tests/<name>.mp4 -vf "select=not(mod(n\,6)),scale=480:-1,tile=4x4" -frames:v 1 out/stills/<name>_sheet.png   # contact sheet
```
Look at your stills with the Read tool and compare them side by side with the references in `ref/`. Iterate many times (aim for ≥ 6 render→look→fix rounds). Judge harshly: would this frame survive next to ref1–ref8 on a big screen?

## Shot list (director's cut, may be adjusted)

| # | time (s) | shot | content |
|---|---|---|---|
| 1 | 0.00–2.20 | STANDOFF wide, low angle | floating ruins, cloud sea, cosmic sky. Kai (left) and Akane (right) stand on a broken stone bridge ~10 m apart. Coat tails & scarf flutter, debris floats upward, aura crackles. Slow push-in. |
| 2 | 2.20–3.10 | HILT close-up | Kai's left thumb pushes the tsuba (koiguchi): 2–3 cm of blade slides out, a specular gleam runs along it, blue sparks leak out. |
| 3 | 3.10–3.90 | EYE extreme close-up | Kai's eye snaps open, iris ignites cyan, lightning veins; red crystal reflections in the eye. |
| 4 | 3.90–5.30 | BARRAGE | Akane thrusts her hand (over-the-shoulder / side medium shot); dozens of crimson crystals form around her and launch toward Kai / camera. |
| 5 | 5.30–6.00 | FLASH STEP | Kai vanishes into a lightning bolt; the crystals pass through his afterimage; zig-zag lightning trail through the barrage, crystals shattering in his wake; speed lines; whip pan. |
| 6 | 6.00–6.35 | IMPACT FRAMES | 4–6 alternating inverted/posterised manga frames: Kai's silhouette mid-slash before Akane, burst lines. |
| 7 | 6.35–8.40 | ISSEN | wide: a colossal blue-white crescent slash sweeps across the frame, crystals explode into shards, the slash wave races to the horizon splitting the cloud sea, a pillar is cut through, shockwave rings; Akane blown back. |
| 8 | 8.40–10.30 | AFTERMATH slow-mo | Kai landed far behind Akane (back to back), slowly sheathing; shards float/glitter; her scarf cut and drifting; slow lateral dolly. |
| 9 | 10.30–11.20 | CHIN | close on tsuba meeting saya — click. A held beat. |
| 10 | 11.20–13.50 | SKY SPLIT | wide: the cut line across sky/clouds/ruins bursts — a world-wide line of white-blue light, cloud sea splits to the horizon, pillar halves slide apart; settle on the glowing scar; title 一閃. |

## Module contracts

Each builder owns specific files and exports **exactly** these functions (extra exports and options are welcome; keep defaults sensible). All drawing functions take the frame state `S` first. Colours as `[r,g,b]` 0–255 or hex strings.

### A — world (`src/world/ruins.js`, `src/world/stage.js`, `src/world/debris.js`)
- `buildRuins(seed) → world` — pre-renders all sprites (pillars, arches, aqueducts, spires, floating islands with ruins, castle silhouettes) and lays out a default set around the stage (far horizon silhouettes to near-ish pieces), depth range z ≈ 15…600.
- `drawRuins(S, world, { zMin=-Infinity, zMax=Infinity, lightA, lightB, fog=[r,g,b], fogDensity, cut })` — depth-sorted far→near. `lightA/lightB = {x,y,z,color,k}` energy point lights → coloured rim light on the sides facing them (blue/red). Atmospheric fog toward `fog`. `cut = {pillarId?, t}` optional: a pillar sliced diagonally whose top slides off (shot 7/10).
- `drawStage(S, { lightA, lightB, cracks=0..1, glowCracks=0..1, wet=0..1 })` — the broken stone bridge/plaza the fighters stand on (floor at y=0, spanning x≈-14…14, z≈-6…14, broken jagged edges falling away into the abyss, low broken balustrade, rubble). Polished flagstones with reflections of the energy colours (fake reflection: blurred vertical streaks below light sources). Must look good from the low wide angle (shot 1/8/10).
- `makeDebris(seed, { count, box:{x0,x1,y0,y1,z0,z1} }) → field`; `drawDebris(S, field, { t, rise=0.3 (m/s upward drift), burst: {x,y,z,t0,strength}|null, zMin, zMax, lightA, lightB })` — floating rock chunks of many sizes (pebbles → 2 m boulders), slowly rotating, cel-shaded with rim lights, near ones (z close to camera) blurred (depth of field), plus fine dust motes.

### B — characters (`src/chars/rig.js`, `src/chars/kai.js`, `src/chars/akane.js`)
- `drawKai(S, o)` / `drawAkane(S, o)`; `o = { x, y, z, facing = 1|-1, pose, t, wind = {x,y}, rimA:{color,dir:{x,y},k}, rimB:{...}, eyeGlow = 0..1, aura = 0..1, silhouette = 0..1 (flat fill for impact frames, colour o.silColor), alpha = 1, smear = 0..1 }`. Feet at (x,y,z). Kai extras: `sword: 'sheathed'|'drawn'`, `bladeOut = 0..1`. Akane extras: `scarfCut = 0..1` (scarf severed, loose piece drifting), `castGlow = 0..1` (palm glow).
- Poses (string or blend `{a,b,k}`): Kai `stand`, `iai_ready` (low crouch, right hand on hilt, left thumb on tsuba), `dash` (body almost horizontal, extreme forward lean), `slash_end` (follow-through: sword arm extended back-high, blade drawn), `sheath` (upright, back to camera ¾, sliding blade into saya; `o.sheathT` 0..1). Akane `stand`, `cast` (right arm thrust forward, palm open, left arm back), `blown_back` (arched back, arms flung, hair/scarf whipping), `float`.
- Secondary motion: hair strands, coat tails and scarf react to `wind` and time (procedural, deterministic). Drawn into `S.L.scene` with rim emission into `S.L.emit`. Characters must read clearly at 250–700 px tall and silhouettes must be strong and dynamic (line of action!). Faces at medium shots: simple anime faces (eyes as glowing shapes, small nose/mouth line).

### C — close-ups (`src/chars/closeups.js`)
Full-frame screen-space compositions (draw with `S.cam.toScreen(ctx)` so shake/roll apply; may draw their own backgrounds over the env, or leave transparency to show env):
- `drawHiltCloseup(S, { t, push = 0..1, gleam = 0..1, sparks = 0..1 })` — macro shot of the katana at Kai's hip: black lacquer saya, sageo cord, round tsuba with silver rim, white tsuka-ito wrap with diamond pattern, Kai's gloved/bare left hand whose thumb pushes the tsuba; `push` slides out 2–3 cm of mirror-polished blade with hamon line; `gleam` runs a specular highlight along the exposed blade; blue electric sparks/arcs leak out of the gap. Coat fabric in background, out of focus. Dramatic lighting (cool rim + blue energy).
- `drawEyeCloseup(S, { t, open = 0..1, glow = 0..1, reflect = 0..1 })` — anime eye extreme close-up: upper lash line, lower lid, detailed iris (radial striations, cyan glow ignites from the pupil outward, lightning veins), pupil, 2 white highlights, red crystal reflections in the cornea when `reflect`; strands of black hair crossing the frame; skin with soft cel shading.
- `drawSheathCloseup(S, { t, k = 0..1 })` — blade sliding the last centimetres into the saya; at k=1 the tsuba meets the koiguchi (click): tiny spark ring.

### D — energy VFX (`src/fx/lightning.js`, `src/fx/slash.js`, `src/fx/speedlines.js`, `src/fx/impact.js`)
- `lightningBolt(S, ctx, { a:{x,y}, b:{x,y}, seed, width, color:'blue'|'red'|[...], branches = 0..1, jitter, t, tb })` — screen-space fractal bolt with branches, layered (wide deep-colour glow → hot colour → white core) into the given additive ctx; plus `boltWorld(S, {...world points})` variant.
- `drawAura(S, { x, y, z, h = 1.8, k = 0..1, color, t })` — crackling electric aura around a character: small arcs hugging the body outline area, sparks rising, ground arcs.
- `drawSlashArc(S, { cx, cy, r, a0, a1, thickness, progress = 0..1, fade = 0..1, color, t, screen = true })` — anime crescent sword slash: tapered crescent with white core, cyan band, deep blue outer, fine streak lines, trailing spark particles, slight 3D tilt option (ellipse squash `tilt`), drawn into emit (+ dark edge into scene if desired).
- `drawWorldSlash(S, { p0, p1 (screen pts), t0, t, width, travel = 0..1 })` — the colossal slash wave shooting toward the horizon (shot 7).
- `drawSkyCut(S, { y0, angle, t, open = 0..1, burst = 0..1 })` — the world-cut line: razor-thin bright line across the whole frame that bursts open into a blinding band with ragged edges, sparks and rays (shot 10).
- `drawSpeedLines(S, ctx, { kind: 'radial'|'linear', cx, cy, angle, density, k = 0..1, color, t })` — manga speed lines (tapered, varying lengths, 24 fps boil).
- `drawImpactFrame(S, { variant = 0..3, t })` — stylised manga impact frame elements for shot 6 (burst lines, silhouettes are drawn by characters with `silhouette=1`); combine with `S.post.impact = 1`, `S.post.impactMode`.

### E — crystal VFX & particles (`src/fx/crystals.js`, `src/fx/particles.js`, `src/fx/shockwave.js`)
- `makeCrystalSwarm(seed, { count, origin:{x,y,z}, target:{x,y,z}, spread }) → swarm`; `drawCrystals(S, swarm, { t, formT0, launchT0, speed, shatterAt: null | ((crystal) => time), zMin, zMax })` — faceted crimson crystal shards (elongated bipyramids, 3–6 visible facets with light/dark facet shading, bright edge highlights, inner glow core into emit, refraction-ish streaks), they *form* (grow from sparks) around Akane's hand, then fly toward the target with slight homing curves and motion streaks; when `shatterAt(c)` ≤ t they break into 6–20 tumbling fragments + glitter + flash.
- `drawShards(S, { seed, origin, t, t0, count, spread, gravity, slowmo })` — free shard explosion / slowly falling glittering shards (shot 7/8).
- `drawParticles(S, { kind: 'sparks'|'embers'|'glitter'|'dust', seed, origin, t, t0, count, color, ... })` — generic particle bursts (deterministic, closed-form trajectories).
- `drawShockwave(S, { x, y, z, t, t0, maxR, color, thickness })` — expanding ground/air ring with distortion (also sets `S.post.wave` when `o.distort`), dust skirt.
- `drawCrystalShield(S, {...})` — optional: hexagonal crystal barrier in front of Akane that gets cut.

Every builder also writes a test film `src/tests/<builder>_*.js` that shows their elements over the env (sky + clouds) at representative scales and camera angles, and leaves final stills in `out/stills/<builder>_final/`.
