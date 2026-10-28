// ISSEN — builder E: particles + shared helpers for the crystal / shockwave fx.
// Everything is closed-form: a particle's state is a pure function of (seed, index, t).
// Emissive kinds (sparks, embers, glitter) are drawn crisp into S.L.emit (additive, bloomed
// by the compositor); dust is drawn cel-shaded into S.L.scene.
import { RNG, TAU, clamp, lerp, smoothstep, mixColor, rgba, hash1, hash2, hash3, noise2 } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';

// ---------------------------------------------------------------- palettes
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const PAL = {
  red: { core: hex('#ffe3ec'), hot: hex('#ff6b8f'), mid: hex('#ff1f4f'), deep: hex('#b0002f'), dark: hex('#4a0014') },
  blue: { core: hex('#eafcff'), hot: hex('#7fe8ff'), mid: hex('#2a9cff'), deep: hex('#1840d0'), dark: hex('#0a1a6e') },
  white: { core: [255, 255, 255], hot: hex('#e8ecff'), mid: hex('#b8c2ff'), deep: hex('#6f78d8'), dark: hex('#282a66') },
  violet: { core: hex('#f6eaff'), hot: hex('#d49bff'), mid: hex('#a24dff'), deep: hex('#5a1fc0'), dark: hex('#240a5a') },
  gold: { core: hex('#fff6e0'), hot: hex('#ffd27a'), mid: hex('#ff9b2a'), deep: hex('#c05a00'), dark: hex('#4a1a00') },
};
PAL.crimson = PAL.red; PAL.cyan = PAL.blue;
// name | [r,g,b] | hex | palette object -> palette object {core,hot,mid,deep,dark}
export function pal(c) {
  if (!c) return PAL.red;
  if (typeof c === 'string') { if (PAL[c]) return PAL[c]; c = hex(c); }
  if (Array.isArray(c)) {
    const W = [255, 255, 255];
    return { core: mixColor(c, W, 0.85), hot: mixColor(c, W, 0.42), mid: c, deep: c.map((v) => v * 0.62), dark: c.map((v) => v * 0.26) };
  }
  return c;
}
// smooth rainbow (prismatic glints), h in [0,1)
export function rainbow(h, sat = 1, light = 0.62) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => { const k = (n + h * 12) % 12; const a = sat * Math.min(light, 1 - light); return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}

// ---------------------------------------------------------------- 3D vector helpers
export const V = {
  v: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  madd: (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
};
// Rodrigues rotation of v around unit axis k by angle th
export function rotAxis(v, k, th) {
  const c = Math.cos(th), s = Math.sin(th), d = (k.x * v.x + k.y * v.y + k.z * v.z) * (1 - c);
  return {
    x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d,
    y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d,
    z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d,
  };
}
// uniform random unit vector
export function randDir(rng) {
  const z = rng.range(-1, 1), a = rng.range(0, TAU), r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(a), y: r * Math.sin(a), z };
}
// random unit vector inside a cone of half-angle `cone` around unit dir d
export function coneDir(rng, d, cone) {
  const cz = lerp(1, Math.cos(cone), rng.next()), a = rng.range(0, TAU), r = Math.sqrt(Math.max(0, 1 - cz * cz));
  const up = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = V.norm(V.cross(d, up)), w = V.cross(d, u);
  return V.norm({ x: d.x * cz + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, y: d.y * cz + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r, z: d.z * cz + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r });
}
// closed-form linear-drag ballistic motion: dv/dt = g - k v. g is scalar along +y (y is DOWN).
export function ballistic(p0, v0, g, k, tau) {
  if (k < 1e-4) return { x: p0.x + v0.x * tau, y: p0.y + v0.y * tau + 0.5 * g * tau * tau, z: p0.z + v0.z * tau };
  const e = (1 - Math.exp(-k * tau)) / k;
  return { x: p0.x + v0.x * e, y: p0.y + v0.y * e + g * (tau - e) / k, z: p0.z + v0.z * e };
}
export function ballisticVel(v0, g, k, tau) {
  if (k < 1e-4) return { x: v0.x, y: v0.y + g * tau, z: v0.z };
  const e = Math.exp(-k * tau);
  return { x: v0.x * e, y: v0.y * e + (g / k) * (1 - e), z: v0.z * e };
}
// slowed angle for spins with angular drag
export const spinAngle = (w, kd, tau) => (kd < 1e-4 ? w * tau : w * (1 - Math.exp(-kd * tau)) / kd);

