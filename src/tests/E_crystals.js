// Builder E test film: crystal swarm forming / launching / shattering, shards, particles, shockwaves.
// Uses the A-world stage/ruins and the B characters for context when those modules load (falls back to
// a flat slab + stand-in silhouettes so this test never depends on another builder's work in progress).
import { clamp, lerp, smoothstep, E, rgba, prog } from '../core/math.js';
import { makeCrystalSwarm, drawCrystals, drawShards, drawCrystalRibbons, drawCrystalShield } from '../fx/crystals.js';
import { drawParticles } from '../fx/particles.js';
import { drawShockwave } from '../fx/shockwave.js';

export const FPS = 60;
export const DURATION = 9.2;
export const shots = [
  { name: 'wide', start: 0, end: 3.4 },
  { name: 'close', start: 3.4, end: 5.6 },
  { name: 'macro', start: 5.6, end: 7.2 },
  { name: 'shield', start: 7.2, end: 9.2 },
];

const HAND = { x: 4, y: -1.3, z: 0 };
let swA, swB, swC;
let W = null; // optional world/character modules
export async function setup() {
  swA = makeCrystalSwarm(11, { count: 38, origin: HAND, target: { x: -4, y: -1, z: 0 }, spread: 1.3, size: 0.5, formation: 'halo' });
  swB = makeCrystalSwarm(23, { count: 32, origin: { x: 1.45, y: -1.38, z: 2.4 }, target: { x: -1.0, y: -1.2, z: -6.5 }, spread: 1.25, size: 0.55, targetSpread: 1.9, formation: 'halo', curve: 0.8 });
  swC = makeCrystalSwarm(37, { count: 1, origin: { x: 0, y: -1.3, z: 0 }, target: { x: -5, y: -0.2, z: -3.2 }, spread: 0.01, size: 1.8, sizeVar: 0, sides: 6, shape: { front: 0.3, body: 0.5, chisel: true, rad: 0.12 } });
  try {
    const [ruins, stage, akane, kai] = await Promise.all([import('../world/ruins.js'), import('../world/stage.js'), import('../chars/akane.js'), import('../chars/kai.js')]);
    W = { ruins, stage, akane, kai, world: ruins.buildRuins(7) };
    stage.buildStage(3);
  } catch (e) { console.warn('E_crystals: world/chars unavailable, using stand-ins', e && e.message); W = null; }
}

// stand-in silhouettes so scale reads when the character modules are not available
function standIn(S, x, z, h, col) {
  const p = S.cam.toLocal(S.L.scene, x, 0, z);
  if (!p) return;
  const c = S.L.scene;
  c.fillStyle = rgba(col, 0.55);
  c.beginPath(); c.ellipse(0, -h * 0.93, 0.11, 0.13, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(-0.18, -h * 0.82); c.lineTo(0.18, -h * 0.82); c.lineTo(0.14, -h * 0.45); c.lineTo(0.12, 0); c.lineTo(-0.12, 0); c.lineTo(-0.14, -h * 0.45); c.closePath(); c.fill();
  c.setTransform(1, 0, 0, 1, 0, 0);
}
function floor(S) {
  const c = S.L.scene, cam = S.cam;
  const pts = [[-14, 14], [14, 14], [14, -4], [-14, -4]].map(([x, z]) => cam.project(x, 0, z));
  if (pts.some((p) => !p)) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, pts[0].y, 0, S.H);
  g.addColorStop(0, '#2b2f52'); g.addColorStop(1, '#14162c');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) c.lineTo(p.x, p.y); c.closePath(); c.fill();
}
function backdrop(S, stage = true) {
  if (W) {
    try {
      W.ruins.drawRuins(S, W.world, { zMin: 15 });
      if (stage) W.stage.drawStage(S, { cracks: 0.4, glowCracks: 0.6, wet: 0.85 });
      W.ruins.drawRuins(S, W.world, { zMax: 15 });
      return;
    } catch (e) { console.warn('E_crystals backdrop failed', e && e.message); W = null; }
  }
  if (stage) floor(S);
}
function akane(S, x, z, o = {}) {
  if (W) { try { W.akane.drawAkane(S, { x, y: 0, z, facing: -1, pose: 'cast', t: S.t, castGlow: 1, wind: { x: -1.5, y: -0.2 }, ...o }); return; } catch (e) { console.warn('akane failed', e && e.message); } }
  standIn(S, x, z, 1.68, [13, 15, 34]);
}
function kai(S, x, z, o = {}) {
  if (W) { try { W.kai.drawKai(S, { x, y: 0, z, facing: 1, pose: 'iai_ready', t: S.t, sword: 'sheathed', wind: { x: -1, y: -0.2 }, ...o }); return; } catch (e) { console.warn('kai failed', e && e.message); } }
  standIn(S, x, z, 1.78, [13, 15, 34]);
}

