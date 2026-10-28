// ISSEN 一閃 — the film. Shots are composed here from the world / character / fx modules.
import { FPS as _FPS, DURATION as _DUR, SHOTS, B } from './timeline.js';
import { clamp, lerp, E, prog, pulse, hash1, noise2, lmix, smoothstep } from './core/math.js';
import { lin } from './core/gl.js';
import { drawTitle } from './title.js';

export const FPS = _FPS;
export const DURATION = _DUR;
export const shots = SHOTS;

const M = {};      // loaded modules
const D = {};      // built data (world, debris fields, swarms)

async function load(name, path) {
  try { M[name] = await import(path); } catch (e) { console.warn(`[film] module ${path} unavailable: ${e.message}`); M[name] = null; }
}

// where the climax happens: in the air past the plaza's edge, above the cloud sea
const ISS = { A0: { x: -0.4, y: -12, z: 40 }, K: { x: 4.6, y: -11.7, z: 38.5 } };
// Kai's mark in the barrage: mid-ground plaza, left third (ref1)
const BAR_K = { x: -4.4, y: 0, z: 7.5 };

export async function setup(engine) {
  await Promise.all([
    load('ruins', './world/ruins.js'), load('stage', './world/stage.js'), load('debris', './world/debris.js'),
    load('kai', './chars/kai.js'), load('akane', './chars/akane.js'), load('close', './chars/closeups.js'),
    load('bolt', './fx/lightning.js'), load('slash', './fx/slash.js'), load('speed', './fx/speedlines.js'), load('impact', './fx/impact.js'),
    load('crys', './fx/crystals.js'), load('parts', './fx/particles.js'), load('wave', './fx/shockwave.js'),
  ]);
  try { if (M.ruins) D.world = M.ruins.buildRuins(7); } catch (e) { console.warn('[film] buildRuins failed', e.message); M.ruins = null; }
  try { if (M.close && M.close.prepareCloseups) M.close.prepareCloseups(engine ? engine.W : 1920); } catch (e) { console.warn("[film] prepareCloseups failed", e.message); }
  if (M.debris) {
    const mk = M.debris.makeDebris;
    D.debrisFar = mk(11, { count: 260, box: { x0: -40, x1: 40, y0: -30, y1: 8, z0: 8, z1: 90 } });
    D.debrisNear = mk(12, { count: 60, box: { x0: -9, x1: 9, y0: -5, y1: 1.5, z0: -9, z1: 6 } });
    // near-lens slabs that frame the wides from a corner (dark, defocused)
    const fg = { sizeMin: 0.14, sizeMax: 0.5, sizePow: 1.2 };
    D.fgStand = mk(15, { ...fg, count: 5, box: { x0: 1.5, x1: 2.4, y0: -0.3, y1: 0, z0: -2.2, z1: -1.6 } });
    D.fgBar = mk(16, { ...fg, count: 5, box: { x0: -1.7, x1: -0.9, y0: -0.35, y1: 0, z0: -2.2, z1: -1.6 } });
    D.fgIssA = mk(17, { ...fg, count: 6, box: { x0: 0.3, x1: 1.1, y0: -13.8, y1: -13.1, z0: 35.0, z1: 35.8 } });
    D.fgIssB = mk(18, { ...fg, count: 6, box: { x0: 0.3, x1: 1.1, y0: -12.0, y1: -11.5, z0: 35.0, z1: 35.8 } });
    D.fgSky = mk(19, { ...fg, count: 4, box: { x0: 1.4, x1: 2.2, y0: -0.4, y1: 0, z0: -1.6, z1: -1.0 } });
  }
  if (M.crys) {
    D.barrage = M.crys.makeCrystalSwarm(21, { count: 46, origin: { x: -0.35, y: -1.45, z: 0 }, target: { x: BAR_K.x, y: -1.1, z: BAR_K.z }, spread: 1.25 });
    D.incoming = M.crys.makeCrystalSwarm(22, { count: 64, origin: { x: 8, y: -1.8, z: 16 }, target: { x: -1.5, y: -1.1, z: 0 }, spread: 5 });
    D.cloud = M.crys.makeCrystalSwarm(23, { count: 40, origin: { x: ISS.A0.x + 1.2, y: ISS.A0.y - 0.4, z: ISS.A0.z }, target: { x: ISS.K.x, y: ISS.K.y - 1, z: ISS.K.z }, spread: 3.2, formation: "cloud" });
  }
}

// ---------------------------------------------------------------- helpers
const BLUE = [80, 190, 255], RED = [255, 40, 80];
const KAI_C = { core: '#eafcff', hot: '#7fe8ff', mid: '#2a9cff', deep: '#1840d0' };

const warned = new Set();
function call(mod, fn, ...a) {
  const m = M[mod];
  if (!m || typeof m[fn] !== 'function') return undefined;
  const S = a[0];
  const saved = S && S.L ? Object.values(S.L).map((c) => { c.save(); return c; }) : [];
  try { return m[fn](...a); }
  catch (e) { const k = mod + fn; if (!warned.has(k)) { warned.add(k); console.warn(`[film] ${mod}.${fn} failed: ${e.message}`); } }
  finally { for (const c of saved) { c.restore(); } }
}