// 24 fps boil step
export const boil = (t, fps = 24) => Math.floor(t * fps + 0.5);   // half-step phase: boundaries between frames

// ---------------------------------------------------------------- 2D primitives
function diamond(ctx, x, y, len, wid, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  ctx.moveTo(x + c * len, y + s * len);
  ctx.lineTo(x - s * wid, y + c * wid);
  ctx.lineTo(x - c * len, y - s * len);
  ctx.lineTo(x + s * wid, y - c * wid);
  ctx.closePath();
}
// Anime sparkle / glint: long 4-point cross flare + short diagonal cross + hot dot.
// Draw into an additive ctx. r = flare radius in px.
export function drawStar(ctx, x, y, r, o = {}) {
  if (r < 0.4) return;
  const p = pal(o.color || 'red');
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0.003) return;
  const rot = o.rot || 0, thin = o.thin || 0.075, diag = o.diag == null ? 0.42 : o.diag;
  const asp = o.aspect || 1; // horizontal flare stretch
  ctx.globalAlpha = a * 0.55;
  ctx.fillStyle = rgba(o.outer || p.mid);
  ctx.beginPath();
  diamond(ctx, x, y, r * asp, r * thin * 2.2, rot);
  diamond(ctx, x, y, r, r * thin * 2.2, rot + Math.PI / 2);
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.fillStyle = rgba(o.inner || p.hot);
  ctx.beginPath();
  diamond(ctx, x, y, r * asp * 0.92, r * thin, rot);
  diamond(ctx, x, y, r * 0.92, r * thin, rot + Math.PI / 2);
  if (diag > 0) {
    diamond(ctx, x, y, r * diag, r * thin * 0.9, rot + Math.PI / 4);
    diamond(ctx, x, y, r * diag, r * thin * 0.9, rot - Math.PI / 4);
  }
  ctx.fill();
  ctx.fillStyle = rgba(o.core || p.core);
  ctx.beginPath();
  diamond(ctx, x, y, r * asp * 0.55, r * thin * 0.45, rot);
  diamond(ctx, x, y, r * 0.55, r * thin * 0.45, rot + Math.PI / 2);
  ctx.fill();
  const cr = Math.max(0.6, r * (o.dot || 0.09));
  ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
// soft round glow dot built from 3 concentric discs (cheap, no gradients)
export function glowDot(ctx, x, y, r, p, a = 1) {
  if (r < 0.25 || a <= 0.003) return;
  ctx.globalAlpha = a * 0.22; ctx.fillStyle = rgba(p.deep); ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, TAU); ctx.fill();
  ctx.globalAlpha = a * 0.55; ctx.fillStyle = rgba(p.mid); ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.fill();
  ctx.globalAlpha = a; ctx.fillStyle = rgba(p.core); ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
