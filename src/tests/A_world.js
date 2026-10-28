// Builder A test film: floating ruins, stage and debris from the main camera setups.
//  0-3 s   low wide standoff (push-in)                3-6 s  high wide over the cloud sea
//  6-9 s   ISSEN beat: cracks spread + glow, shockwave burst through the debris, hero pillar cut & sliding off
//  9-11.5  sky split: a screen-line world cut slices every ruin it crosses, the tops slide / lift / drop
//  11.5-13.5 the director's close low standoff camera (floor right at the lens)
// Uses the director's night grade (same env as src/film.js) so the values match the final film.
import { buildRuins, drawWorld } from '../world/ruins.js';
import { buildStage, drawStage } from '../world/stage.js';
import { makeDebris } from '../world/debris.js';
import { clamp, lerp, pulse, prog, E } from '../core/math.js';
import { lin } from '../core/gl.js';

export const FPS = 60;
export const DURATION = 13.5;
export const shots = [{ name: 'low', start: 0, end: 3 }, { name: 'high', start: 3, end: 6 }, { name: 'cut', start: 6, end: 9 }, { name: 'split', start: 9, end: 11.5 }, { name: 'close', start: 11.5, end: 13.5 }];

let world = null, near = null, far = null, fg = null, local = null;
export async function setup() {
  world = buildRuins(7);
  buildStage(3);
  const avoid = [{ x0: -5.6, x1: 5.6, y0: -2.8, y1: 0.6, z0: -1.6, z1: 1.6 }, { x0: -2.6, x1: 2.6, y0: -3.2, y1: 1, z0: -15, z1: -3 }, { x0: -1, x1: 7, y0: -5, y1: 1, z0: -18, z1: -4 }];
  near = makeDebris(11, { count: 420, box: { x0: -40, x1: 40, y0: -28, y1: 3, z0: -8, z1: 70 }, sizeMin: 0.04, sizeMax: 1.6, avoid });
  // levitating pebbles / chips around the fighters (what the ISSEN shockwave visibly blasts away)
  local = makeDebris(15, { count: 160, box: { x0: -14, x1: 14, y0: -7, y1: 0.3, z0: -6, z1: 12 }, sizeMin: 0.04, sizeMax: 0.55, sizePow: 1.8, rise: 0.15, dust: 60, grit: 260, gritCenter: { x: 0, y: -2, z: 2 }, gritRadius: 12,
    avoid: [{ x0: -4.8, x1: -3.2, y0: -2.2, y1: 0.4, z0: -0.8, z1: 0.8 }, { x0: 3.2, x1: 4.8, y0: -2.2, y1: 0.4, z0: -0.8, z1: 0.8 }] });
  far = makeDebris(12, { count: 380, box: { x0: -260, x1: 260, y0: -90, y1: 12, z0: 70, z1: 420 }, sizeMin: 0.4, sizeMax: 7, sizePow: 2.2, dust: 0, grit: 0 });
  fg = makeDebris(14, { count: 0, dust: 0, grit: 0, box: { x0: -6, x1: 6, y0: -6, y1: 1, z0: -12, z1: -6 }, rocks: [
    { x: -3.3, y: -0.35, z: -9.6, size: 0.75 }, { x: 3.9, y: -0.5, z: -9.9, size: 0.95 }, { x: -2.2, y: -4.2, z: -8.5, size: 0.45 }, { x: 2.6, y: -3.6, z: -9.2, size: 0.3 },
  ] });
}

// the director's night grade (copied from src/film.js nightEnv) so the test shows the final values
function nightEnv(S) {
  const e = S.env;
  e.skyTop = lin('#01030e'); e.skyMid = lin('#061033'); e.skyHor = lin('#2f4f9e'); e.horGlow = lin('#a9c4ff', 0.32);
  e.nebula = 0.5;
  e.cloudLit = lin('#f3f6ff'); e.cloudShade = lin('#4b64b4'); e.cloudDeep = lin('#0b1645'); e.cloudRim = lin('#b8ccff', 0.5);
  const p = S.post;
  p.contrast = 1.14; p.sat = 1.12; p.shadowTint = [-0.012, -0.004, 0.022]; p.hiTint = [0, 0.004, 0.012]; p.vignette = 0.42;
}