function fighterLights(S, a, b, ka = 1, kb = 1) {
  // a, b = world points of Kai / Akane energy
  S.env.lightA = [a.x, a.y - 1, a.z, 22]; S.env.lightAC = lin('#3a8cff', 0.55 * ka);
  S.env.lightB = [b.x, b.y - 1, b.z, 22]; S.env.lightBC = lin('#ff2a55', 0.55 * kb);
  return {
    lightA: { x: a.x, y: a.y - 1, z: a.z, color: BLUE, k: ka },
    lightB: { x: b.x, y: b.y - 1, z: b.z, color: RED, k: kb },
  };
}
// call right after the camera setup so every layer shakes together. Noise runs on the frame clock:
// the offset holds still inside one frame's shutter (no dotted stars under motion blur).
function shake(S, amp, freq = 28, seed = 0, at = S.frame / FPS) {
  if (amp <= 0) return;
  const t = at * freq;
  S.cam.shakeX += noise2(t, seed + 1.7) * amp;
  S.cam.shakeY += noise2(t + 31.3, seed + 5.1) * amp;
  S.cam.shakeR += noise2(t + 77.7, seed + 9.3) * amp * 0.0006;
}
// night grade shared by all shots
function nightEnv(S) {
  // deep navy night, white cloud tops over navy valleys — the refs' value range
  const e = S.env;
  e.skyTop = lin('#01030e'); e.skyMid = lin('#061033'); e.skyHor = lin('#2f4f9e'); e.horGlow = lin('#a9c4ff', 0.32);
  e.nebula = 0.45; e.galaxy = 0; e.stars = 1.6; e.cloudScale = 0.065; e.cloudAmp = 26; e.moonDir = [-0.8, -0.28, 0.5];
  e.cloudLit = lin('#f4f7ff'); e.cloudShade = lin('#15235c'); e.cloudDeep = lin('#030820'); e.cloudRim = lin('#d4e2ff', 0.75);
  const p = S.post;
  p.contrast = 1.18; p.sat = 1.12; p.shadowTint = [-0.012, -0.004, 0.022]; p.hiTint = [0, 0.004, 0.012]; p.vignette = 0.42;
}
// cool, neutral grade for the macro inserts (no lavender wash)
function closeGrade(S) {
  S.post.gainC = [0.94, 1.0, 1.02]; S.post.shadowTint = [-0.025, -0.01, 0.0]; S.post.sat = 1.15; S.post.contrast = 1.24;
}
// Depth-sorted world passes around the fighters. zSplit = fighters' depth: everything farther is drawn
// before them, everything nearer after them. nearClip keeps rocks from smearing across the lens.
function worldBlock(S, L, o = {}) {
  const zs = o.zSplit ?? 3, fd = o.fogDensity;
  call('ruins', 'drawRuins', S, D.world, { zMin: Math.max(zs, S.cam.z + 3), ...L, fog: o.fog, fogDensity: fd, cut: o.cut });
  if (o.stage !== false) call('stage', 'drawStage', S, { ...L, cracks: o.cracks ?? 0.3, glowCracks: o.glowCracks ?? 0, wet: 0.8, props: o.props, slabScale: o.slabScale });
  call('debris', 'drawDebris', S, D.debrisFar, { t: S.t, rise: 0.35, burst: o.burst || null, ...L, fogDensity: fd, zMin: zs });
}
function nearBlock(S, L, o = {}) {
  const zs = o.zSplit ?? 3, zc = S.cam.z + (o.nearClip ?? 2.2), fd = o.fogDensity;
  if (zs > zc) {
    call('ruins', 'drawRuins', S, D.world, { zMin: zc, zMax: zs, ...L, fog: o.fog, fogDensity: fd, cut: o.cut });
    call('debris', 'drawDebris', S, D.debrisFar, { t: S.t, rise: 0.35, burst: o.burst || null, ...L, fogDensity: fd, zMin: zc, zMax: zs });
  }
  if (o.near !== false) call('debris', 'drawDebris', S, D.debrisNear, { t: S.t, rise: 0.25, burst: o.burst || null, ...L, fogDensity: fd, zMin: zc, zMax: Math.max(zc + 0.01, o.nearMax ?? zs) });
}
// a near-lens framing field, drawn last
function foreground(S, L, field) {
  if (field) call('debris', 'drawDebris', S, field, { t: S.t, rise: 0.03, ...L, zMin: -Infinity });
}
const PLAZA_FOG = 0.0026;
const PLAZA_MIST = [100, 125, 205];   // far ruins fade into pale cloud-mist, not violet murk
// the plaza floats just above the cloud tops, so the cloud sea shows past its edge
// (cloudY - cloudAmp stays below the lens height, or env() treats the camera as inside the cloud layer)
function plazaClouds(S) { S.env.cloudY = 7.5; S.env.cloudAmp = 7.6; S.env.cloudScale = 0.045; }

// ---------------------------------------------------------------- shots
const SHOT = {};

