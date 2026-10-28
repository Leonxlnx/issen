// Builder D test film — energy VFX over the env with the film's night grade: aura + bolts, clash (crackle fields +
// energy burst), crescent slashes, speed lines + dash bolt, impact frames, world slash wave, sky cut.
// Stand-in silhouettes / floor / pillars are placeholders for the other builders' art.
import { clamp, lerp, prog, pulse, E, smoothstep, rgba, TAU } from '../core/math.js';
import { lin } from '../core/gl.js';
import { lightningBolt, boltWorld, lightningPath, drawAura, drawCrackleField } from '../fx/lightning.js';
import { drawSlashArc, drawWorldSlash, drawSkyCut } from '../fx/slash.js';
import { drawSpeedLines } from '../fx/speedlines.js';
import { drawImpactFrame, drawEnergyBurst, impactStyle } from '../fx/impact.js';

export const FPS = 60;
export const DURATION = 12.7;
export const shots = [
  { name: 'aura', start: 0, end: 2.4 },
  { name: 'clash', start: 2.4, end: 3.6 },
  { name: 'slash', start: 3.6, end: 5.8 },
  { name: 'speed', start: 5.8, end: 6.6 },
  { name: 'impact', start: 6.6, end: 7.2 },
  { name: 'world', start: 7.2, end: 9.6 },
  { name: 'skycut', start: 9.6, end: 12.7 },
];

// same grade as film.js nightEnv()
function nightEnv(S) {
  const e = S.env;
  e.skyTop = lin('#02041a'); e.skyMid = lin('#0a1240'); e.skyHor = lin('#5262b8'); e.horGlow = lin('#b48cd6', 0.38);
  e.nebula = 0.62;
  e.cloudLit = lin('#cfd3f4'); e.cloudShade = lin('#3b4392'); e.cloudDeep = lin('#10143e');
  const p = S.post;
  p.contrast = 1.1; p.sat = 1.14; p.shadowTint = [-0.01, -0.005, 0.03]; p.vignette = 0.42;
}