function lightPillar(S, x, z, col, k = 1) {
  const { cam } = S;
  const e = S.L.emit;
  const a = cam.project(x, -2.0, z), b = cam.project(x, 0, z);
  if (!a || !b) return;
  e.save(); cam.toScreen(e); e.globalCompositeOperation = 'lighter'; e.globalAlpha = k;
  const w = 0.3 * b.s;
  const g = e.createLinearGradient(b.x - w, 0, b.x + w, 0);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(0.5, `rgba(${col},0.9)`); g.addColorStop(1, `rgba(${col},0)`);
  e.fillStyle = g; e.fillRect(b.x - w, a.y, w * 2, b.y - a.y);
  e.fillStyle = 'rgba(255,255,255,0.8)'; e.fillRect(b.x - w * 0.12, a.y, w * 0.24, b.y - a.y);
  e.restore();
}

export function render(S) {
  const { cam, env } = S;
  const t = S.t;
  nightEnv(S);
  env.lightAC = lin('#3a8cff', 0.55); env.lightA = [-4, -1, 0, 22];
  env.lightBC = lin('#ff2a55', 0.55); env.lightB = [4, -1, 0, 22];
  let cracks = 0.55, glow = 0.8, cut = null, burst = null;
  if (t < 3) {
    const k = E.dolly(clamp(t / 3));
    cam.x = 0; cam.y = -1.2; cam.z = -14 + 2 * k; cam.fov = 45; cam.cy = S.H * 0.62; cam.roll = 0.03;
  } else if (t < 6) {
    const k = E.dolly(clamp((t - 3) / 3));
    cam.x = 10 - 3 * k; cam.y = -12; cam.z = -30; cam.fov = 55; cam.cy = S.H * 0.42; env.skyYaw = 0.6;
  } else if (t < 9) {
    const k = E.dolly(clamp((t - 6) / 3));
    cam.x = 3 + k; cam.y = -2.2; cam.z = -17 - k; cam.fov = 50; cam.cy = S.H * 0.6; cam.roll = -0.02;
    cracks = lerp(0.25, 1, prog(t, 6.1, 6.7, E.outCubic));
    glow = 0.6 + 2.2 * pulse(t, 6.2, 0.05, 0.6);
    cut = { id: 'hero', t: prog(t, 6.45, 9, E.inQuad), glow: 1.8 * pulse(t, 6.25, 0.04, 0.9), angle: -0.42, at: 0.45, slide: 9, drop: 4, open: 0.8 };
    burst = { x: 0, y: -1, z: 0, t0: 6.25, strength: 1.3 };
  } else if (t < 11.5) {
    // sky split: a world-cut line slices every ruin it crosses; upper pieces slide along it, lift off and drop
    const k = E.dolly(clamp((t - 9) / 2.5));
    cam.x = -2; cam.y = -4; cam.z = -26 + k; cam.fov = 50; cam.cy = S.H * 0.6; cam.roll = 0.02;
    cut = { screen: { x0: 0, y0: S.H * 0.47, x1: S.W, y1: S.H * 0.36 }, t: prog(t, 9.4, 11.5, E.inOutQuad), slide: 7, open: 2.2, drop: 5, glow: 2.5 * pulse(t, 9.25, 0.05, 0.7), widthPx: 3 * S.H / 1080, spin: 0.08 };
    cracks = 1; glow = 1.2;
  } else {
    // the director's standoff camera (film.js SHOT.standoff)
    const p = clamp((t - 11.5) / 2);
    cam.x = lerp(0.65, 0.2, E.inOutSine(p)); cam.y = -1.05; cam.z = lerp(-4.7, -3.8, E.dolly(p));
    cam.fov = 44; cam.cy = S.H * 0.55; cam.roll = lerp(0.035, 0.05, p); env.skyYaw = 0.08;
    cracks = 0.3; glow = 0.5;
  }
  // everything beyond the stage edge: ruins + far / mid debris, depth-correct in one call
  drawWorld(S, world, [{ field: far, opts: { emit: 0 } }, near], { zMin: 15, ruins: { cut }, burst });
  drawWorld(S, null, [{ field: local, opts: { rise: 0.15 } }], { zMin: 0, burst });
  drawStage(S, { cracks, glowCracks: glow, wet: 0.85 });
  lightPillar(S, -4, 0, '60,170,255');
  lightPillar(S, 4, 0, '255,60,110');
  // the near slab (in front of the fighters' depth) after the characters would be drawn
  drawWorld(S, world, [near], { zMax: 15, burst });
  drawWorld(S, null, [{ field: local, opts: { rise: 0.15 } }], { zMax: 0, burst });
  if (t < 3) drawWorld(S, null, [{ field: fg, opts: { dust: false } }], {});
}