// 1 — STANDOFF: worm's-eye wide (ref7). Kai big in the left foreground, Akane right; their energies
// collide between them at 0.3 s, then a slow push and a snap zoom into the hilt.
SHOT.standoff = (S, lt) => {
  const p = lt / 2.2;
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = 0.08;
  cam.x = lerp(0.85, 0.2, E.outCubic(p)); cam.y = -0.45; cam.z = lerp(-4.6, -3.4, E.outCubic(p));
  cam.fov = 50; cam.cy = S.H * 0.66; cam.roll = lerp(0.09, 0.11, p);
  cam.zoom = 1 + 0.06 * E.inQuad(prog(S.t, 2.05, 2.2));
  shake(S, 10 * pulse(S.t, B.clash, 0.01, 0.3));
  const K = { x: -1.55, y: 0, z: 0 }, A = { x: 2.75, y: 0, z: 1.3 };
  const clash = pulse(S.t, B.clash, 0.02, 0.5);
  const flick = 0.85 + 0.15 * noise2(S.t * 9, 3);
  const L = fighterLights(S, K, A, 0.9 * flick + clash, 0.9 + clash);
  const burst = { x: 0.6, y: -1.2, z: 0.65, t0: B.clash, strength: 0.6, radius: 6 };
  plazaClouds(S); worldBlock(S, L, { zSplit: A.z + 0.5, burst, fogDensity: 0.0014, fog: PLAZA_MIST, props: false, slabScale: 0.6 });
  // the clash blows OUTWARD from the middle: Kai's coat streams left, her hair/scarf stream right (ref7)
  const gust = 1 + 1.6 * pulse(S.t, B.clash, 0.02, 0.6);
  const windK = { x: -1.2 * gust, y: -0.3 }, windA = { x: 1.6 * gust, y: -0.3 };
  const kp = cam.project(K.x, -1.0, K.z), ap = cam.project(A.x, -0.95, A.z), mid = cam.project(0.6, -1.2, 0.65);
  call('bolt', 'drawCrackleField', S, { ctx: S.L.scene, under: S.L.scene, cx: ap.x, cy: ap.y, rx: S.W * 0.26, ry: S.H * 0.5, angle: 3.5, density: 1, k: 0.62 + 0.3 * clash, color: 'red', t: S.t, seed: 18, haze: 0.16 });
  call('bolt', 'drawAura', S, { x: A.x, y: A.y, z: A.z, h: 1.7, k: 0.45 + 0.6 * clash, color: 'red', t: S.t, seed: 9, ctx: S.L.scene });
  call('akane', 'drawAkane', S, { ...A, facing: -1, pose: 'stand', t: S.t, wind: windA, rimA: { color: BLUE, dir: { x: -1, y: -0.25 }, k: 0.75 }, rimB: { color: RED, dir: { x: 1, y: -0.3 }, k: 1 }, eyeGlow: 0.9, aura: 0.5 });
  call('parts', 'drawParticles', S, { kind: 'embers', seed: 3, origin: { x: A.x, y: -0.5, z: A.z }, t: S.t, t0: -2, count: 160, color: 'red' });
  call('debris', 'drawDebris', S, D.debrisNear, { t: S.t, rise: 0.25, burst, ...L, fogDensity: PLAZA_FOG, zMin: K.z, zMax: A.z + 0.5 });
  if (mid) {
    // the clash: each fighter's energy lashes out and meets in the middle
    const lash = 1 - prog(S.t, B.clash + 0.12, B.clash + 0.45);
    if (S.t >= B.clash - 0.06 && lash > 0) {
      const reach = prog(S.t, B.clash - 0.06, B.clash, E.outCubic), kc = cam.project(K.x + 0.3, -1.3, K.z), ac = cam.project(A.x - 0.2, -1.2, A.z);
      if (kc) call('bolt', 'lightningBolt', S, S.L.emit, { a: kc, b: { x: lerp(kc.x, mid.x, reach), y: lerp(kc.y, mid.y, reach) }, seed: 81, width: 10 * lash, color: 'blue', branches: 0.8, jitter: 0.9, t: S.t });
      if (ac) call('bolt', 'lightningBolt', S, S.L.emit, { a: ac, b: { x: lerp(ac.x, mid.x, reach), y: lerp(ac.y, mid.y, reach) }, seed: 82, width: 8 * lash, color: 'red', branches: 0.8, jitter: 0.9, t: S.t });
    }
    call('impact', 'drawEnergyBurst', S, { x: mid.x, y: mid.y, t: S.t, t0: B.clash, dur: 0.7, r: S.H * 0.32, color: 'blue', colorB: 'red', splitAngle: Math.PI / 2, k: 0.95 });
    call('wave', 'drawShockwave', S, { x: 0.6, y: -1.2, z: 0.65, t: S.t, t0: B.clash, maxR: 4, color: 'cyan', thickness: 0.4, plane: 'screen', tilt: 0.3, rot: 0, distort: 0.6 });
  }
  call('bolt', 'drawCrackleField', S, { ctx: S.L.scene, under: S.L.scene, cx: kp.x, cy: kp.y, rx: S.W * 0.3, ry: S.H * 0.6, angle: -0.35, density: 1, k: 0.7 + 0.3 * clash, color: 'blue', t: S.t, seed: 17, haze: 0.18 });
  call('bolt', 'drawAura', S, { x: K.x, y: K.y, z: K.z, h: 1.8, k: 0.6 + 0.6 * clash, color: 'blue', t: S.t, ctx: S.L.scene });
  call('kai', 'drawKai', S, { ...K, facing: 1, pose: 'stand', t: S.t, wind: windK, rimA: { color: BLUE, dir: { x: -1, y: -0.3 }, k: 1 }, rimB: { color: RED, dir: { x: 1, y: -0.1 }, k: 0.7 }, eyeGlow: 0.9, aura: 0.5, sword: 'sheathed' });
  call('parts', 'drawParticles', S, { kind: 'sparks', seed: 4, origin: { x: K.x, y: -0.5, z: K.z }, t: S.t, t0: -2, count: 140, color: 'blue' });
  call('debris', 'drawDebris', S, D.debrisNear, { t: S.t, rise: 0.25, burst, ...L, fogDensity: PLAZA_FOG, zMin: S.cam.z + 2.2, zMax: K.z });
  foreground(S, L, D.fgStand);
  S.post.flash = 0.3 * pulse(S.t, B.clash, 0.0, 0.03);
  S.post.vignette = 0.42;
};

// 2 — HILT: koiguchi click, blade gleam, sparks.
SHOT.hilt = (S, lt) => {
  nightEnv(S); S.env.cloudOn = 0; S.env.skyGain = 0.35;
  S.cam.roll = lerp(0.025, -0.01, lt / 0.8);
  shake(S, 6 * pulse(S.t, B.koiguchi, 0.01, 0.08));
  const push = prog(S.t, B.koiguchi - 0.05, B.koiguchi + 0.09, E.outExpo);
  call('close', 'drawHiltCloseup', S, { t: lt, push, zoom: 1 + 0.03 * prog(S.t, 2.2, 2.42), gleam: prog(S.t, B.gleam, B.gleam + 0.32, E.inOutSine), sparks: clamp(push * 1.2) });
  S.post.vignette = 0.55;
};

// 3 — EYE: snaps open and ignites.
SHOT.eye = (S, lt) => {
  nightEnv(S); S.env.cloudOn = 0; S.env.skyGain = 0.3;
  S.cam.roll = lerp(-0.02, 0.012, lt / 0.9);
  shake(S, 4 * pulse(S.t, B.eyeIgnite, 0.01, 0.12));
  call('close', 'drawEyeCloseup', S, {
    t: lt, open: prog(S.t, B.eyeOpen, B.eyeOpen + 0.1, E.outBack), glow: prog(S.t, B.eyeIgnite, B.eyeIgnite + 0.22, E.outCubic), reflect: prog(S.t, 3.5, 3.85), zoom: 1 + 0.08 * E.inQuad(prog(S.t, 3.45, 3.9)),
  });
  closeGrade(S);
  S.post.vignette = 0.6;
};