// ---- stand-ins (not final art) ----
function figure(S, x, y, z, o = {}) {
  const ctx = S.L.scene;
  const p = S.cam.toLocal(ctx, x, y, z);
  if (!p) return;
  const f = o.facing ?? 1;
  ctx.scale(f, 1);
  ctx.transform(1, 0, -(o.lean ?? 0), 1, 0, 0);
  ctx.fillStyle = rgba(o.color || [18, 20, 44]);
  ctx.beginPath();
  ctx.moveTo(-0.2, 0); ctx.lineTo(-0.08, -0.9); ctx.lineTo(0.1, -0.9); ctx.lineTo(0.26, 0); ctx.lineTo(0.14, 0); ctx.lineTo(0.02, -0.6); ctx.lineTo(-0.07, 0); ctx.closePath();
  ctx.moveTo(-0.22, -1.45); ctx.lineTo(0.2, -1.45); ctx.lineTo(0.18, -0.95); ctx.lineTo(0.36, -0.35); ctx.lineTo(0.05, -0.62); ctx.lineTo(-0.5, -0.3); ctx.lineTo(-0.18, -0.95); ctx.closePath();
  ctx.moveTo(-0.2, -1.42); ctx.lineTo(-0.3, -1.05); ctx.lineTo(-0.2, -0.82); ctx.lineTo(-0.14, -0.85); ctx.lineTo(-0.2, -1.05); ctx.lineTo(-0.12, -1.35); ctx.closePath();
  ctx.moveTo(0.18, -1.42); ctx.lineTo(0.36, -1.12); ctx.lineTo(0.5, -1.0); ctx.lineTo(0.47, -0.95); ctx.lineTo(0.3, -1.06); ctx.lineTo(0.12, -1.3); ctx.closePath();
  ctx.rect(-0.05, -1.55, 0.1, 0.12);
  ctx.moveTo(0.13, -1.66); ctx.arc(0, -1.66, 0.12, 0, TAU);
  ctx.moveTo(-0.14, -1.68); ctx.lineTo(-0.22, -1.62); ctx.lineTo(-0.12, -1.76); ctx.lineTo(-0.1, -1.86); ctx.lineTo(0.02, -1.8); ctx.lineTo(0.14, -1.84); ctx.lineTo(0.12, -1.72); ctx.lineTo(0.2, -1.66); ctx.closePath();
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
function floor(S, col = [14, 16, 34]) {
  const ctx = S.L.scene, c = S.cam;
  const zn = c.z + 0.6;
  const pts = [[-30, zn], [30, zn], [30, 40], [-30, 40]].map(([x, z]) => c.project(x, 0, z)).filter(Boolean);
  if (pts.length < 4) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, pts[2].y, 0, S.H);
  g.addColorStop(0, rgba([40, 44, 80])); g.addColorStop(1, rgba(col));
  ctx.fillStyle = g;
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function pillars(S) {
  const ctx = S.L.scene, c = S.cam;
  const list = [[-14, 30, 2.2, 16], [-7, 45, 2.6, 22], [9, 38, 2.4, 19], [17, 26, 2.0, 12], [3, 70, 3, 30], [-22, 60, 3, 26]];
  ctx.save();
  for (const [x, z, w, h] of list) {
    const a = c.project(x - w / 2, 12, z), b = c.project(x + w / 2, -h, z);
    if (!a || !b) continue;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgba([22, 24, 48]);
    ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
    ctx.fillStyle = rgba([34, 38, 70]);
    ctx.fillRect(a.x, b.y, (b.x - a.x) * 0.25, a.y - b.y);
  }
  ctx.restore();
}

export function render(S) {
  const { cam, env, t } = S;
  const shot = S.shot.name;
  const lt = t - S.shot.start;
  nightEnv(S);
  env.lightAC = [0.05, 0.2, 0.7]; env.lightA = [-6, -1, 10, 14];
  env.lightBC = [0.5, 0.04, 0.12]; env.lightB = [8, -1, 12, 12];

  if (shot === 'aura') {
    cam.x = -0.4 + t * 0.15; cam.y = -1.1; cam.z = -8 + t * 0.4; cam.fov = 42; cam.cy = S.H * 0.66;
    floor(S);
    // aura BEFORE the figure: back parts land in the scene and get covered, front parts glow in emit
    drawAura(S, { x: -2.2, y: 0, z: 0, h: 1.8, k: 1, color: 'blue', seed: 3, facing: 1 });
    figure(S, -2.2, 0, 0, { facing: 1 });
    drawAura(S, { x: 3.0, y: 0, z: 1.5, h: 1.7, k: 0.8, color: 'red', seed: 9, facing: -1 });
    figure(S, 3.0, 0, 1.5, { facing: -1, color: [30, 12, 26] });
    const s1 = Math.floor(t * 24);
    if (s1 % 9 < 3) boltWorld(S, { a: { x: -9, y: -16, z: 30 }, b: { x: -6.5, y: 0, z: 26 }, seed: 11 + Math.floor(s1 / 9), width: 3.2, branches: 0.9, depth: 3, flareB: 1 });
    if ((s1 + 4) % 13 < 2) boltWorld(S, { a: { x: 10, y: -18, z: 40 }, b: { x: 7, y: 2, z: 36 }, seed: 31 + Math.floor(s1 / 13), width: 2.4, branches: 0.8, color: 'red' });
    const a = cam.project(-1.6, -1.2, 0.2), b = cam.project(2.5, -1.15, 1.4);
    if (a && b && s1 % 5 < 3) lightningBolt(S, S.L.emit, { a, b, seed: 77, width: 2.0, branches: 0.7, bend: 0.12, color: s1 % 2 ? 'blue' : 'violet', k: 0.9 });
  } else if (shot === 'clash') {
    cam.x = 0; cam.y = -1.4; cam.z = -7; cam.fov = 45; cam.cy = S.H * 0.62; cam.roll = -0.08;
    const T0 = 0.35;
    const hit = pulse(lt, T0, 0.02, 0.15);
    cam.shakeX = hit * Math.sin(t * 97) * 14; cam.shakeY = hit * Math.cos(t * 83) * 10;
    floor(S);
    figure(S, -1.3, 0, 0, { lean: 0.35 });
    figure(S, 1.5, 0, 0.3, { facing: -1, lean: -0.3, color: [30, 12, 26] });
    const pc = cam.project(0.1, -1.25, 0.15);
    drawCrackleField(S, { cx: S.W * 0.27, cy: S.H * 0.5, rx: S.W * 0.3, ry: S.H * 0.42, angle: -0.08, color: 'blue', k: 0.95 + 0.3 * hit, density: 1.1, seed: 4 });
    drawCrackleField(S, { cx: S.W * 0.74, cy: S.H * 0.47, rx: S.W * 0.3, ry: S.H * 0.44, angle: Math.PI + 0.05, color: 'red', k: 0.95 + 0.3 * hit, density: 1.1, seed: 8 });
    drawEnergyBurst(S, { x: pc.x, y: pc.y, t, t0: S.shot.start + T0, dur: 0.85, r: S.H * 0.55, color: 'blue', colorB: 'red', splitAngle: 0, squash: 0.92 });
    drawEnergyBurst(S, { x: pc.x, y: pc.y, t, t0: S.shot.start + T0 + 0.45, dur: 0.7, r: S.H * 0.35, color: 'violet', streaks: 0.6, rings: 1, seed: 41 });
    S.post.flash = 0.25 * hit;
  } else if (shot === 'slash') {
    cam.x = 0; cam.y = -1.2; cam.z = -6.5 + lt * 0.2; cam.fov = 40; cam.cy = S.H * 0.6;
    floor(S);
    drawAura(S, { x: 0.2, y: 0, z: 0, k: 0.5, seed: 5 });
    figure(S, 0.2, 0, 0, { facing: 1, lean: 0.25 });
    const T0 = 0.25;
    drawSlashArc(S, {
      cx: S.W * 0.5, cy: S.H * 0.56, r: S.H * 0.44, a0: -2.95, a1: 0.45,
      progress: prog(lt, T0, T0 + 0.1, E.outQuart), fade: prog(lt, T0 + 0.1, T0 + 0.7), seed: 4, sweepDur: 0.1, fadeDur: 0.6,
    });
    const T1 = 1.0;
    drawSlashArc(S, {
      cx: S.W * 0.5, cy: S.H * 0.5, r: S.H * 0.5, a0: 2.85, a1: 0.15, tilt: 0.72, rot: -0.12,
      progress: prog(lt, T1, T1 + 0.09, E.outQuart), fade: prog(lt, T1 + 0.1, T1 + 0.65), seed: 9, sweepDur: 0.09, fadeDur: 0.55,
    });
    // world-space variant: small red arc around the figure (metres)
    const T2 = 1.65;
    drawSlashArc(S, {
      screen: false, cx: 0.2, cy: -1.0, cz: 0.2, r: 1.1, a0: -0.6, a1: 2.2, tilt: 0.5, rot: 0.3, color: 'red',
      progress: prog(lt, T2, T2 + 0.08, E.outQuart), fade: prog(lt, T2 + 0.1, T2 + 0.55), seed: 13, sweepDur: 0.08, fadeDur: 0.45,
    });
  } else if (shot === 'speed') {
    cam.x = 0; cam.y = -1.5; cam.z = -9; cam.fov = 45; cam.cy = S.H * 0.6;
    cam.shakeX = Math.sin(t * 71) * 6; cam.shakeY = Math.cos(t * 53) * 4;
    floor(S);
    if (lt < 0.4) {
      drawSpeedLines(S, S.L.emit, { kind: 'linear', angle: -0.12, density: 1.2, k: 1, color: 'blue', clear: 90, width: 7 });
      const pts = [{ x: -100, y: S.H * 0.62 }, { x: S.W * 0.22, y: S.H * 0.48 }, { x: S.W * 0.4, y: S.H * 0.6 }, { x: S.W * 0.62, y: S.H * 0.42 }, { x: S.W * 0.8, y: S.H * 0.55 }];
      const n = Math.max(2, Math.floor(prog(lt, 0, 0.2) * 4) + 1);
      lightningPath(S, S.L.emit, { pts: pts.slice(0, Math.min(5, n + 1)), seed: 5, width: 5, branches: 0.9, jitter: 0.5 });
    } else {
      drawSpeedLines(S, S.L.emit, { kind: 'radial', cx: S.W * 0.55, cy: S.H * 0.47, density: 1, k: 1, color: [235, 245, 255], inner: 0.28, width: 9, ink: true });
      figure(S, 0, 0, 0, { lean: 0.6 });
    }
  } else if (shot === 'impact') {
    cam.x = 0; cam.y = -1.0; cam.z = -5; cam.fov = 40; cam.cy = S.H * 0.6;
    const v = Math.floor(lt * 20) % 4; // 3 frames each at 60 fps
    // like film.js: characters first (silhouettes), then the plate slides under them
    const st = impactStyle(v);
    floor(S);
    figure(S, -0.9, 0, 0, { lean: 0.5, color: st.silColor });
    figure(S, 1.4, 0, 0.5, { facing: -1, lean: -0.3, color: st.silColor });
    const pk = cam.project(-0.9, -1, 0), pa = cam.project(1.4, -1, 0.5);
    drawImpactFrame(S, { variant: v, cx: S.W * 0.55, cy: S.H * 0.45, angle: -0.5, chars: [pk, pa] });
  } else if (shot === 'world') {
    cam.x = 0; cam.y = -4; cam.z = -10 + lt * 0.5; cam.fov = 55; cam.cy = S.H * 0.42;
    const T0 = 0.25, dur = 1.7;
    const travel = clamp((lt - T0) / dur);
    const p0 = { x: S.W * 0.48, y: S.H * 1.08 }, p1 = { x: S.W * 0.53, y: cam.cy + 4 };
    // colossal frame-filling crescent (shot-7 style) over the bright cloud sea, then the wave launches
    drawSlashArc(S, {
      cx: S.W * 0.52, cy: S.H * 1.25, r: S.W * 0.62, a0: -2.75, a1: -0.35, thickness: S.H * 0.13, tilt: 0.35, rot: 0.05,
      progress: prog(lt, 0.02, 0.12, E.outQuart), fade: prog(lt, 0.14, 0.95), seed: 21, paint: 0.7, sweepDur: 0.1, fadeDur: 0.8,
    });
    if (lt > T0) {
      drawWorldSlash(S, { p0, p1, travel, t, width: S.W * 1.1, fade: prog(lt, 1.9, 2.4), dur });
      env.split = [0, 30, Math.PI / 2, smoothstep(0, 0.5, travel) * 0.9];
      env.splitW = 4 + 10 * travel;
      env.splitGlow = [0.2, 0.6, 1.6];
    }
    S.post.flash = 0.35 * pulse(lt, T0, 0.02, 0.1);
  } else if (shot === 'skycut') {
    cam.x = lt * 0.3; cam.y = -2; cam.z = -10; cam.fov = 50; cam.cy = S.H * 0.66;
    const TB = 1.35;
    const open = prog(lt, TB, TB + 0.14, E.outCubic);
    const burst = pulse(lt, TB, 0.03, 0.5);
    cam.shakeX = burst * Math.sin(t * 90) * 10; cam.shakeY = burst * Math.cos(t * 77) * 8;
    pillars(S);
    floor(S);
    drawSkyCut(S, { y0: S.H * 0.34, angle: -0.07, reveal: prog(lt, 0.2, 0.5, E.inOutCubic), open, burst, t0: S.shot.start + TB });
    S.post.flash = 0.45 * pulse(lt, TB, 0.015, 0.08);
  }
}