// tapered streak from tail (x0,y0) to head (x1,y1): width w at the head, needle tail
export function streak(ctx, x0, y0, x1, y1, w) {
  let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy);
  if (l < 0.01) { ctx.moveTo(x1 + w, y1); ctx.arc(x1, y1, w * 0.5, 0, TAU); return; }
  dx /= l; dy /= l;
  const hw = w * 0.5;
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - dy * hw, y1 + dx * hw);
  ctx.lineTo(x1 + dx * hw * 1.2, y1 + dy * hw * 1.2);
  ctx.lineTo(x1 + dy * hw, y1 - dx * hw);
  ctx.closePath();
}
// time snapped to 24 fps (impact moments hold on 1s/2s instead of tweening at 60 fps)
// half-step phase so a 24 fps boundary never lands mid-shutter; never ahead of t, never below 0 for t >= 0
export const q24 = (t) => t <= 0 ? Math.floor(t * 24 + 1e-6) / 24 : Math.max(0, (Math.floor(t * 24 + 0.5) - 0.5) / 24);
// Jagged anime impact burst: n uneven spikes around a small core (the "pop" drawn by an effects animator).
// mode 'fill' = solid white-hot burst (1-2 frames), 'line' = hot outline only (the after-frames).
export function burstFlash(ctx, x, y, R, o = {}) {
  if (R < 1) return;
  const p = pal(o.color || 'red');
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0.004) return;
  const n = o.spikes || 9, seed = o.seed || 0, tb = o.tb || 0, rot = o.rot == null ? hash1(seed * 3.1) * TAU : o.rot;
  const inner = o.inner == null ? 0.2 : o.inner, asp = o.aspect || 1;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const ang = rot + (i + (i & 1 ? 0 : (hash2(seed + i, tb) - 0.5) * 0.7)) / (n * 2) * TAU;
    const r = i & 1 ? R * inner * (0.7 + 0.6 * hash2(seed * 1.7 + i, tb)) : R * (0.5 + 0.5 * hash2(seed + i * 2.3, tb + 0.5));
    pts.push({ x: x + Math.cos(ang) * r * asp, y: y + Math.sin(ang) * r });
  }
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); };
  ctx.lineJoin = 'miter';
  if (o.mode === 'line') {
    path();
    ctx.globalAlpha = a * 0.55; ctx.strokeStyle = rgba(p.mid); ctx.lineWidth = Math.max(2, R * 0.05); ctx.stroke();
    ctx.globalAlpha = a; ctx.strokeStyle = rgba(p.hot); ctx.lineWidth = Math.max(1, R * 0.018); ctx.stroke();
  } else {
    // deep-colour fringe, hot body, white core (a scaled copy of the same spikes)
    ctx.save(); ctx.translate(x, y); ctx.scale(1.12, 1.12); ctx.translate(-x, -y);
    path(); ctx.globalAlpha = a * 0.5; ctx.fillStyle = rgba(p.mid); ctx.fill(); ctx.restore();
    path(); ctx.globalAlpha = a * 0.8; ctx.fillStyle = rgba(p.hot); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.scale(0.5, 0.5); ctx.translate(-x, -y);
    path(); ctx.globalAlpha = a; ctx.fillStyle = rgba(p.core); ctx.fill(); ctx.restore();
  }
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
}
// crisp refraction speck: small hot disc + white centre (no wide halo — the compositor blooms it)
export function speck(ctx, x, y, r, p, a = 1) {
  if (r < 0.2 || a <= 0.004) return;
  ctx.globalAlpha = a * 0.5; ctx.fillStyle = rgba(p.hot); ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, TAU); ctx.fill();
  ctx.globalAlpha = a; ctx.fillStyle = rgba(p.core); ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r * 0.9), 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
// periodic "timed pop" twinkle on 24 fps steps: pop over 2 frames, hold 2, decay 3, then off for the rest of the period
export function popEnv(tb, seed, periodS = 0.7) {
  const per = Math.max(8, Math.round(periodS * 24));
  const f = ((tb + Math.floor(hash1(seed * 1.37 + 0.11) * per)) % per + per) % per;
  if (f < 2) return (f + 1) / 2;
  if (f < 4) return 1;
  if (f < 7) return 1 - (f - 3) / 4;
  return 0;
}

// ---------------------------------------------------------------- particles
const KIND_DEF = {
  sparks: { count: 40, speed: 9, life: 0.55, gravity: 9, drag: 2.2, size: 0.03, spread: 0.05, tail: 0.05, cone: Math.PI },
  embers: { count: 30, speed: 1.4, life: 2.6, gravity: -0.9, drag: 1.1, size: 0.035, spread: 0.6, wobble: 0.5, cone: Math.PI },
  glitter: { count: 40, speed: 0.5, life: 3.0, gravity: 0.15, drag: 0.8, size: 0.13, spread: 1.4, twinkle: 7, cone: Math.PI },
  dust: { count: 26, speed: 4.5, life: 1.6, gravity: -0.4, drag: 3.2, size: 0.32, spread: 0.3, cone: Math.PI },
};
const UP = { x: 0, y: -1, z: 0 };