// 4 — BARRAGE (ref1): low dutch angle on Akane; crystals form and fan out toward Kai, small in the
// mid-ground left. Whip-pans out on the cut.
SHOT.barrage = (S, lt) => {
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = 0.35;
  const sh = S.shot, p = lt / (sh.end - sh.start);
  cam.x = lerp(0.2, -0.1, E.inOutSine(p)) - 2.6 * E.inExpo(prog(S.t, sh.end - 0.14, sh.end)); cam.y = -0.6; cam.z = lerp(-3.9, -3.5, E.dolly(p));
  cam.fov = 46; cam.cy = S.H * 0.66; cam.roll = -0.12;
  shake(S, 5 * pulse(S.t, B.crystalsLaunch, 0.02, 0.2));
  const A = { x: 1.6, y: 0, z: 0 }, K = BAR_K;
  const cast = prog(S.t, B.akaneCast - 0.08, B.akaneCast + 0.08, E.outCubic);
  const L = fighterLights(S, K, A, 1.0, 0.8 + 0.6 * cast);
  plazaClouds(S); worldBlock(S, L, { zSplit: K.z + 0.5, fogDensity: 0.0014, fog: PLAZA_MIST, props: false, slabScale: 0.6 });
  // his blue lightning answers her red across the frame (ref1)
  const kpx = cam.project(K.x + 0.6, -1.1, K.z);
  if (kpx) call('bolt', 'drawCrackleField', S, { ctx: S.L.scene, under: S.L.scene, cx: kpx.x, cy: kpx.y, rx: S.W * 0.2, ry: S.H * 0.34, angle: -0.15, density: 0.9, k: 0.8, color: 'blue', t: S.t, seed: 19, haze: 0.14 });
  call('bolt', 'drawAura', S, { x: K.x, y: K.y, z: K.z, h: 1.8, k: 1.3, color: 'blue', t: S.t });
  call('kai', 'drawKai', S, { ...K, facing: 1, pose: 'iai_ready', t: S.t, wind: { x: 0.5, y: 0 }, eyeGlow: 1, aura: 0.8, sword: 'sheathed' });
  nearBlock(S, L, { zSplit: K.z + 0.5, nearMax: 0.6, near: false, fogDensity: PLAZA_FOG });
  call('crys', 'drawCrystals', S, D.barrage, { t: S.t, formT0: B.crystalsForm, launchT0: B.crystalsLaunch, speed: 22, zMin: 0.6 });
  const apx = cam.project(A.x - 1.5, -1.3, A.z);
  if (apx) call('bolt', 'drawCrackleField', S, { cx: apx.x, cy: apx.y, rx: S.W * 0.3, ry: S.H * 0.26, angle: Math.PI + 0.12, density: 0.8, k: 0.45 * cast, color: 'red', t: S.t, seed: 27, haze: 0.1 });
  // pose blend on the frame clock: a quantised pose must not change inside one frame's motion-blur shutter
  const castPose = prog(S.frame / FPS, B.akaneCast - 0.08, B.akaneCast + 0.08, E.outCubic);
  const ra = call('akane', 'drawAkane', S, { ...A, facing: -1, pose: { a: 'stand', b: 'cast', k: castPose }, t: S.t, wind: { x: 0.6, y: -0.1 }, rimA: { color: RED, dir: { x: -1, y: 0 }, k: 1 }, rimB: { color: BLUE, dir: { x: -1, y: -0.3 }, k: 0.4 }, eyeGlow: 1, castGlow: 0.6 * cast, aura: 0.5 });
  const palm = (ra && ra.pts && ra.pts.palm) || { x: A.x - 0.6, y: -1.3, z: A.z };
  call('crys', 'drawCrystalRibbons', S, { origin: { x: palm.x, y: palm.y, z: palm.z }, target: { x: K.x, y: -1.1, z: K.z }, t: S.t, t0: B.akaneCast, grow: 0.4, k: cast * (1 - 0.6 * prog(S.t, B.crystalsLaunch + 0.2, sh.end)), count: 5, length: 4.5, radius: 0.45, spreadR: 1.8, width: 0.45, color: 'red', seed: 7 });
  call('crys', 'drawCrystals', S, D.barrage, { t: S.t, formT0: B.crystalsForm, launchT0: B.crystalsLaunch, speed: 22, zMax: 0.6 });
  call('debris', 'drawDebris', S, D.debrisNear, { t: S.t, rise: 0.25, ...L, fogDensity: PLAZA_FOG, zMin: S.cam.z + 2.2, zMax: 0.6 });
  foreground(S, L, D.fgBar);
  S.post.vignette = 0.45;
};