export function render(S) {
  const { cam, env, t } = S;
  env.lightAC = [0.05, 0.15, 0.5]; env.lightA = [-4, -1, 0, 25];
  env.lightBC = [0.5, 0.04, 0.1]; env.lightB = [4, -1, 0, 25];
  if (t < 3.4) {
    // ---- WIDE: low angle standoff framing; Akane casts, barrage forms, launches, half of it shatters mid-air
    const k = t / 3.4;
    cam.x = 0.3; cam.y = -1.0; cam.z = -13.5 + k * 1.2; cam.fov = 42; cam.cy = S.H * 0.66; cam.roll = -0.03;
    backdrop(S);
    kai(S, -4.3, 0.2);
    // ribbons behind / crystals around / ribbons in front of the caster
    const rib = { origin: { x: 3.9, y: -1.35, z: 0.1 }, target: { x: -4, y: -1, z: 0 }, t, t0: 0.05, grow: 0.6, length: 7.0, radius: 1.1, spreadR: 0.25, turns: 0.4, count: 5, width: 0.5, spin: 2, k: 1 - smoothstep(1.4, 2.1, t), seed: 2 };
    drawCrystalRibbons(S, { ...rib, zMin: 0.1 });
    akane(S, 4.6, 0.2);
    drawCrystalRibbons(S, { ...rib, zMax: 0.1 });
    drawCrystals(S, swA, { formT0: 0.15, formDur: 0.8, launchT0: 1.35, stagger: 0.55, speed: 20, shatterAt: (c) => (c.i % 2 ? c.timeAt(0.5) : null) });
    drawParticles(S, { kind: 'embers', seed: 3, origin: { x: 4.4, y: -0.6, z: 0.2 }, t, continuous: true, count: 40, spread: 1.2, color: 'red' });
    // shockwave + shard burst + dust on the ground
    drawShockwave(S, { x: -0.6, y: 0, z: 1.0, t, t0: 2.35, maxR: 7, color: 'red', thickness: 0.5, duration: 0.85, distort: 1 });
    drawShards(S, { seed: 4, origin: { x: -0.6, y: -1.0, z: 1.0 }, t, t0: 2.35, count: 40, speed: 7, spread: 0.4, gravity: 4, life: 2.2 });
    drawParticles(S, { kind: 'dust', seed: 5, origin: { x: -0.6, y: -0.1, z: 1.0 }, t, t0: 2.35, count: 30, speed: 5, flat: true });
    drawParticles(S, { kind: 'sparks', seed: 6, origin: { x: -0.6, y: -1.0, z: 1.0 }, t, t0: 2.35, count: 24, speed: 10, color: 'red' });
  } else if (t < 5.6) {
    // ---- CLOSE: Akane casts toward the lens; crystals form around her palm and fly past the camera (DOF)
    const lt = t - 3.4;
    cam.x = 0.35 + lt * 0.06; cam.y = -1.35; cam.z = -4.2 + lt * 0.12; cam.fov = 46; cam.cy = S.H * 0.56; cam.roll = 0.04;
    backdrop(S);
    const rib = { origin: { x: 1.45, y: -1.38, z: 2.4 }, target: { x: -1.0, y: -1.2, z: -6.5 }, t, t0: 3.42, grow: 0.5, length: 5.5, radius: 0.85, spreadR: 0.3, turns: 0.45, count: 5, width: 0.42, spin: 2.2, k: 1 - smoothstep(4.5, 5.0, t), seed: 5 };
    drawCrystalRibbons(S, { ...rib, zMin: 2.4 });
    akane(S, 2.3, 2.6);
    drawCrystalRibbons(S, { ...rib, zMax: 2.4 });
    drawCrystals(S, swB, { formT0: 3.5, formDur: 0.5, launchT0: 4.3, stagger: 0.6, speed: 16, dof: { focus: 6.8, aperture: 0.03 }, shatterAt: (c) => (c.i % 5 === 0 ? c.timeAt(0.55) : null) });
    drawParticles(S, { kind: 'embers', seed: 8, origin: { x: 1.6, y: -1.2, z: 2.2 }, t, continuous: true, count: 40, spread: 1.6, color: 'red' });
  } else if (t >= 7.2) {
    // ---- SHIELD: hex crystal barrier forms in front of the caster, gets cut by a blue slash
    cam.x = 1.2; cam.y = -1.3; cam.z = -5.5; cam.fov = 42; cam.cy = S.H * 0.55; cam.roll = -0.04;
    backdrop(S);
    akane(S, 4.2, 0.6);
    drawCrystalShield(S, { x: 3.0, y: -1.25, z: 0.2, t, t0: 7.35, radius: 1.35, cell: 0.36, normal: { x: -1, y: 0, z: -0.55 }, cut: { t0: 8.35, angle: -0.6 } });
    drawCrystalRibbons(S, { origin: { x: 3.6, y: -1.3, z: 0.4 }, dir: { x: -1, y: 0.05, z: -0.3 }, t, t0: 7.25, grow: 0.5, length: 2.4, radius: 1.0, spreadR: 0.4, turns: 0.35, k: 0.8 * (1 - smoothstep(8.2, 8.5, t)), count: 4, width: 0.35, seed: 9, zMin: 0.25 });
    drawParticles(S, { kind: 'embers', seed: 31, origin: { x: 3.2, y: -1.2, z: 0.2 }, t, continuous: true, count: 50, spread: 1.6, color: 'red' });
  } else {
    // ---- MACRO: single big crystal (3/4 view, slow roll), crack-up then shatter; prism + crimson floating shards
    cam.x = 0; cam.y = -1.3; cam.z = -4.2; cam.fov = 40; cam.cy = S.H * 0.52;
    backdrop(S, false);
    drawShards(S, { seed: 12, box: { x0: -4, x1: 4, y0: -3.5, y1: 0.5, z0: 1, z1: 8 }, t, t0: 5.0, count: 30, speed: 0.3, gravity: 0.05, drag: 0.5, size: 0.24, life: 30, spin: 0.25, palette: 'prism', glitter: 0.4 });
    drawShards(S, { seed: 13, box: { x0: -4, x1: 4, y0: -3.5, y1: 0.5, z0: 0, z1: 6 }, t, t0: 5.0, count: 30, speed: 0.3, gravity: 0.05, drag: 0.5, size: 0.18, life: 30, spin: 0.3, glitter: 0.4 });
    drawCrystals(S, swC, { formT0: 5.65, formDur: 0, launchT0: 99, stagger: 0, shatterAt: () => 6.75, tip: 1.2, gather: 0 });
    drawShockwave(S, { x: 0, y: -1.3, z: 0, t, t0: 6.75, maxR: 2.8, plane: 'screen', tilt: 0.55, rot: -0.3, color: 'red', thickness: 0.18, duration: 0.5, rings: 2, sparks: 0.6, distort: 0.7 });
  }
}