// Generic deterministic particle burst.
// o: { kind:'sparks'|'embers'|'glitter'|'dust', seed, origin:{x,y,z}, t=S.t, t0=0, count, color:'red'|'blue'|'white'|[r,g,b]|'prism',
//      speed, spread (spawn radius m), dir:{x,y,z}|null, cone (rad), gravity (m/s², +down), drag (1/s), life (s), size (m),
//      tail (s, sparks), box:{x0,x1,y0,y1,z0,z1} (spawn volume instead of origin/spread), emitDur (s: births spread over this window),
//      continuous:false (looping ambient emission), slowmo=1, alpha=1, zMin, zMax, flat:false (dust ring in the ground plane), layer }
export function drawParticles(S, o = {}) {
  const kind = o.kind || 'sparks';
  const D = KIND_DEF[kind] || KIND_DEF.sparks;
  const g = (k) => (o[k] == null ? D[k] : o[k]);
  const count = g('count'), speed = g('speed'), life = g('life'), grav = g('gravity'), drag = g('drag'), size = g('size'), spread = g('spread');
  const cone = o.cone == null ? (o.dir ? 0.55 : D.cone) : o.cone;
  const t = o.t == null ? S.t : o.t, t0 = o.t0 || 0, slow = o.slowmo == null ? 1 : o.slowmo;
  const T = (t - t0) * slow;
  if (T < 0 && !o.continuous) return;
  const seed = (o.seed == null ? 1 : o.seed) * 7919 + kind.length * 131;
  const origin = o.origin || { x: 0, y: 0, z: 0 };
  const prism = o.color === 'prism';
  const P = pal(prism ? 'white' : o.color || 'red');
  const cam = S.cam, emitDur = o.emitDur || 0;
  const zMin = o.zMin == null ? -Infinity : o.zMin, zMax = o.zMax == null ? Infinity : o.zMax;
  const A = o.alpha == null ? 1 : o.alpha;
  const tb = boil(t);
  const dirN = o.dir ? V.norm(o.dir) : null;
  const ctx = kind === 'dust' ? (o.layer || S.L.scene) : (o.layer || S.L.emit);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (kind !== 'dust') ctx.globalCompositeOperation = 'lighter';
  const dustList = [];
  for (let i = 0; i < count; i++) {
    const r0 = new RNG(seed + i * 977);
    const lifeI = life * r0.range(0.55, 1.25);
    let tau, cyc = 0;
    if (o.continuous) {
      const ph = r0.next();
      const u = T / lifeI + ph;
      cyc = Math.floor(u);
      tau = (u - cyc) * lifeI;
    } else {
      tau = T - r0.next() * emitDur;
      if (tau < 0 || tau > lifeI) continue;
    }
    const rng = cyc ? new RNG(seed + i * 977 + cyc * 104729) : r0;
    // spawn
    let p0;
    if (o.box) {
      const b = o.box;
      p0 = { x: rng.range(b.x0, b.x1), y: rng.range(b.y0, b.y1), z: rng.range(b.z0, b.z1) };
    } else {
      const sd = randDir(rng), sr = spread * Math.cbrt(rng.next());
      p0 = { x: origin.x + sd.x * sr, y: origin.y + sd.y * sr, z: origin.z + sd.z * sr };
      if (o.flat) p0.y = origin.y;
    }
    let d = dirN ? coneDir(rng, dirN, cone) : randDir(rng);
    if (o.flat) { d = V.norm({ x: d.x, y: -Math.abs(d.y) * 0.25, z: d.z }); }
    const sp = speed * rng.range(0.35, 1.25);
    const v0 = V.scale(d, sp);
    const lf = tau / lifeI;
    const fade = kind === 'glitter' ? smoothstep(0, 0.12, lf) * (1 - smoothstep(0.7, 1, lf)) : 1 - lf * lf;
    let p = ballistic(p0, v0, grav, drag, tau);
    if (kind === 'embers') {
      const w = g('wobble');
      p.x += noise2(i * 3.1, tau * 0.9) * w;
      p.z += noise2(i * 5.7 + 9, tau * 0.8) * w * 0.6;
    }
    if (p.z < zMin || p.z >= zMax) continue;
    const q = cam.project(p.x, p.y, p.z);
    if (!q || q.z < 0.2) continue;
    if (q.x < -200 || q.x > S.W + 200 || q.y < -200 || q.y > S.H + 200) continue;
    const s = q.s;
    if (kind === 'sparks') {
      const tail = g('tail') * rng.range(0.6, 1.4);
      const pt = ballistic(p0, v0, grav, drag, Math.max(0, tau - tail));
      const qt = cam.project(pt.x, pt.y, pt.z);
      if (!qt) continue;
      const w = clamp(size * s * rng.range(0.6, 1.3), 0.7, 9) * (0.6 + 0.4 * fade);
      const flick = 0.75 + 0.25 * hash2(i, tb);
      const col = prism ? rainbow(rng.next()) : null;
      ctx.globalAlpha = A * fade * 0.55 * flick;
      ctx.fillStyle = rgba(col || P.mid);
      ctx.beginPath(); streak(ctx, qt.x, qt.y, q.x, q.y, w * 2.4); ctx.fill();
      ctx.globalAlpha = A * fade * flick;
      ctx.fillStyle = rgba(col ? mixColor(col, [255, 255, 255], 0.5) : P.hot);
      ctx.beginPath(); streak(ctx, lerp(qt.x, q.x, 0.25), lerp(qt.y, q.y, 0.25), q.x, q.y, w * 1.25); ctx.fill();
      ctx.fillStyle = rgba(P.core);
      ctx.beginPath(); streak(ctx, lerp(qt.x, q.x, 0.55), lerp(qt.y, q.y, 0.55), q.x, q.y, w * 0.55); ctx.fill();
    } else if (kind === 'embers') {
      // sharp diamond speck + small deep halo, flickering on twos (not round pearls)
      const tb2 = Math.floor(tb / 2);
      const flick = 0.45 + 0.55 * hash2(i * 1.3, tb2);
      const r = clamp(size * s * rng.range(0.5, 1.4), 0.75, 3) * (0.7 + 0.3 * flick);
      const ang = hash2(i * 2.9, tb2) * Math.PI;
      const al = A * fade * flick;
      ctx.globalAlpha = al * 0.35; ctx.fillStyle = rgba(P.deep);
      ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = al; ctx.fillStyle = rgba(flick > 0.8 ? P.core : P.hot);
      ctx.beginPath(); diamond(ctx, q.x, q.y, r * 1.25, r * 0.55, ang); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (kind === 'glitter') {
      const tw = g('twinkle') * rng.range(0.6, 1.5);
      const ph = rng.next();
      // twinkle on 24 fps steps (hand-drawn boil)
      const tt = tb / 24;
      const k = Math.pow(Math.max(0, Math.sin(TAU * (tt * tw + ph))), 3);
      const r = Math.min(o.maxPx || 38, size * s * rng.range(0.4, 1.3));
      const col = prism ? rainbow(ph * 3 + tt * 0.2) : null;
      const base = 0.25 + 0.75 * k;
      if (r * base < 1.4) { glowDot(ctx, q.x, q.y, Math.max(0.6, r * 0.12), col ? pal(col) : P, A * fade * base); continue; }
      drawStar(ctx, q.x, q.y, r * base, { color: col ? pal(col) : P, alpha: A * fade * (0.4 + 0.6 * k), rot: (hash1(i * 7.7) - 0.5) * 0.5, diag: 0.35 });
    } else {
      // dust: collect for cel-shaded draw
      const grow = 1 + 2.4 * (1 - Math.exp(-tau * 2.2));
      dustList.push({ q, r: size * s * rng.range(0.6, 1.4) * grow, a: 1 - smoothstep(0.3, 1, lf), seed: i * 13.7 + rng.next() * 100 + tb * 5.1 });
    }
  }
  if (dustList.length) drawDustPuffs(ctx, dustList, o, A * 0.85);
  ctx.restore();
}

function drawDustPuffs(ctx, list, o, groupA) {
  const cols = { lit: o.dustLit, base: o.dustBase, shade: o.dustShade, tint: o.dustTint };
  dustUnion(ctx, list, cols, groupA);
}
// Anime dust billows, cel-shaded in hard tones. All puffs of one call are unioned: every tone is drawn
// opaque for all puffs onto a scratch canvas (shade lobes, then rim tint, base, lit crown), so overlaps
// merge into one silhouette instead of stacking translucent discs; the result is composited once at
// the group alpha. Per-puff fade = shrink + break-up (not alpha). Shapes boil via each puff's seed.
// list items: { q:{x,y,z}, r (px), a (0..1 per-puff life), seed, tdir:{x,y}|null (screen dir toward the energy source) }
const DUST = { lit: [150, 146, 198], base: [74, 72, 116], shade: [30, 28, 58] };
let DSCR = null;
function dustScratch(w, h) {
  if (!DSCR || DSCR.width !== w || DSCR.height !== h) DSCR = makeCanvas(w, h);
  return DSCR;
}
function puffLobes(x, y, r, seed) {
  // cumulus billow: one big dome, a crown of smaller lobes over it, two flattened base lobes, 1-2 detached wisps
  const lobes = [];
  const j = (k, s2) => 1 + (hash2(seed + s2, k) - 0.5) * 0.36; // ±18 % radius jitter
  lobes.push({ x: x + (hash2(seed, 0.5) - 0.5) * r * 0.2, y: y - r * 0.12, r: r * 0.58 * j(0, 1.1) });
  const nc = 4 + (hash1(seed * 0.37) < 0.5 ? 1 : 0);
  for (let k = 0; k < nc; k++) {
    const a = Math.PI * (1.08 + 0.84 * (k + 0.5 + (hash2(seed + 2.2, k) - 0.5) * 0.6) / nc);
    const d = r * (0.5 + 0.18 * hash2(seed + 3.3, k));
    lobes.push({ x: x + Math.cos(a) * d * 1.15, y: y - r * 0.12 + Math.sin(a) * d * 0.8, r: r * (0.26 + 0.16 * hash2(seed + 4.4, k)) * j(k, 5.5) });
  }
  for (let k = 0; k < 2; k++) lobes.push({ x: x + (k ? 1 : -1) * r * (0.55 + 0.15 * hash2(seed + 6.6, k)), y: y + r * 0.08, r: r * (0.3 + 0.1 * hash2(seed + 7.7, k)) * j(k, 8.8) });
  const nd = 1 + (hash1(seed * 0.71) < 0.5 ? 1 : 0);
  for (let k = 0; k < nd; k++) {
    const a = Math.PI * (1.05 + 0.9 * hash2(seed + 9.1, k)), d = r * (0.95 + 0.3 * hash2(seed + 4.9, k));
    lobes.push({ x: x + Math.cos(a) * d * 1.1, y: y + Math.sin(a) * d * 0.6, r: r * (0.1 + 0.08 * hash2(seed + 7.3, k)) });
  }
  return lobes;
}
export function dustUnion(ctx, list, cols = {}, groupA = 0.85) {
  if (!list.length || groupA < 0.01) return;
  const lit = cols.lit || DUST.lit, base = cols.base || DUST.base, shade = cols.shade || DUST.shade;
  const W = ctx.canvas.width, Hc = ctx.canvas.height;
  const sc = dustScratch(W, Hc), c = sc.getContext('2d');
  const items = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const d of list) {
    const r = d.r * (0.4 + 0.6 * clamp(d.a));
    if (r < 0.8) continue;
    const lobes = puffLobes(d.q.x, d.q.y, r, d.seed);
    items.push({ d, r, lobes });
    x0 = Math.min(x0, d.q.x - r * 1.6); x1 = Math.max(x1, d.q.x + r * 1.6); y0 = Math.min(y0, d.q.y - r * 1.4); y1 = Math.max(y1, d.q.y + r * 1.0);
  }
  if (!items.length) return;
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(Hc, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.clearRect(x0, y0, x1 - x0, y1 - y0);
  const anyT = items.some((it) => it.d.tdir);
  const pass = (col, dxk, dyk, sk, useT) => {
    c.fillStyle = rgba(col);
    c.beginPath();
    for (const it of items) {
      let dx = dxk * it.r, dy = dyk * it.r;
      if (useT) { if (!it.d.tdir) continue; dx = it.d.tdir.x * it.r * 0.14; dy = it.d.tdir.y * it.r * 0.14; }
      for (const l of it.lobes) { c.moveTo(l.x + dx + l.r * sk, l.y + dy); c.arc(l.x + dx, l.y + dy, l.r * sk, 0, TAU); }
    }
    c.fill();
  };
  pass(shade, 0, 0, 1, false);
  if (cols.tint && anyT) pass(mixColor(base, cols.tint, 0.42), 0, 0, 0.9, true);
  pass(base, -0.08, -0.13, 0.74, false);
  pass(cols.tint && !anyT ? mixColor(lit, cols.tint, 0.3) : lit, -0.17, -0.26, 0.58, false);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = groupA;
  ctx.drawImage(sc, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
// Single puff (back-compat helper): unioned on its own.
export function dustPuff(ctx, x, y, r, a, seed = 0, cols = {}) {
  if (r < 0.6 || a < 0.01) return;
  dustUnion(ctx, [{ q: { x, y, z: 1 }, r, a: 1, seed }], cols, a);
}