// 5 — FLASH STEP: low angle on Kai, the iai stance builds; the wall of crystals arrives; he vanishes
// into lightning that cuts through them. Then the breath: the shards hang, colour drains.
SHOT.flashstep = (S, lt) => {
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = -0.25;
  const whip = E.whip(prog(S.t, B.vanish + 0.03, B.vanish + 0.33));
  cam.x = lerp(-0.2, 3.6, whip) + 1.6 * (1 - E.outCubic(prog(S.t, S.shot.start, S.shot.start + 0.16))); cam.y = -0.5; cam.z = lerp(-4.4, -4.0, E.inQuad(prog(S.t, S.shot.start, B.vanish)));
  cam.fov = 44; cam.cy = S.H * 0.66; cam.roll = lerp(0.08, -0.1, whip);
  if (S.t < B.breath) shake(S, 26 * pulse(S.t, B.vanish, 0.01, 0.14), 34);
  const K = { x: -1.6, y: 0, z: 0 };
  const L = fighterLights(S, K, { x: 12, y: -1, z: 28 }, 1.2 + 2.5 * pulse(S.t, B.vanish, 0.01, 0.2), 0.5);
  plazaClouds(S); worldBlock(S, L, { fogDensity: PLAZA_FOG, props: false, slabScale: 0.6 });
  const gone = S.t >= B.vanish;
  // crystal time: they hang in the breath before the hit
  const tc = S.t < B.breath ? S.t : B.breath + (S.t - B.breath) * 0.06;
  const shatterAt = (c) => B.vanish + 0.04 + clamp((c.x ?? 0) + 2, 0, 16) * 0.012;
  call('crys', 'drawCrystals', S, D.incoming, { t: tc, formT0: 4.6, launchT0: 5.12, speed: 50, shatterAt });
  if (!gone) {
    const build = prog(S.t, 5.3, B.vanish, E.inQuad);
    call('bolt', 'drawAura', S, { x: K.x, y: K.y, z: K.z, h: 1.8, k: 0.8 + 0.7 * build, color: 'blue', t: S.t, ctx: S.L.scene });
    // frame clock: the quantised iai->dash blend must not change inside the 8-sample shutter (double face)
    const lean = 0.3 * prog(S.frame / FPS, B.vanish - 0.1, B.vanish, E.inQuad);
    call('kai', 'drawKai', S, { ...K, facing: 1, pose: { a: 'iai_ready', b: 'dash', k: lean }, t: S.t, wind: { x: -0.3, y: 0 }, rimA: { color: BLUE, dir: { x: 1, y: -0.2 }, k: 1 }, eyeGlow: 1 + 0.4 * build, aura: 0.6 + 0.4 * build, sword: 'sheathed' });
  } else {
    const fade = 1 - prog(S.t, B.vanish, B.vanish + 0.18);
    call('kai', 'drawKai', S, { ...K, facing: 1, pose: 'dash', t: S.t, alpha: fade * 0.6, smear: 1, silhouette: 1, silColor: [120, 220, 255] });
    // the lightning path through the barrage
    const pts = [[-1.6, -1.0, 0], [1.5, -1.6, 4], [3.5, -0.8, 9], [6, -1.7, 15], [9, -1.1, 22]];
    const prj = pts.map((q) => S.cam.project(q[0], q[1], q[2])).filter(Boolean);
    const life = 1 - prog(S.t, B.vanish + 0.12, B.vanish + 0.38);
    for (let i = 0; i < prj.length - 1 && life > 0; i++) {
      const reach = prog(S.t, B.vanish + i * 0.025, B.vanish + i * 0.025 + 0.03);
      if (reach <= 0) continue;
      const a = prj[i], b = prj[i + 1];
      call('bolt', 'lightningBolt', S, S.L.emit, { a, b: { x: lerp(a.x, b.x, reach), y: lerp(a.y, b.y, reach) }, seed: 50 + i, width: 9 * life + 2, color: 'blue', branches: 0.7, jitter: 1, t: S.t });
    }
  }
  call('speed', 'drawSpeedLines', S, S.L.emit, { kind: 'linear', cx: S.W / 2, cy: S.H / 2, angle: -0.12, density: 1, k: 0.6 * prog(S.t, B.vanish, B.vanish + 0.05) * (1 - prog(S.t, B.vanish + 0.25, B.vanish + 0.38)), color: [120, 190, 255], t: S.t });
  nearBlock(S, L, { fogDensity: PLAZA_FOG });
  // two hard white frames, then a clean cut back; exposure punches through the bloom
  S.post.flash = (S.t >= B.vanish && S.t < B.vanish + 2 / 60) ? 0.9 : 0;
  S.post.flashCol = [0.85, 0.95, 1];
  S.post.radial = [0.4, 0.5, 0.08 * pulse(S.t, B.vanish + 0.05, 0.05, 0.2)];
  // the breath before the impact: the frame hangs, dims and drains
  const br = prog(S.t, B.breath, B.breath + 0.04);
  S.post.exposure = (1 + 0.6 * pulse(S.t, B.vanish, 0.01, 0.08)) * (1 - 0.35 * br);
  S.post.sat = lerp(1.12, 0.45, br);
};

// 6 — IMPACT FRAMES: posterised manga cards, 3 frames each. Cards 0-2: he lunges into her;
// cards 3-6: he is through, back to back — which sets up the ISSEN layout (Kai right, Akane left).
SHOT.impact = (S, lt) => {
  const { cam } = S;
  nightEnv(S);
  const fi = Math.max(0, S.frame - Math.round(B.impact * FPS));
  const card = Math.min(6, Math.floor(fi / 3));
  const zoomSeq = [1.0, 1.45, 1.15, 1.8, 1.0, 1.3, 1.5];
  const rollSeq = [0.05, -0.18, 0.12, -0.08, 0.2, -0.05, -0.12];
  const through = card >= 3;
  cam.x = through ? 2.5 : 0.4; cam.y = -0.6; cam.z = -5.2; cam.fov = 42; cam.cy = S.H * 0.64;
  cam.zoom = zoomSeq[card]; cam.roll = rollSeq[card];
  // card clock: plate boil and shake hold for the whole card (true 3-frame holds)
  const tCard = B.impact + card * 3 / FPS;
  S.t = tCard;   // every S.t-driven layer (rig streak boil, debris) holds for the card too
  shake(S, 30, 40, card, tCard);
  const A = { x: 2.0, y: 0, z: 0.9 };
  // airborne lunge: his head on her chest line (not her hips); through: head stays inside the zoomed frame
  const K = { x: through ? 4.2 : [-1.1, -0.4, 0.3][card], y: through ? 0 : -0.5, z: through ? 0 : -0.25 };
  const kPose = through ? 'slash_end' : 'dash', aPose = through ? 'blown_back' : 'cast';
  const kp = cam.project(K.x, -1, K.z), apj = cam.project(A.x, -1, A.z);
  const arc = { cx: kp && apj ? (kp.x + apj.x) / 2 : S.W * 0.5, cy: S.H * 0.5, r: S.H * 0.62, a0: -2.6, a1: 0.4, thickness: 70, progress: through ? 1 : [0.15, 0.5, 0.8][card], color: 'blue', t: 6.0, tilt: 0.35 };
  const L = fighterLights(S, K, A, 3, 2);
  // cards: one colour frame, then manga plates that only get brighter into the issen white —
  // one flash instead of a black/white strobe (stays under 3 flashes per second)
  const seq = [-1, 1, 2, 0, 3, 0, 3];
  const v = seq[card];
  if (v >= 0) {
    // the plate first, then flat silhouettes on top of it, then the slash (emission prints white)
    const ink = call('impact', 'drawImpactFrame', S, { variant: v, t: tCard, seed: 21 + card }) || {};
    const sil = ink.silColor || [8, 8, 12];
    call('akane', 'drawAkane', S, { ...A, facing: -1, pose: aPose, t: 6.0, silhouette: 1, silColor: sil });
    call('kai', 'drawKai', S, { ...K, facing: 1, pose: kPose, t: 6.0, sword: 'drawn', bladeOut: 1, silhouette: 1, silColor: sil });
    call('slash', 'drawSlashArc', S, { ...arc, fade: 0 });
  } else {
    worldBlock(S, L, { stage: false });
    call('akane', 'drawAkane', S, { ...A, facing: -1, pose: aPose, t: 6.0, rimA: { color: BLUE, dir: { x: -1, y: 0 }, k: 1.5 }, eyeGlow: 0.6 });
    call('kai', 'drawKai', S, { ...K, facing: 1, pose: kPose, t: 6.0, sword: 'drawn', bladeOut: 1, rimA: { color: BLUE, dir: { x: 1, y: -0.2 }, k: 1.4 }, eyeGlow: 1.3, aura: 1, smear: through ? 0 : 0.6 });
    call('slash', 'drawSlashArc', S, { ...arc, fade: 0.05 });
    S.post.impact = 0; S.post.bloomStr = 1.2; S.post.flash = 0; S.post.exposure = 0.85; S.post.contrast = 1.3; S.env.envGain = 0.6;
  }
  S.post.ca = 0.006;
};

// 7 — ISSEN: in the air past the plaza's edge. (a) Hero two-shot at the fighters' level: Kai through
// and past her, the crescent, the crystals explode (ref3). (b) The wide: the wave races down the
// cloud sea and splits it to the horizon.
SHOT.issen = (S, lt) => {
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = 0.0;
  const { A0, K } = ISS;
  // frame clock: all motion-blur samples of one frame pick the same camera (no double-exposed cut)
  const hero = S.frame < Math.round(B.issenWide * FPS), end = S.shot.end;
  if (hero) {
    const q = lt / (B.issenWide - B.slash);
    cam.x = 2.3; cam.y = -12.3; cam.z = lerp(33.0, 33.8, E.outCubic(q)); cam.fov = 48; cam.cy = S.H * 0.66; cam.roll = lerp(-0.12, -0.08, q);
  } else {
    const q = prog(S.t, B.issenWide, end);
    cam.x = lerp(1.7, 1.2, E.outCubic(q)); cam.y = lerp(-17.0, -15.9, E.inOutSine(q)); cam.z = lerp(25.6, 29.6, E.outQuad(q));
    cam.fov = 46; cam.cy = S.H * 0.38; cam.roll = lerp(-0.1, -0.04, E.outCubic(q));
  }
  shake(S, 34 * pulse(S.t, B.slash, 0.01, 0.35) + 3 * prog(S.t, B.waveOut, end) * (1 - prog(S.t, 7.5, end)) + 8 * pulse(S.t, B.issenWide, 0.01, 0.2), 30);
  const blow = E.outExpo(prog(S.t, B.slash, B.slash + 1.4));
  const fall = prog(S.t, B.slash + 0.5, end, E.inQuad);
  // hero two-shot: she is thrown across the frame, not away from the lens (keeps her readable); the wide gets the depth
  const A = { x: A0.x - (hero ? 1.0 : 2.4) * blow, y: A0.y + (hero ? 0.35 : -1.0) * blow + 6 * fall, z: A0.z + (hero ? 1.0 : 3.0) * blow };
  const split = prog(S.t, B.waveOut, B.waveOut + 1.1, E.outCubic);
  S.env.split = [A0.x, A0.z + 4, Math.PI / 2, 1]; S.env.splitW = lerp(0, 10, split);
  S.env.splitGlow = lin('#58b8ff', 1.8 * (1 - 0.3 * prog(S.t, 7.0, end)));
  S.env.envGain = 1 - 0.3 * (1 - prog(S.t, 6.9, 7.8));
  const L = fighterLights(S, K, A, 2.4 - 1.2 * prog(S.t, 6.5, 7.8), 0.6);
  const burst = { x: A0.x, y: A0.y - 0.5, z: A0.z, t0: B.slash, strength: 1.2, radius: 14 };
  worldBlock(S, L, { stage: false, zSplit: A0.z + 3.5, burst });
  const ap = cam.project(A0.x, A0.y - 1.0, A0.z) || { x: S.W * 0.5, y: S.H * 0.5 };
  const decay = 1 - prog(S.t, B.slash + 0.3, 7.8);
  const s0 = B.slash - 1 / 60;   // the slash is already on the first frame of the shot
  // the wave on the cloud sea (under everything else)
  const c0 = cam.project(A0.x, 24, A0.z + 6), c1 = cam.project(A0.x, 24, 900);
  if (c0 && c1) call('slash', 'drawWorldSlash', S, { p0: c0, p1: c1, t0: B.waveOut, t: S.t, widthM: 16, travel: prog(S.t, B.waveOut, B.waveOut + 1.0), fade: prog(S.t, 7.5, end + 0.2), paint: 0.8 });
  call('wave', 'drawShockwave', S, { x: A0.x, y: A0.y - 1, z: A0.z, t: S.t, t0: B.slash + 0.02, maxR: 9, color: 'cyan', thickness: 0.6, plane: 'screen', tilt: 0.8, rot: -0.3, distort: 1 });
  call('bolt', 'drawCrackleField', S, { ctx: S.L.scene, under: S.L.scene, cx: ap.x, cy: ap.y, rx: S.W * 0.36, ry: S.H * 0.34, angle: -0.35, density: 1, k: 0.4 * (0.3 + 0.7 * decay) * prog(S.t, B.slash, B.slash + 0.05), color: 'blue', t: S.t, seed: 61, haze: 0.08 });
  call('crys', 'drawCrystals', S, D.cloud, { t: S.t, formT0: 4.0, launchT0: 99, shatterAt: () => B.shatter });
  call('crys', 'drawShards', S, { seed: 31, origin: { x: A0.x, y: A0.y - 1, z: A0.z }, t: S.t, t0: B.shatter, count: 140, spread: 1.6, speed: 9, gravity: 2.2, palette: 'crimson', flash: 0.3 });
  // she paints over her own shard cloud so both fighters read (ref3); a hard rim finds her in the wide
  call('akane', 'drawAkane', S, { ...A, facing: -1, pose: 'blown_back', t: S.t, wind: { x: -1.6, y: -0.6 }, scarfCut: prog(S.t, B.shatter, B.shatter + 0.05), rimA: { color: BLUE, dir: { x: 1, y: -0.2 }, k: hero ? 1.6 : 2.2 }, eyeGlow: 0.6 });
  call('bolt', 'drawAura', S, { x: K.x, y: K.y, z: K.z, h: 1.8, k: 0.9 * decay + 0.2, color: 'blue', t: S.t, ctx: S.L.scene });
  const kr = call('kai', 'drawKai', S, { ...K, facing: 1, pose: 'slash_end', t: S.t, sword: 'drawn', bladeOut: 1, wind: { x: -0.8, y: -0.3 }, rimA: { color: BLUE, dir: { x: -1, y: -0.3 }, k: 1.1 }, eyeGlow: 1.2, aura: 1 - 0.4 * prog(S.t, 6.6, 7.6) });
  // the pass-through: the lightning trail he left through her
  const trail = 1 - prog(S.t, B.slash, B.slash + 0.4);
  const kc = cam.project(K.x, K.y - 1, K.z);
  if (trail > 0 && kc) call('bolt', 'lightningBolt', S, S.L.emit, { a: ap, b: kc, seed: 71, width: 14 * trail, color: 'blue', branches: 0.5, jitter: 0.6, t: S.t });
  // the crescent itself, sweeping over Akane, drawn after both fighters
  call('slash', 'drawSlashArc', S, { cx: ap.x + S.W * 0.02, cy: ap.y + S.H * 0.05, r: S.H * 0.44, a0: -2.5, a1: -0.05, thickness: 120, progress: prog(S.t, s0, B.slash + 0.08, E.outQuart), fade: prog(S.t, B.slash + 0.12, B.slash + 0.7), color: 'blue', t: S.t, tilt: 0.28, rot: -0.45, paint: 0.45 });
  call('impact', 'drawEnergyBurst', S, { x: ap.x, y: ap.y, t: S.t, t0: s0, dur: 0.35, r: S.H * 0.3, color: 'blue', colorB: 'red', splitAngle: Math.PI, k: 0.18 });
  if (!hero) {
    // ref6: concentric energy rings on the fighters' plane and a crackle sheet along the cut
    call('wave', 'drawShockwave', S, { x: A0.x + 2, y: A0.y - 1, z: A0.z, t: S.t, t0: B.issenWide - 0.12, maxR: 26, duration: 1.0, color: 'cyan', thickness: 1.2, plane: 'ground', rings: 3, ringDelay: 0.09, dust: 0, wall: 0, seed: 7 });
    call('bolt', 'drawCrackleField', S, { cx: ap.x, cy: ap.y + S.H * 0.05, rx: S.W * 0.42, ry: S.H * 0.2, angle: 0.15, density: 1, k: 0.25 * (1 - prog(S.t, 7.55, end)), color: 'blue', t: S.t, seed: 63, haze: 0.1 });
  }
  nearBlock(S, L, { zSplit: A0.z - 2, burst, near: false });
  if (hero) { foreground(S, L, D.fgIssA); foreground(S, L, D.fgIssB); }
  S.post.flash = lt < 2 / 60 ? 0.9 : 0.5 * pulse(S.t, B.slash, 0.004, 0.03);
  S.post.ca = 0.001 + 0.0025 * pulse(S.t, B.slash, 0.01, 0.25);
  S.post.bloomStr = 0.9 + 0.35 * pulse(S.t, B.slash, 0.01, 0.15);
  S.post.streak = 0.25 + 0.4 * pulse(S.t, B.slash, 0.01, 0.4);
  S.post.thresh = 1.1;
};

// 8 — AFTERMATH (slow motion): a level, still frame after the storm. Kai sheathes on the right with
// his back to her; the cut waits in the sky; shards glitter; Akane falls in the left third.
SHOT.aftermath = (S, lt) => {
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = -0.15;
  const p = lt / (S.shot.end - S.shot.start);
  cam.x = lerp(-0.3, 0.2, E.inOutSine(p)); cam.y = -1.45; cam.z = lerp(-3.5, -3.25, p); cam.fov = 40; cam.cy = S.H * 0.6; cam.roll = lerp(0.025, 0, p);
  const K = { x: 1.15, y: 0, z: 0 }, A = { x: -3.0, y: -3.2 + 6.5 * E.inQuad(p), z: 16 };
  S.env.split = [3, 30, Math.PI / 2, 1]; S.env.splitW = 10; S.env.splitGlow = lin('#58b8ff', 0.45);
  const L = fighterLights(S, K, A, 0.7, 0.3);
  worldBlock(S, L, { stage: false, zSplit: 1 });
  call('slash', 'drawSkyCut', S, { y0: S.H * 0.22, angle: -0.18, t: S.t, open: 0, burst: 0, k: 0.8, violet: 0.15 });
  call('akane', 'drawAkane', S, { ...A, facing: 1, pose: 'blown_back', t: 7.4 + lt * 0.15, scarfCut: 1, wind: { x: 0.3, y: -0.8 }, rimA: { color: BLUE, dir: { x: 1, y: 0 }, k: 1.0 } });
  call('crys', 'drawShards', S, { seed: 41, t: S.t, t0: 6.0, count: 160, life: 30, slowmo: 0.15, palette: 'prism', box: { x0: -8, x1: 6, y0: -6, y1: 0, z0: 1.5, z1: 14 } });
  call('crys', 'drawShards', S, { seed: 43, t: S.t, t0: 6.0, count: 90, life: 30, slowmo: 0.15, palette: 'crimson', box: { x0: -7, x1: 5, y0: -5, y1: 0, z0: 1.5, z1: 10 } });
  call('kai', 'drawKai', S, { ...K, facing: 1, pose: 'sheath', sheathT: lerp(0, 0.88, E.inOutSine(p)), t: S.t, sword: 'drawn', wind: { x: 0.3, y: -0.1 }, rimA: { color: BLUE, dir: { x: 1, y: -0.3 }, k: 1 }, rimB: { color: RED, dir: { x: -1, y: 0 }, k: 0.35 }, eyeGlow: 0.8 });
  call('parts', 'drawParticles', S, { kind: 'glitter', seed: 42, origin: { x: 0.5, y: -1.8, z: 1.2 }, t: S.t, t0: S.shot.start - 0.4, count: 90, color: 'prism', slowmo: 0.3 });
  S.post.sat = 1.0; S.post.vignette = 0.5;
};

// 9 — CHIN: the guard meets the scabbard.
SHOT.chin = (S, lt) => {
  nightEnv(S);
  call('close', 'closeupGrade', S, 'sheath');
  shake(S, 9 * pulse(S.t, B.sheathClick, 0.005, 0.08));
  const x = clamp(lt / (B.sheathClick - S.shot.start));
  call('close', 'drawSheathCloseup', S, { t: lt, k: 0.4 * x + 0.6 * x * x * x, click: S.t - B.sheathClick });
  S.post.flash = 0.25 * pulse(S.t, B.sheathClick, 0.003, 0.05);
  closeGrade(S);
};

// 10 — SKY SPLIT: behind Kai, the delayed cut bursts across the whole sky; every ruin on the line
// is sliced and slides; the cloud canyon tears wide; a continuous pull-back; the title hits on the taiko.
SHOT.skysplit = (S, lt) => {
  const { cam } = S;
  nightEnv(S); S.env.skyYaw = 0.05;
  const burst = prog(S.t, B.skyBurst, B.skyBurst + 0.5, E.outExpo);
  const settle = prog(S.t, B.skyBurst + 0.2, DURATION, E.outCubic);
  const pull = prog(S.t, S.shot.start, DURATION);
  cam.x = lerp(3.3, 3.0, settle); cam.y = lerp(-1.35, -1.25, settle); cam.z = lerp(-3.2, -4.6, pull); cam.fov = 52; cam.cy = S.H * 0.7; cam.roll = -0.06;
  const K = { x: 4.3, y: 0, z: -0.6 };
  const hit = B.title + 0.04;
  // one big hit, held on twos and decaying fast — not a 60 Hz buzz under the title
  shake(S, 40 * pulse(S.t, B.skyBurst, 0.01, 0.2) + 8 * pulse(S.t, hit, 0.005, 0.12), 12, 0, Math.floor(S.frame / 2) * 2 / FPS);
  if (S.t < B.skyBurst) shake(S, 2 * prog(S.t, S.shot.start, B.skyBurst), 18, 3);
  S.env.split = [1.8, 90, Math.PI / 2 - 0.08, 1]; S.env.splitW = lerp(10, 36, burst); S.env.splitGlow = lin('#7cc8ff', 0.5 + 1.6 * pulse(S.t, B.skyBurst, 0.05, 0.6));
  const L = fighterLights(S, { x: 1.8, y: -12, z: 60 }, { x: 4, y: 0, z: 40 }, 0.6 + 3 * pulse(S.t, B.skyBurst, 0.02, 0.5), 0.15);
  const y0 = S.H * 0.2, ang = -0.18, tn = Math.tan(ang);
  const line = { x0: 0, y0: y0 - tn * S.W * 0.5, x1: S.W, y1: y0 + tn * S.W * 0.5 };
  const cut = { screen: line, t: burst, slide: 2.2 * burst + 0.6 * settle + 1.6 * prog(S.t, B.skyBurst, DURATION), glow: 1.0 * (1 - 0.6 * settle), dir: 1 };
  worldBlock(S, L, { stage: false, zSplit: 1, cut, burst: { x: 1.8, y: -10, z: 60, t0: B.skyBurst, strength: 1.5, radius: 30 } });
  call('slash', 'drawSkyCut', S, { y0, angle: ang, t: S.t, open: 0.6 * burst + 0.15, burst: pulse(S.t, B.skyBurst, 0.02, 0.9), t0: B.skyBurst, violet: 0.15 });
  call('crys', 'drawShards', S, { seed: 51, origin: { x: 2, y: -31, z: 60 }, t: S.t, t0: B.skyBurst, count: 200, spread: 20, speed: 14, gravity: 1.2, slowmo: 0.6, palette: 'ice', flash: 0.25 });
  call('kai', 'drawKai', S, { ...K, facing: -1, pose: 'stand', t: S.t, sword: 'sheathed', wind: { x: -1.2, y: -0.3 }, rimA: { color: BLUE, dir: { x: -0.75, y: -0.65 }, k: 0.9 + 1.2 * pulse(S.t, B.skyBurst, 0.02, 0.6) }, rimB: { color: [150, 200, 255], dir: { x: 1, y: -0.15 }, k: 0.4 }, eyeGlow: 0.9, grade: 0.45 });
  foreground(S, L, D.fgSky);
  S.env.envGain = 1 - 0.25 * pulse(S.t, B.skyBurst, 0.02, 0.6);
  S.post.flash = 0.7 * pulse(S.t, B.skyBurst, 0.004, 0.03) + 0.3 * pulse(S.t, hit, 0.005, 0.1);
  S.post.rays = [0.5, 0.2, 0.4 * pulse(S.t, B.skyBurst, 0.02, 0.5)];
  S.post.streak = 0.3 + 0.5 * pulse(S.t, B.skyBurst, 0.02, 0.5);
  S.post.bloomStr = 0.9 + 0.35 * pulse(S.t, B.skyBurst, 0.02, 0.6);
  S.post.thresh = 1.05; S.post.contrast = 1.22;
  // title: slams on with the taiko, in open sky under the cut, in his line of sight
  drawTitle(S, prog(S.t, B.title, hit), prog(S.t, hit, B.title + 0.6, E.outExpo), { cx: S.W * 0.36, cy: S.H * 0.4 });
  S.post.exposure = 1 - prog(S.t, DURATION - 0.5, DURATION - 1 / 60, E.inOutSine);
};

export function render(S) {
  const shot = S.shot;
  const fn = SHOT[shot.name];
  if (fn) fn(S, S.t - shot.start);
}

// motion-blur sample count per frame when rendering with --sub auto
export function subframes(t) {
  if (t >= B.impact && t < B.slash) return 1;                     // impact cards: hard 3-frame holds
  if (t >= B.vanish + 0.06 && t < B.vanish + 0.3) return 16;    // whip pan peak: no hatching in the glows
  if (t >= B.vanish - 0.02 && t < B.vanish + 0.4) return 8;     // flash step + whip pan
  if (t >= 5.10 && t < 5.26) return 32;                           // barrage whip peak: a smear, not a comb
  if (t >= 5.26 && t < 5.27) return 16;
  if (t >= 5.02 && t < 5.32) return 6;                            // barrage whip-out into the flash step
  if (t >= B.slash && t < B.slash + 0.25) return 6;               // the crescent
  if (t >= B.skyBurst && t < B.skyBurst + 0.4) return 4;
  return 2;
}
