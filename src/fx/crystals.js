// ISSEN — builder E: faceted crimson crystal VFX.
// Crystals are real little 3D convex polyhedra (quartz-like shards: crooked pointed tip, prism body,
// chiselled / pointed back), projected per vertex through S.cam and drawn as hard-edged cel facets into
// S.L.scene (3-tone facet design: near-black crimson / ruby body / one white-hot plane, mottled interior,
// dark keyline on the shadow side) with crisp emission (lit rim, ridge glints, inner specks, timed tip pop,
// needle motion trail + speed hairlines) into S.L.emit for the compositor bloom.
import { RNG, TAU, clamp, lerp, smoothstep, mixColor, rgba, hash1, hash2, hash3, E, pulse } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';
import { PAL, pal, V, rotAxis, randDir, coneDir, ballistic, ballisticVel, spinAngle, boil, drawStar, glowDot, streak, rainbow, drawParticles,
  q24, burstFlash, speck, popEnv } from './particles.js';

// ------------------------------------------------------------------ palettes
// scene-layer facet tones (deep → hi), sky reflection, line + emission palette
export const GEM = {
  crimson: { deep: [26, 0, 9], dark: [82, 0, 22], body: [168, 6, 40], bright: [236, 26, 64], hi: [255, 92, 120], spec: [255, 226, 234],
    sky: [150, 96, 220], inner: [255, 60, 104], line: [30, 0, 12], edge: [255, 170, 190], glow: PAL.red },
  ice: { deep: [4, 10, 40], dark: [10, 32, 104], body: [28, 96, 214], bright: [80, 180, 255], hi: [150, 222, 255], spec: [236, 250, 255],
    sky: [214, 200, 255], inner: [120, 220, 255], line: [6, 12, 44], edge: [214, 246, 255], glow: PAL.blue },
  amethyst: { deep: [20, 0, 34], dark: [62, 8, 100], body: [140, 40, 210], bright: [196, 110, 255], hi: [226, 170, 255], spec: [250, 240, 255],
    sky: [200, 200, 255], inner: [210, 140, 255], line: [24, 4, 40], edge: [240, 220, 255], glow: PAL.violet },
};
GEM.red = GEM.crimson; GEM.blue = GEM.ice;
const gemPal = (p) => (p && typeof p === 'object' && p.body ? p : GEM[p] || GEM.crimson);

// toward the key light: upper-left, slightly from behind (moon) → camera-facing facets stay dark/jewel-deep
const KEY = V.norm({ x: -0.6, y: -0.76, z: 0.12 });
// facet-design light for the 3-tone ranking: upper-left and toward the camera, so the face turned to the viewer
// reads as ruby body / lit plane and the sides + underside carry the near-black crimson
const RANKL = V.norm({ x: -0.45, y: -0.72, z: -0.55 });
// red energy fill from lower-right-front (Akane's side)
const FILL = V.norm({ x: 0.6, y: 0.35, z: -0.7 });

// ------------------------------------------------------------------ geometry
function finalizeGeom(v, f, extra = {}) {
  // orient faces outward (Newell normal vs centroid)
  const c = v.reduce((a, p) => ({ x: a.x + p.x / v.length, y: a.y + p.y / v.length, z: a.z + p.z / v.length }), { x: 0, y: 0, z: 0 });
  const faces = f.map((idx) => {
    let n = { x: 0, y: 0, z: 0 }, fc = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < idx.length; i++) {
      const a = v[idx[i]], b = v[idx[(i + 1) % idx.length]];
      n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
      fc = V.add(fc, V.scale(a, 1 / idx.length));
    }
    if (V.dot(n, V.sub(fc, c)) < 0) idx = idx.slice().reverse();
    return idx;
  });
  const emap = new Map();
  faces.forEach((idx, fi) => {
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i], b = idx[(i + 1) % idx.length];
      const k = a < b ? a * 64 + b : b * 64 + a;
      const e = emap.get(k);
      if (e) e.f2 = fi; else emap.set(k, { a, b, f1: fi, f2: -1 });
    }
  });
  return { v, f: faces, e: [...emap.values()], ...extra };
}
// Quartz-like shard. Local axis +x = leading tip, overall length ~1 (x in [-0.5, 0.5]); radius ~ rad.
// Crooked off-axis tip pyramid (front = its length fraction), prism body (85 %), and either a pointed tail
// or (≈50 %) an oblique chisel cut (flat broken back face).
// o: { sides, rad, front, body, chisel }
export function gemGeometry(seed, o = {}) {
  const rng = new RNG(seed * 31 + 7);
  const n = o.sides || (rng.next() < 0.55 ? 6 : 5);
  const rad = o.rad || rng.range(0.09, 0.15);
  let tipL = o.front || rng.range(0.24, 0.4);
  let body = o.body == null ? (rng.next() < 0.85 ? rng.range(0.3, 0.52) : 0) : o.body;
  const chisel = body > 0.04 && (o.chisel == null ? rng.next() < 0.5 : !!o.chisel);
  if (chisel) body = Math.max(body, 1 - tipL - 0.08);
  else if (1 - tipL - body < 0.12) { const k = 0.88 / (tipL + body); tipL *= k; body *= k; }
  const x1 = 0.5 - tipL, x2 = x1 - body;
  const v = [];
  v.push({ x: 0.5, y: rng.range(-0.07, 0.07), z: rng.range(-0.07, 0.07) });
  const rot0 = rng.range(0, TAU);
  const angs = [], rads = [];
  for (let k = 0; k < n; k++) {
    angs.push(rot0 + (k + rng.range(-0.2, 0.2)) / n * TAU);
    rads.push(rad * rng.range(0.6, 1.25));
  }
  for (let k = 0; k < n; k++) v.push({ x: x1 + rng.range(-0.035, 0.035), y: Math.cos(angs[k]) * rads[k], z: Math.sin(angs[k]) * rads[k] });
  const hasBody = body > 0.04;
  if (hasBody) {
    const tw = rng.range(-0.12, 0.12);
    // oblique cut plane for the chisel back: x = cx + ty*y + tz*z
    const ca = rng.range(0, TAU), m = rng.range(0.05, 0.12) / rad;
    const ty = Math.cos(ca) * m, tz = Math.sin(ca) * m;
    for (let k = 0; k < n; k++) {
      const r = rads[k] * rng.range(0.86, 1.0);
      const y = Math.cos(angs[k] + tw) * r, z = Math.sin(angs[k] + tw) * r;
      const x = chisel ? -0.42 + ty * y + tz * z : x2 + rng.range(-0.03, 0.03);
      v.push({ x, y, z });
    }
  }
  if (!chisel) v.push({ x: -0.5, y: rng.range(-0.04, 0.04), z: rng.range(-0.04, 0.04) });
  const B = v.length - 1, r1 = (k) => 1 + ((k + n) % n), r2 = (k) => (hasBody ? 1 + n + ((k + n) % n) : r1(k));
  const f = [], kinds = [];
  for (let k = 0; k < n; k++) { f.push([0, r1(k), r1(k + 1)]); kinds.push(0); }
  if (hasBody) for (let k = 0; k < n; k++) { f.push([r1(k), r2(k), r2(k + 1), r1(k + 1)]); kinds.push(1); }
  if (chisel) { const cap = []; for (let k = n - 1; k >= 0; k--) cap.push(r2(k)); f.push(cap); kinds.push(3); }
  else for (let k = 0; k < n; k++) { f.push([B, r2(k + 1), r2(k)]); kinds.push(2); }
  return finalizeGeom(v, f, { rad, x1, kinds, n, chisel });
}
// small irregular sliver (tetrahedron or 3-sided bipyramid) for fragments
export function shardGeometry(seed) {
  const rng = new RNG(seed * 17 + 3);
  if (rng.next() < 0.5) {
    const v = [
      { x: 0.5, y: rng.range(-0.05, 0.05), z: 0 },
      { x: rng.range(-0.5, -0.2), y: rng.range(0.15, 0.32), z: rng.range(-0.1, 0.1) },
      { x: rng.range(-0.5, -0.25), y: rng.range(-0.3, -0.12), z: rng.range(0.05, 0.22) },
      { x: rng.range(-0.2, 0.1), y: rng.range(-0.1, 0.1), z: rng.range(-0.26, -0.1) },
    ];
    return finalizeGeom(v, [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]], { rad: 0.22, x1: -0.2, kinds: [0, 0, 0, 2], n: 3 });
  }
  return gemGeometry(seed + 999, { sides: 3, body: 0, rad: rng.range(0.18, 0.3), front: rng.range(0.45, 0.7) });
}

// ------------------------------------------------------------------ helpers
function basis(d, roll) {
  const ref = Math.abs(d.y) < 0.92 ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 1 };
  const u0 = V.norm(V.cross(d, ref)), w0 = V.cross(d, u0);
  const c = Math.cos(roll), s = Math.sin(roll);
  return { d, u: { x: u0.x * c + w0.x * s, y: u0.y * c + w0.y * s, z: u0.z * c + w0.z * s }, w: { x: w0.x * c - u0.x * s, y: w0.y * c - u0.y * s, z: w0.z * c - u0.z * s } };
}
const toWorld = (C, B, L, W, p) => ({ x: C.x + (B.d.x * p.x + B.u.x * p.y * W + B.w.x * p.z * W) * L, y: C.y + (B.d.y * p.x + B.u.y * p.y * W + B.w.y * p.z * W) * L, z: C.z + (B.d.z * p.x + B.u.z * p.y * W + B.w.z * p.z * W) * L });
function hull(P) {
  const pts = P.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const pathPts = (ctx, pts) => { ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); };
function ramp(G, v) {
  v = clamp(v);
  const st = [[0, G.deep], [0.25, G.dark], [0.5, G.body], [0.75, G.bright], [1, G.hi]];
  for (let i = 1; i < st.length; i++) if (v <= st[i][0]) return mixColor(st[i - 1][1], st[i][1], (v - st[i - 1][0]) / (st[i][0] - st[i - 1][0]));
  return G.hi;
}
const nlerp = (a, b, t) => V.norm(V.lerp(a, b, t));
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// scratch layers for depth-of-field blurred gems
let SCR = null;
function scratch(S) {
  if (!SCR || SCR.W !== S.W || SCR.H !== S.H) {
    const a = makeCanvas(S.W, S.H), b = makeCanvas(S.W, S.H);
    SCR = { W: S.W, H: S.H, sc: a.getContext('2d'), em: b.getContext('2d'), a, b };
  }
  return SCR;
}

// Pre-rendered gem interior (per palette): hard-edged dark mottled pockets, lighter glassy pockets and
// thin bright internal fracture lines. Mapped along each gem's projected axis, clipped to its hull.
const MOT = new Map();
function mottleTex(G) {
  let tex = MOT.get(G);
  if (tex) return tex;
  const W = 1024, Hh = 512;
  const c = makeCanvas(W, Hh), x = c.getContext('2d');
  const rng = new RNG(4242);
  const blob = (cx, cy, r, sx, col, a) => {
    const n = rng.int(5, 8);
    x.globalAlpha = a; x.fillStyle = rgba(col);
    x.beginPath();
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * TAU + rng.range(-0.3, 0.3), rr = r * rng.range(0.45, 1.15);
      const px = cx + Math.cos(ang) * rr * sx, py = cy + Math.sin(ang) * rr;
      if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  };
  // angular internal facets ("crushed glass" refraction patches), stretched along the crystal axis = texture x
  const shard = (cx, cy, r, sx, col, a) => {
    const n = rng.int(3, 5), a0 = rng.range(0, TAU);
    x.globalAlpha = a; x.fillStyle = rgba(col);
    x.beginPath();
    for (let k = 0; k < n; k++) {
      const ang = a0 + (k / n) * TAU + rng.range(-0.35, 0.35), rr = r * rng.range(0.55, 1.1);
      const px = cx + Math.cos(ang) * rr * sx, py = cy + Math.sin(ang) * rr;
      if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  };
  for (let i = 0; i < 70; i++) blob(rng.range(0, W), rng.range(0, Hh), rng.range(14, 50), rng.range(1.4, 2.6), G.deep, rng.range(0.3, 0.6));
  for (let i = 0; i < 300; i++) {
    const h = rng.next();
    const col = h < 0.42 ? G.deep : h < 0.7 ? G.dark : h < 0.88 ? G.bright : G.hi;
    const al = h < 0.7 ? rng.range(0.3, 0.65) : rng.range(0.16, 0.36);
    shard(rng.range(0, W), rng.range(0, Hh), rng.range(6, 30), rng.range(1.2, 2.8), col, al);
  }
  // short bright internal cracks (catching light)
  x.lineJoin = 'miter'; x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    let px = rng.range(0, W), py = rng.range(0, Hh);
    const a0 = rng.range(-0.8, 0.8) + (rng.next() < 0.35 ? Math.PI / 2 : 0);
    x.globalAlpha = rng.range(0.35, 0.85);
    x.strokeStyle = rgba(rng.next() < 0.4 ? G.spec : G.hi);
    x.lineWidth = rng.range(0.9, 1.8);
    x.beginPath(); x.moveTo(px, py);
    const segs = rng.int(1, 3);
    for (let k = 0; k < segs; k++) { const a = a0 + rng.range(-0.6, 0.6), l = rng.range(6, 22); px += Math.cos(a) * l; py += Math.sin(a) * l; x.lineTo(px, py); }
    x.stroke();
  }
  // static glitter specks inside the stone
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = rng.range(0.4, 1);
    x.fillStyle = rgba(rng.next() < 0.5 ? G.spec : G.hi);
    x.beginPath(); x.arc(rng.range(0, W), rng.range(0, Hh), rng.range(0.7, 2.0), 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
  tex = c;
  MOT.set(G, tex);
  return tex;
}

// ------------------------------------------------------------------ the gem renderer
// Draw one convex gem. C = world centre, B = basis, L = length (m).
// st: { pal, glowPal, glow=1, alpha=1, flash=0, tb, seed, width=1, blur=0, tip=0 (timed pop at the leading tip),
//   sparkle=1 (inner specks), frontA=0.95, core=1, streak:{pts,w,k}|null, prism=false, hueT, crack=0 (1|2: pre-shatter
//   fracture lines), mottle=1, planes=1, specMix=0.62 (brightest facet → white), keyline=1 }
export function drawGem(S, geom, C, B, L, st = {}) {
  const cam = S.cam;
  const Wd = st.width || 1;
  const nv = geom.v.length;
  const Wv = new Array(nv), P = new Array(nv);
  for (let i = 0; i < nv; i++) {
    const w = toWorld(C, B, L, Wd, geom.v[i]);
    const p = cam.project(w.x, w.y, w.z);
    if (!p || p.z < 0.15) return false;
    Wv[i] = w; P[i] = p;
  }
  const pc = cam.project(C.x, C.y, C.z);
  if (!pc) return false;
  const pxL = L * pc.s;
  // cull offscreen
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of P) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const blur = st.blur || 0;
  const trailM = st.streak ? 600 : 0;
  const margin = 40 + blur * 3 + (st.tip ? pxL * 0.5 : 0) + trailM;
  if (x1 < -margin || x0 > S.W + margin || y1 < -margin || y0 > S.H + margin) return false;

  let sc = S.L.scene, em = S.L.emit;
  const useScratch = blur > 0.9;
  let bx0, by0, bw, bh, R;
  if (useScratch) {
    R = scratch(S);
    let tx0 = x0, ty0 = y0, tx1 = x1, ty1 = y1;
    if (st.streak) for (const p of st.streak.pts) { tx0 = Math.min(tx0, p.x); ty0 = Math.min(ty0, p.y); tx1 = Math.max(tx1, p.x); ty1 = Math.max(ty1, p.y); }
    const m = Math.ceil(blur * 3 + 12 + (st.tip ? pxL * 0.5 : 0));
    bx0 = Math.max(0, Math.floor(tx0 - m)); by0 = Math.max(0, Math.floor(ty0 - m));
    bw = Math.min(S.W, Math.ceil(tx1 + m)) - bx0; bh = Math.min(S.H, Math.ceil(ty1 + m)) - by0;
    if (bw <= 0 || bh <= 0) return false;
    R.sc.setTransform(1, 0, 0, 1, 0, 0); R.em.setTransform(1, 0, 0, 1, 0, 0);
    R.sc.clearRect(bx0, by0, bw, bh); R.em.clearRect(bx0, by0, bw, bh);
    sc = R.sc; em = R.em;
  }
  const G = gemPal(st.pal);
  const GP = st.glowPal || (st.prism ? PAL.white : G.glow);
  const A = st.alpha == null ? 1 : st.alpha;
  const glow = st.glow == null ? 1 : st.glow;
  const flash = st.flash || 0;
  const camP = { x: cam.x, y: cam.y, z: cam.z };
  const seed = st.seed || 0;
  const tb = st.tb || 0;
  const prism = !!st.prism;
  const bokeh = [];

  sc.save(); em.save();
  sc.setTransform(1, 0, 0, 1, 0, 0); em.setTransform(1, 0, 0, 1, 0, 0);
  em.globalCompositeOperation = 'lighter';
  sc.lineJoin = em.lineJoin = 'round'; sc.lineCap = em.lineCap = 'round';
  const H = hull(P);
  let hx = 0, hy = 0; for (const p of H) { hx += p.x / H.length; hy += p.y / H.length; }

  // ---- tiny LOD: a dark chip with a timed glint
  if (pxL < 7) {
    sc.globalAlpha = A;
    sc.fillStyle = rgba(prism ? [220, 220, 255] : G.body);
    sc.beginPath(); pathPts(sc, H); sc.fill();
    em.globalAlpha = A * glow * 0.45;
    em.fillStyle = rgba(GP.mid);
    em.beginPath(); pathPts(em, H); em.fill();
    const tw = popEnv(tb, seed, 0.6 + 0.5 * hash1(seed * 0.37));
    if (tw > 0) speck(em, pc.x, pc.y, Math.max(1, pxL * 0.22) * tw, GP, A * glow * tw);
    sc.restore(); em.restore();
    if (useScratch) blit(S, R, bx0, by0, bw, bh, blur, bokeh, GP, G);
    return true;
  }

  const lw = clamp(pxL * 0.011, 0.7, 3.4);
  // projected axis (for interior mapping, core glow and speed hairlines)
  const tipP = cam.project(...xyz(toWorld(C, B, L, Wd, { x: 0.5, y: 0, z: 0 })));
  const tailP = cam.project(...xyz(toWorld(C, B, L, Wd, { x: -0.5, y: 0, z: 0 })));
  let ax = 1, ay = 0, al = 1, hwMax = 1;
  if (tipP && tailP) {
    ax = tipP.x - tailP.x; ay = tipP.y - tailP.y; al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    for (const p of H) hwMax = Math.max(hwMax, Math.abs((p.x - pc.x) * -ay + (p.y - pc.y) * ax));
  }
  // ---- motion streak (emission; starts at the tail vertex)
  if (st.streak && st.streak.pts.length > 1) {
    const sk = A * glow * st.streak.k;
    drawTrail(em, st.streak.pts, st.streak.w, GP, sk, clamp(90 / pxL, 0.35, 1));
    // speed hairlines from the girdle (the two hull points farthest from the axis, one each side)
    const pts = st.streak.pts, pl = pts[pts.length - 1], p0 = pts[0];
    let dx = pl.x - p0.x, dy = pl.y - p0.y; const dl = Math.hypot(dx, dy);
    // only when the gem really streaks across the screen (not for gems flying at / away from the lens)
    if (dl > 4 && dl > pxL * 0.35 && blur < 4) {
      dx /= dl; dy /= dl;
      let best = [null, null], bd = [0, 0];
      for (const p of H) {
        const side = (p.x - pc.x) * -dy + (p.y - pc.y) * dx;
        const j = side > 0 ? 0 : 1;
        if (Math.abs(side) > bd[j]) { bd[j] = Math.abs(side); best[j] = p; }
      }
      const len = Math.min(dl * 1.15, pxL * 3);
      for (let j = 0; j < (pxL < 70 ? 1 : 2); j++) {
        const p = best[(j + seed) % 2] || best[j];
        if (!p) continue;
        const lk = 0.55 + 0.6 * hash2(seed + j, Math.floor(tb / 2));
        em.globalAlpha = sk * 0.6;
        em.fillStyle = rgba(GP.core);
        em.beginPath(); streak(em, p.x + dx * len * lk, p.y + dy * len * lk, p.x, p.y, clamp(lw * 0.5, 1, 1.5)); em.fill();
      }
    }
  }

  // faces
  const F = geom.f.map((idx, fi) => {
    let n = { x: 0, y: 0, z: 0 }, fc = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < idx.length; i++) {
      const a = Wv[idx[i]], b = Wv[idx[(i + 1) % idx.length]];
      n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
      fc.x += a.x / idx.length; fc.y += a.y / idx.length; fc.z += a.z / idx.length;
    }
    n = V.norm(n);
    const view = V.norm(V.sub(camP, fc));
    const ndv = V.dot(n, view);
    return { idx, fi, n, fc, view, ndv, front: ndv > 0 };
  });

  // ---- base silhouette (deep interior; prism glass stays see-through)
  sc.globalAlpha = A * (prism ? 0.22 : st.baseA == null ? 1 : st.baseA);
  sc.fillStyle = rgba(prism ? [235, 230, 255] : G.deep);
  sc.beginPath(); pathPts(sc, H); sc.fill();

  // ---- back faces seen through the body: dim internal light
  for (const f of F) {
    if (f.front) continue;
    const inn = -V.dot(f.n, FILL);
    const v = 0.1 + 0.3 * Math.max(0, inn) + 0.14 * hash2(seed, f.fi);
    let col = ramp(G, v);
    if (prism) col = rainbow(f.fi * 0.21 + seed * 0.13, 0.9, 0.55);
    sc.globalAlpha = A * (st.backA != null ? st.backA : prism ? 0.35 : 0.95);
    sc.fillStyle = rgba(col);
    sc.beginPath(); pathPts(sc, f.idx.map((i) => P[i])); sc.fill();
  }
  const frontA = st.frontA == null ? (prism ? 0.5 : pxL > 90 ? 0.9 : 0.95) : st.frontA;
  // ---- front facets: explicit 3-tone facet design ranked by the key light, weighted by on-screen area:
  //   the darkest ~36 % of the visible area → dark crimson, next ~38 % → ruby body, the rest → bright;
  //   the single brightest facet is pushed toward the white "spec" plane.
  const fcols = [];
  const area = (idx) => { let a = 0; for (let i = 0; i < idx.length; i++) { const p = P[idx[i]], q = P[idx[(i + 1) % idx.length]]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) * 0.5; };
  const fr = F.filter((f) => f.front).map((f) => ({ fi: f.fi, lam: V.dot(f.n, RANKL), ar: area(f.idx) })).sort((a, b) => a.lam - b.lam);
  const rankV = [];
  const nF = fr.length;
  const TD = st.tones || [0.1, 0.5, 0.82];
  let totA = 0; for (const e of fr) totA += e.ar;
  let cumA = 0;
  fr.forEach((e) => { const mid = (cumA + e.ar * 0.5) / (totA || 1); cumA += e.ar; rankV[e.fi] = mid < 0.36 ? TD[0] : mid < 0.74 ? TD[1] : TD[2]; });
  if (nF >= 3) { rankV[fr[0].fi] = TD[0]; rankV[fr[nF - 1].fi] = TD[2]; }
  // a facet covering most of the gem never goes dark: a gem is never one dark slab
  if (nF > 1) { let big = fr[0]; for (const e of fr) if (e.ar > big.ar) big = e; if (big.ar > totA * 0.45 && rankV[big.fi] < TD[1]) rankV[big.fi] = TD[1]; }
  const rankW = st.rankW == null ? 0.85 : st.rankW;
  const topFi = nF ? fr[nF - 1].fi : -1, top2 = nF > 1 ? fr[nF - 2].fi : -1;
  const specMix = st.specMix == null ? (pxL > 100 ? 0.72 : 0.6) : st.specMix;
  for (const f of F) {
    if (!f.front) continue;
    const lam = V.dot(f.n, KEY);
    const H2 = V.norm(V.add(KEY, f.view));
    const spec = V.dot(f.n, H2);
    let v = 0.2 + 0.78 * lam + (hash2(seed + 3.7, f.fi) - 0.5) * 0.2;
    v = lerp(v, rankV[f.fi], rankW);
    if (st.tone != null && f.idx.length > 4) v = st.tone;
    v = Math.round(v * 8) / 8;
    let col = ramp(G, v);
    // violet sky reflection: only on the two brightest (upward/grazing) facets
    if (f.fi === topFi || f.fi === top2) {
      const skyK = clamp(-f.n.y * 1.3 - 0.4) * (0.55 + 0.45 * (1 - Math.abs(f.ndv)));
      col = mixColor(col, G.sky, clamp(skyK * 0.28));
    }
    const glint = smoothstep(0.9, 0.99, spec);
    col = mixColor(col, G.hi, glint * 0.6);
    if (f.fi === topFi && nF > 1 && !prism) col = mixColor(col, G.spec, specMix);
    if (flash > 0) col = mixColor(col, G.spec, clamp(flash));
    if (prism) col = rainbow(f.fi * 0.19 + lam * 0.35 + seed * 0.11 + (st.hueT || 0), 0.85, 0.7 + glint * 0.18);
    fcols[f.fi] = { col, v: f.fi === topFi ? 1 : clamp(v), glint };
    const pts = f.idx.map((i) => P[i]);
    if (blur > 4 && (v >= 0.7 || hash2(seed + 2.2, f.fi) < 0.3)) {
      // bokeh anchor: a point inside the lit facet (re-blitted crisp after the blur)
      const u1 = 0.2 + 0.5 * hash2(seed + 3.1, f.fi), u2 = 0.2 + 0.5 * hash2(seed + 4.7, f.fi);
      bokeh.push(lerpP(lerpP(pts[0], pts[1], u1), pts[pts.length - 1], u2 * 0.6));
    }
    // gradient: along the facet from apex/leading edge to the trailing edge
    const a = pts[0], m = pts.length >= 4 ? lerpP(pts[2], pts[3], 0.5) : lerpP(pts[1], pts[2], 0.5);
    const ga = pts.length >= 4 ? lerpP(pts[0], pts[1], 0.5) : a;
    const flip = hash2(seed + 1.3, f.fi) < 0.5;
    const gr = sc.createLinearGradient(ga.x, ga.y, m.x, m.y);
    if (prism) {
      const h0 = f.fi * 0.19 + seed * 0.11 + (st.hueT || 0) + lam * 0.3;
      gr.addColorStop(0, rgba(rainbow(h0, 0.9, 0.78)));
      gr.addColorStop(0.5, rgba(rainbow(h0 + 0.18, 0.95, 0.72)));
      gr.addColorStop(1, rgba(rainbow(h0 + 0.36, 0.9, 0.8)));
    } else {
      const cLight = mixColor(col, G.bright, 0.12 + glint * 0.3);
      const cDark = mixColor(col, G.deep, f.fi === topFi ? 0.2 : 0.4);
      gr.addColorStop(0, rgba(flip ? cDark : cLight));
      gr.addColorStop(0.5, rgba(col));
      gr.addColorStop(1, rgba(flip ? cLight : cDark));
    }
    sc.globalAlpha = A * frontA;
    sc.fillStyle = gr;
    sc.beginPath(); pathPts(sc, pts); sc.fill();
    // hard cel split inside the facet (painted gem look): a seeded cut across the facet fills one side
    // one tone lighter (dark/body facets: light caught inside) or darker (body facets: shadow pocket)
    if (!prism && pxL > 26 && st.split !== 0) {
      const n = pts.length;
      const h1 = hash2(seed + 5.3, f.fi), h2 = hash2(seed + 6.1, f.fi), h3 = hash2(seed + 7.7, f.fi), h4 = hash2(seed + 8.9, f.fi);
      const tv = rankV[f.fi];
      const corner = tv >= TD[2] || h3 < 0.55;
      const i0 = Math.floor(h1 * n) % n, i1 = corner ? (i0 + 1) % n : (i0 + 2) % n;
      const A0 = lerpP(pts[i0], pts[(i0 + 1) % n], 0.3 + 0.45 * h2), B0 = lerpP(pts[i1], pts[(i1 + 1) % n], 0.25 + 0.5 * h4);
      const sub = [A0];
      for (let j = (i0 + 1) % n; ; j = (j + 1) % n) { sub.push(pts[j]); if (j === i1) break; }
      sub.push(B0);
      let sc2, sa;
      if (tv <= TD[0]) { sc2 = mixColor(G.body, G.dark, 0.25); sa = 0.75; }
      else if (tv >= TD[2]) { sc2 = mixColor(G.hi, G.spec, 0.35); sa = 0.6; }
      else if (h3 < 0.5) { sc2 = mixColor(G.bright, G.hi, 0.2); sa = 0.6; }
      else { sc2 = G.dark; sa = 0.7; }
      if (flash > 0) sc2 = mixColor(sc2, G.spec, clamp(flash));
      sc.globalAlpha = A * sa * frontA;
      sc.fillStyle = rgba(sc2);
      sc.beginPath(); pathPts(sc, sub); sc.fill();
    }
    // light gathers along the borders of the lit facets only
    if (!prism && pxL > 40 && v > 0.6) {
      sc.save();
      sc.beginPath(); pathPts(sc, pts); sc.clip();
      sc.globalAlpha = A * 0.15;
      sc.strokeStyle = rgba(G.bright);
      sc.lineWidth = Math.min(40, pxL * 0.05);
      sc.stroke();
      sc.restore();
    }
    // reflection band across bright triangular facets
    if (pts.length === 3 && v >= 0.5 && hash2(seed + 9.1, f.fi) < 0.6 && pxL > 18) {
      const f1 = 0.26 + 0.12 * hash2(seed, 2.2), f2 = f1 + 0.06 + 0.08 * hash2(seed, f.fi + 4.4);
      const L1 = lerpP(a, pts[1], f1), R1 = lerpP(a, pts[2], f1), L2 = lerpP(a, pts[1], f2), R2 = lerpP(a, pts[2], f2);
      sc.globalAlpha = A * 0.35 * v * (prism ? 0.6 : 1);
      sc.fillStyle = rgba(mixColor(G.bright, G.spec, 0.4));
      sc.beginPath(); sc.moveTo(L1.x, L1.y); sc.lineTo(R1.x, R1.y); sc.lineTo(R2.x, R2.y); sc.lineTo(L2.x, L2.y); sc.closePath(); sc.fill();
    }
  }
  // ---- interior: big hard-edged refraction planes + mottled pockets (painted-ruby depth)
  const planes = st.planes == null ? 1 : st.planes;
  const mottle = st.mottle == null ? 1 : st.mottle;
  let planeA = null;
  if (!prism && (pxL > 110 && planes > 0 || pxL > 70 && mottle > 0) && H.length >= 4 && tipP && tailP) {
    sc.save();
    sc.beginPath(); pathPts(sc, H); sc.clip();
    if (pxL > 110 && planes > 0) {
      // two internal refraction planes fixed in gem-local space (they turn with the gem, no popping):
      // A = long blown-white sliver along the axis (ref1's "white facet plane"), B = deep wedge
      const r = geom.rad, ph = hash1(seed * 1.31) * TAU;
      const loc = (x, a, rr) => { const w = toWorld(C, B, L, Wd, { x, y: Math.cos(a) * r * rr, z: Math.sin(a) * r * rr }); return cam.project(w.x, w.y, w.z); };
      const pa = [loc(-0.42, ph, 0.9), loc(-0.4, ph + 0.9, 0.85), loc(0.36, ph + 0.5, 0.2), loc(0.3, ph + 0.2, 0.35)];
      const pb = [loc(-0.44, ph + 3.1, 0.95), loc(0.05, ph + 2.3, 0.9), loc(0.22, ph + 3.6, 0.5)];
      if (pb.every(Boolean)) {
        sc.globalAlpha = A * 0.62 * planes; sc.fillStyle = rgba(G.deep);
        sc.beginPath(); pathPts(sc, pb); sc.fill();
      }
      if (pa.every(Boolean)) {
        planeA = pa;
        // hard bright edge on one side, fading across the sheet (glass catching light)
        const e0 = lerpP(pa[0], pa[3], 0.5), e1 = lerpP(pa[1], pa[2], 0.5);
        const g = sc.createLinearGradient(e0.x, e0.y, e1.x, e1.y);
        g.addColorStop(0, rgba(G.spec, 0.7)); g.addColorStop(0.45, rgba(mixColor(G.hi, G.spec, 0.5), 0.4)); g.addColorStop(1, rgba(G.hi, 0.05));
        sc.globalAlpha = A * planes; sc.fillStyle = g;
        sc.beginPath(); pathPts(sc, pa); sc.fill();
      }
    }
    sc.restore();
    if (pxL > 70 && mottle > 0) {
      const tex = mottleTex(G);
      const sx = Math.floor(hash1(seed * 0.91) * 512), sy = Math.floor(hash1(seed * 1.77) * 256);
      const cx = (tipP.x + tailP.x) * 0.5, cy = (tipP.y + tailP.y) * 0.5;
      const hl = Math.max(hwMax, al * 0.5);
      const mk = clamp((pxL - 70) / 90) * mottle;
      // per front facet (clipped), lighter on the bright facets so the white plane stays white
      const draws = [];
      for (const f of F) { if (f.front && fcols[f.fi]) draws.push({ pts: f.idx.map((i) => P[i]), a: fcols[f.fi].v >= 1 ? 0.3 : fcols[f.fi].v >= 0.7 ? 0.55 : 0.85 }); }
      for (const d of draws) {
        sc.save();
        sc.beginPath(); pathPts(sc, d.pts); sc.clip();
        sc.transform(ax * hl, ay * hl, -ay * hwMax, ax * hwMax, cx, cy);
        sc.globalAlpha = A * mk * d.a;
        sc.drawImage(tex, sx, sy, 512, 256, -1, -1, 2, 2);
        sc.restore();
      }
    }
  }
  // ---- dark refraction specks
  if (!prism && pxL > 60) {
    const nd = pxL > 200 ? 10 : 6;
    sc.fillStyle = rgba(G.deep);
    for (let k = 0; k < nd; k++) {
      const lp = { x: lerp(-0.36, 0.3, hash2(seed + k, 8.3)), y: (hash2(seed + k, 9.9) - 0.5) * geom.rad * 1.1, z: (hash2(seed + k, 6.1) - 0.5) * geom.rad * 1.1 };
      const q = cam.project(...xyz(toWorld(C, B, L, Wd, lp)));
      if (!q) continue;
      sc.globalAlpha = A * 0.8;
      sc.beginPath(); sc.arc(q.x, q.y, clamp(pxL * 0.006, 1, 3) * (0.6 + 0.6 * hash2(seed, k)), 0, TAU); sc.fill();
    }
  }
  // ---- edges
  for (const e of geom.e) {
    const fa = F[e.f1], fb = e.f2 >= 0 ? F[e.f2] : null;
    const pa = P[e.a], pb = P[e.b];
    if (fb && fa.front !== fb.front) continue;
    if (!fa.front) {
      // internal edge seen through the gem: barely there
      sc.globalAlpha = A * (prism ? 0.3 : 0.12);
      sc.strokeStyle = rgba(G.inner);
      sc.lineWidth = lw * 0.5;
      sc.beginPath(); sc.moveTo(pa.x, pa.y); sc.lineTo(pb.x, pb.y); sc.stroke();
    } else {
      const ca = fcols[fa.fi], cb = fb ? fcols[fb.fi] : ca;
      const br = Math.max(ca ? ca.v + ca.glint : 0, cb ? cb.v + cb.glint : 0);
      sc.globalAlpha = A * clamp(0.08 + br * 0.55);
      sc.strokeStyle = rgba(prism ? [255, 255, 255] : G.edge);
      sc.lineWidth = lw * 0.6;
      sc.beginPath(); sc.moveTo(pa.x, pa.y); sc.lineTo(pb.x, pb.y); sc.stroke();
    }
  }
  // ---- silhouette: dark keyline on the shadow side only (lit side is carried by the emissive rim)
  const keyK = st.keyline == null ? 1 : st.keyline;
  const segs = [];
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    let nx = b.y - a.y, ny = -(b.x - a.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (nx * ((a.x + b.x) / 2 - hx) + ny * ((a.y + b.y) / 2 - hy) < 0) { nx = -nx; ny = -ny; }
    segs.push({ a, b, lit: nx * -0.6 + ny * -0.8 });
  }
  if (prism) {
    sc.beginPath(); pathPts(sc, H);
    sc.globalAlpha = A * 0.75; sc.strokeStyle = 'rgb(255,255,255)'; sc.lineWidth = lw * 0.8; sc.stroke();
  } else if (keyK > 0) {
    sc.strokeStyle = rgba(G.line);
    sc.lineWidth = lw * 1.8;
    for (const s of segs) {
      const k = 1 - smoothstep(0.0, 0.3, s.lit);
      if (k <= 0.01) continue;
      sc.globalAlpha = A * k * keyK;
      sc.beginPath(); sc.moveTo(s.a.x, s.a.y); sc.lineTo(s.b.x, s.b.y); sc.stroke();
    }
  }
  // ---- pre-shatter: body darkens, fracture lines (emission below)
  const crack = st.crack || 0;
  if (crack > 0) {
    sc.globalAlpha = A * 0.3; sc.fillStyle = rgba(G.deep);
    sc.beginPath(); pathPts(sc, H); sc.fill();
  }

  // ---- emission
  const eg = A * glow;
  if (eg > 0.01) {
    // inner core: soft elongated glow along the axis, kept low so the body stays ruby (not pink)
    const midW = toWorld(C, B, L, Wd, { x: geom.x1 != null ? geom.x1 : 0, y: 0, z: 0 });
    const midP = cam.project(midW.x, midW.y, midW.z);
    const coreK = (st.core == null ? 1 : st.core) * (pxL > 120 ? 0.8 : 1);
    if (tipP && tailP && midP && coreK > 0) {
      const t2 = cam.project(...xyz(toWorld(C, B, L, Wd, { x: 0.36, y: 0, z: 0 }))), l2 = cam.project(...xyz(toWorld(C, B, L, Wd, { x: -0.4, y: 0, z: 0 })));
      if (t2 && l2) {
        let bx = t2.x - l2.x, by = t2.y - l2.y; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
        const hw = Math.max(1, geom.rad * Wd * L * midP.s * 0.5);
        const hl = Math.max(hw, bl * 0.5);
        em.save();
        em.transform(bx * hl, by * hl, -by * hw, bx * hw, (t2.x + l2.x) * 0.5, (t2.y + l2.y) * 0.5);
        // saturated red inner light (mid/deep only: lifts the ruby without washing it pink); small gems keep
        // a tiny hot centre so they still read as lit from within at wide-shot size
        const g = em.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(pxL < 80 ? GP.hot : GP.mid, pxL < 80 ? 0.3 : 0.34));
        g.addColorStop(0.08, rgba(GP.mid, 0.26));
        g.addColorStop(0.35, rgba(GP.deep, 0.2));
        g.addColorStop(0.7, rgba(GP.deep, 0.08));
        g.addColorStop(1, rgba(GP.deep, 0));
        em.globalAlpha = eg * coreK;
        em.fillStyle = g;
        em.beginPath(); em.moveTo(1, 0); em.lineTo(0, 1); em.lineTo(-1, 0); em.lineTo(0, -1); em.closePath(); em.fill();
        em.restore();
      }
    }
    // lit rim: white-hot only on the edges facing the light, broken up on twos
    const tb2 = Math.floor(tb / 2);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.lit < 0.05) continue;
      const bk = 0.35 + 0.65 * hash2(seed + i, tb2);
      em.globalAlpha = eg * clamp(s.lit * 1.4) * 0.8 * bk;
      em.strokeStyle = rgba(GP.hot); em.lineWidth = lw * 1.1;
      em.beginPath(); em.moveTo(s.a.x, s.a.y); em.lineTo(s.b.x, s.b.y); em.stroke();
      const ck = clamp((s.lit - 0.5) * 2.5);
      if (ck > 0) { em.globalAlpha = eg * ck * 0.9 * bk; em.strokeStyle = rgba(GP.core); em.lineWidth = lw * 0.45; em.stroke(); }
    }
    // every front ridge carries a thin saturated red glow (the gem glows from inside along its edges);
    // ridges between bright facets add a white-hot glint on top
    const ridges = [];
    const ridgeK = st.ridges == null ? 1 : st.ridges;
    for (const e of geom.e) {
      const fa = F[e.f1], fb = e.f2 >= 0 ? F[e.f2] : null;
      if (!fa.front || !fb || !fb.front) continue;
      const ca = fcols[fa.fi], cb = fcols[fb.fi];
      const br = Math.max(ca.v + ca.glint, cb.v + cb.glint);
      if (ridgeK > 0 && pxL > 14 && !prism) {
        em.globalAlpha = eg * ridgeK * (0.22 + 0.2 * clamp(br));
        em.strokeStyle = rgba(GP.mid);
        em.lineWidth = lw * 0.8;
        em.beginPath(); em.moveTo(P[e.a].x, P[e.a].y); em.lineTo(P[e.b].x, P[e.b].y); em.stroke();
      }
      if (br < 0.62) continue;
      const k = clamp((br - 0.62) * 2.5);
      em.globalAlpha = eg * k * 0.45;
      em.strokeStyle = rgba(GP.mid);
      em.lineWidth = lw * 1.1;
      em.beginPath(); em.moveTo(P[e.a].x, P[e.a].y); em.lineTo(P[e.b].x, P[e.b].y); em.stroke();
      em.globalAlpha = eg * k * 0.75;
      em.strokeStyle = rgba(GP.core);
      em.lineWidth = lw * 0.4;
      em.stroke();
      ridges.push({ k: br, p: lerpP(P[e.a], P[e.b], 0.5) });
    }
    ridges.sort((a, b) => b.k - a.k);
    for (let i = 0; i < Math.min(2, ridges.length); i++) bokeh.push(ridges[i].p);
    // specular facet glow
    for (const f of F) {
      if (!f.front) continue;
      const c = fcols[f.fi];
      if (c.glint < 0.2) continue;
      em.globalAlpha = eg * c.glint * 0.25;
      em.fillStyle = rgba(prism ? c.col : GP.mid);
      em.beginPath(); pathPts(em, f.idx.map((i) => P[i])); em.fill();
    }
    // white refraction plane glows a little
    if (planeA) {
      em.save(); em.beginPath(); pathPts(em, H); em.clip();
      em.globalAlpha = eg * 0.25 * planes; em.fillStyle = rgba(GP.hot);
      em.beginPath(); pathPts(em, planeA); em.fill();
      em.restore();
    }
    // inner light: saturated red glow spots of mixed size (ref1's lit-from-within ruby) + a few crisp white specks
    if (pxL > 26 && st.sparkle !== 0) {
      const ns = pxL > 300 ? 30 : pxL > 160 ? 18 : pxL > 70 ? 9 : 3;
      for (let k = 0; k < ns; k++) {
        const lp = { x: lerp(-0.38, 0.3, hash2(seed + k, 1.7)), y: (hash2(seed + k, 2.9) - 0.5) * geom.rad * 1.2, z: (hash2(seed + k, 5.1) - 0.5) * geom.rad * 1.2 };
        const q = cam.project(...xyz(toWorld(C, B, L, Wd, lp)));
        if (!q) continue;
        const tw = Math.pow(Math.max(0, Math.sin(TAU * (tb / 24 * (1.5 + 2.5 * hash1(seed + k * 3)) + hash1(seed * 1.3 + k)))), 3);
        const white = hash2(seed + k, 7.3) < 0.3;
        if (white) {
          const r = Math.min(2.5, Math.max(0.6, pxL * 0.006)) * (0.6 + 0.5 * tw);
          speck(em, q.x, q.y, r, GP, eg * (0.3 + 0.7 * tw));
        } else {
          // soft-edged red light pocket: deep disc + mid core
          const r = Math.min(9, Math.max(0.8, pxL * (0.004 + 0.016 * Math.pow(hash2(seed + k, 4.4), 3)))) * (0.8 + 0.3 * tw);
          em.globalAlpha = eg * 0.35; em.fillStyle = rgba(GP.deep);
          em.beginPath(); em.arc(q.x, q.y, r * 1.6, 0, TAU); em.fill();
          em.globalAlpha = eg * (0.35 + 0.35 * tw); em.fillStyle = rgba(GP.mid);
          em.beginPath(); em.arc(q.x, q.y, r, 0, TAU); em.fill();
        }
        if (k < 4) bokeh.push(q);
      }
    }
    // leading-tip pop: periodic, timed on 24 fps (pop 2, hold 2, decay 3, off)
    if (st.tip) {
      const env = popEnv(tb, seed, 0.5 + 0.4 * hash1(seed * 2.17));
      const r = Math.min(70, pxL * 0.16 * st.tip) * env;
      if (r > 2) drawStar(em, P[0].x, P[0].y, r, { color: GP, alpha: eg * clamp(st.tip) * (0.55 + 0.45 * env), rot: hash2(seed, 3) * 0.6, diag: 0.3 });
    }
    bokeh.push(P[0]);
    // materialise flash
    if (flash > 0.01) {
      em.globalAlpha = clamp(flash) * A * 0.85;
      em.fillStyle = rgba(GP.hot);
      em.beginPath(); pathPts(em, H); em.fill();
      em.globalAlpha = clamp(flash) * A * 0.5;
      em.strokeStyle = rgba(GP.mid);
      em.lineWidth = lw * 2;
      em.stroke();
    }
    // pre-shatter fracture lines (2 frames: 3 then 6 jagged cracks across the hull)
    if (crack > 0 && H.length >= 3) {
      em.save(); em.beginPath(); pathPts(em, H); em.clip();
      const nc = crack >= 2 ? 6 : 3;
      const nh = H.length;
      for (let k = 0; k < nc; k++) {
        const i0 = Math.floor(hash2(seed, k * 3.3) * nh), i1 = (i0 + Math.floor(nh / 2) + Math.floor(hash2(seed, k * 5.1) * 2)) % nh;
        const a = lerpP(H[i0], H[(i0 + 1) % nh], hash2(seed + 1, k)), b = lerpP(H[i1], H[(i1 + 1) % nh], hash2(seed + 2, k));
        const pts = [a];
        const nj = 3;
        let nx = -(b.y - a.y), ny = b.x - a.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        for (let j = 1; j <= nj; j++) {
          const u = j / (nj + 1), jg = (hash3(seed, k, j) - 0.5) * nl * 0.18;
          const m = lerpP(lerpP(a, b, u), { x: hx, y: hy }, 0.25);
          pts.push({ x: m.x + nx * jg, y: m.y + ny * jg });
        }
        pts.push(b);
        em.beginPath(); em.moveTo(pts[0].x, pts[0].y); for (let j = 1; j < pts.length; j++) em.lineTo(pts[j].x, pts[j].y);
        em.globalAlpha = A * 0.6; em.strokeStyle = rgba(GP.hot); em.lineWidth = lw * 2; em.stroke();
        em.globalAlpha = A; em.strokeStyle = rgba(GP.core); em.lineWidth = lw * 0.8; em.stroke();
      }
      em.restore();
    }
  }
  sc.restore(); em.restore();
  if (st.bokehMax != null && bokeh.length > st.bokehMax) bokeh.length = st.bokehMax;
  if (useScratch) blit(S, R, bx0, by0, bw, bh, blur, bokeh, GP, G, tb);
  return true;
}
const xyz = (p) => [p.x, p.y, p.z];
// Composite a scratch-rendered (defocused) gem: blurred body darkened toward ruby, blurred glow dimmed,
// then crisp bokeh discs on its specular points so it still reads as a jewel.
function blit(S, R, x, y, w, h, blur, bokeh, GP, G, tb = 0) {
  const sc = S.L.scene, em = S.L.emit;
  if (blur > 2) {
    R.sc.save(); R.sc.setTransform(1, 0, 0, 1, 0, 0);
    R.sc.globalCompositeOperation = 'source-atop'; R.sc.globalAlpha = 0.3; R.sc.fillStyle = rgba(G.deep);
    R.sc.fillRect(x, y, w, h); R.sc.restore();
  }
  sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.filter = `blur(${blur.toFixed(1)}px)`;
  sc.drawImage(R.a, x, y, w, h, x, y, w, h); sc.restore();
  // defocused emission spreads its energy: dim it so bokeh stays crimson instead of clipping white
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter'; em.filter = `blur(${(blur * 1.1).toFixed(1)}px)`;
  em.globalAlpha = clamp(1.3 - blur / 22, 0.35, 1);
  em.drawImage(R.b, x, y, w, h, x, y, w, h); em.restore();
  if (blur > 4 && bokeh && bokeh.length) {
    // crisp bokeh discs on the gem's speculars: soft hot fill, brighter rim (lens-like), sizes varied
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
    const r0 = Math.min(48, blur * 0.62);
    const nb = Math.min(bokeh.length, blur > 12 ? 9 : 6);
    const bk = clamp((blur - 4) / 6);
    for (let k = 0; k < nb; k++) {
      const p = bokeh[k];
      const bx = p.x + (hash2(k, tb) - 0.5) * 0.8, by = p.y + (hash2(k + 9, tb) - 0.5) * 0.8;
      const rr = r0 * (0.45 + 0.7 * hash1(k * 3.3 + 0.7));
      const a = bk * (0.65 + 0.35 * hash1(k * 5.1));
      em.globalAlpha = a * 0.13; em.fillStyle = rgba(GP.mid);
      em.beginPath(); em.arc(bx, by, rr, 0, TAU); em.fill();
      em.globalAlpha = a * 0.16; em.fillStyle = rgba(GP.hot);
      em.beginPath(); em.arc(bx, by, rr * 0.9, 0, TAU); em.fill();
      em.globalAlpha = a * 0.45; em.strokeStyle = rgba(GP.hot); em.lineWidth = Math.max(1, rr * 0.07);
      em.beginPath(); em.arc(bx, by, rr * 0.93, 0, TAU); em.stroke();
    }
    em.restore();
  }
}
// tapered emissive needle trail through screen points (head first): fades in over its first 15 %
function drawTrail(ctx, pts, w, GP, a, hotK = 1) {
  if (a <= 0.01) return;
  const n = pts.length;
  const h = pts[0], tl = pts[n - 1];
  const ribbon = (wk, col, al, minW) => {
    if (al <= 0.003) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = o.x - q.x, dy = o.y - q.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const k = 1 - (i / (n - 1));
      const hw = (w * wk * Math.pow(k, 1.6) + minW * k) * 0.5;
      L.push({ x: p.x - dy * hw, y: p.y + dx * hw }); R.push({ x: p.x + dy * hw, y: p.y - dx * hw });
    }
    const g = ctx.createLinearGradient(h.x, h.y, tl.x, tl.y);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.15, rgba(col, clamp(al)));
    g.addColorStop(0.6, rgba(col, clamp(al) * 0.5));
    g.addColorStop(1, rgba(col, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); pathPts(ctx, L.concat(R.reverse())); ctx.fill();
  };
  ribbon(1.0, GP.deep, a * 0.12, 0);
  ribbon(0.5, GP.mid, a * 0.3, 0.6);
  ribbon(0.2, GP.hot, a * 0.6 * hotK, 0.9);
  ribbon(0.07, GP.core, a * 0.9 * hotK, 0.7);
}

// ------------------------------------------------------------------ swarm
function bez(c, u) {
  const a = 1 - u, b0 = a * a * a, b1 = 3 * a * a * u, b2 = 3 * a * u * u, b3 = u * u * u;
  return { x: c[0].x * b0 + c[1].x * b1 + c[2].x * b2 + c[3].x * b3, y: c[0].y * b0 + c[1].y * b1 + c[2].y * b2 + c[3].y * b3, z: c[0].z * b0 + c[1].z * b1 + c[2].z * b2 + c[3].z * b3 };
}
function bezD(c, u) {
  const a = 1 - u, k0 = 3 * a * a, k1 = 6 * a * u, k2 = 3 * u * u;
  return { x: (c[1].x - c[0].x) * k0 + (c[2].x - c[1].x) * k1 + (c[3].x - c[2].x) * k2, y: (c[1].y - c[0].y) * k0 + (c[2].y - c[1].y) * k1 + (c[3].y - c[2].y) * k2, z: (c[1].z - c[0].z) * k0 + (c[2].z - c[1].z) * k1 + (c[3].z - c[2].z) * k2 };
}

// makeCrystalSwarm(seed, { count=36, origin, target, spread=1.3, formation='halo'|'cloud'|'ring'|'fan', size=0.6 (m length),
//   sizeVar=null (null: power-law sizes 0.45..2.05 × size with 8 % heroes ×1.8; a number: old uniform ±sizeVar),
//   heroes=0.08, targetSpread=0.9, curve=1, facing=0.55, sides=null, shape=null ({front, body, chisel, rad} forced on gemGeometry) })
export function makeCrystalSwarm(seed = 1, o = {}) {
  const count = o.count == null ? 36 : o.count;
  const origin = o.origin || { x: 4, y: -1.3, z: 0 };
  const target = o.target || { x: -4, y: -1, z: 0 };
  const spread = o.spread == null ? 1.3 : o.spread;
  const formation = o.formation || 'halo';
  const size = o.size == null ? 0.6 : o.size, sizeVar = o.sizeVar;
  const heroes = o.heroes == null ? 0.08 : o.heroes;
  const tSpread = o.targetSpread == null ? 0.9 : o.targetSpread;
  const curve = o.curve == null ? 1 : o.curve;
  const facing = o.facing == null ? 0.55 : o.facing;
  const rng = new RNG(seed * 7 + 3);
  const aim = V.norm(V.sub(target, origin));
  const nrm = V.norm(V.lerp(aim, { x: 0, y: 0, z: -1 }, facing));
  const ref = Math.abs(nrm.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
  const ru = V.norm(V.cross(nrm, ref)), rw = V.cross(nrm, ru);
  const crystals = [];
  for (let i = 0; i < count; i++) {
    let slot, ringK = 0;
    const ang = i * 2.39996323 + rng.range(-0.25, 0.25);
    if (formation === 'cloud') {
      const d = randDir(rng); const r = spread * (0.35 + 0.65 * Math.cbrt(rng.next()));
      slot = V.add(origin, { x: d.x * r * 1.1, y: d.y * r * 0.8, z: d.z * r });
      slot = V.madd(slot, aim, spread * 0.25);
    } else if (formation === 'ring') {
      const r = spread * rng.range(0.85, 1.1);
      slot = V.add(V.madd(origin, aim, spread * 0.35), V.add(V.scale(ru, Math.cos(i / count * TAU) * r), V.scale(rw, Math.sin(i / count * TAU) * r)));
    } else if (formation === 'fan') {
      const a = lerp(-1.25, 1.25, count > 1 ? i / (count - 1) : 0.5) + rng.range(-0.08, 0.08);
      const r = spread * rng.range(0.75, 1.15) * (i % 2 ? 1 : 0.72);
      slot = V.add(V.madd(origin, aim, -spread * 0.2 + rng.range(-0.1, 0.1)), V.add(V.scale(ru, Math.sin(a) * r), V.scale(rw, -Math.cos(a) * r)));
    } else { // halo: 3 nested tilted rings, golden-angle spiral
      ringK = i % 3;
      const r = spread * (0.42 + 0.3 * ringK) * rng.range(0.85, 1.15);
      const fwd = spread * (0.42 - 0.18 * ringK) + rng.range(-0.12, 0.12);
      slot = V.add(V.madd(origin, aim, fwd), V.add(V.scale(ru, Math.cos(ang) * r), V.scale(rw, Math.sin(ang) * r)));
    }
    let L;
    const rs = rng.next(), rh = rng.next();
    if (sizeVar != null) { L = size * (1 + sizeVar * (rs * 2 - 1)); if (rh < 0.1 && sizeVar > 0) L *= 1.55; }
    else { L = size * (0.45 + 1.6 * Math.pow(rs, 2.2)); if (rh < heroes) L *= 1.8; }
    const tgt = V.add(target, V.scale(randDir(rng), tSpread * Math.cbrt(rng.next())));
    const aimI = V.norm(V.sub(tgt, slot));
    const D = V.len(V.sub(tgt, slot));
    let out = V.sub(slot, origin); out = V.madd(out, aim, -V.dot(out, aim));
    if (V.len(out) < 1e-3) out = randDir(rng);
    out = V.norm(out);
    const jit = V.scale(randDir(rng), D * 0.06 * curve);
    const P0 = V.madd(slot, aimI, -0.16);
    const ctl = [P0, V.add(V.add(V.madd(slot, aimI, D * 0.3), V.scale(out, D * 0.2 * curve)), jit), V.add(V.madd(tgt, aimI, -D * 0.32), V.scale(out, D * 0.05 * curve)), tgt];
    // arc-length LUT
    const lut = [0]; let prev = ctl[0], acc = 0;
    for (let k = 1; k <= 32; k++) { const p = bez(ctl, k / 32); acc += V.len(V.sub(p, prev)); lut.push(acc); prev = p; }
    const geom = gemGeometry(seed * 1000 + i, Object.assign({ sides: o.sides || null }, o.shape || {}));
    crystals.push({
      i, seed: seed * 1000 + i, geom, L, slot, target: tgt, aim: aimI, ctl, lut, pathLen: acc, ringK,
      tan0: V.norm(bezD(ctl, 0)), tan1: V.norm(bezD(ctl, 1)),
      dir0: randDir(rng), roll0: rng.range(0, TAU), rollSpd: rng.range(0.4, 1.2) * rng.sign(), flySpin: rng.range(5, 11) * rng.sign(),
      bobA: rng.range(0.02, 0.06), bobW: rng.range(1.6, 2.8), bobP: rng.range(0, TAU),
      formU: count > 1 ? i / (count - 1) : 0, launchR: rng.next(), width: rng.range(0.65, 1.3),
    });
  }
  // launch order: random permutation, spread evenly
  const perm = crystals.map((c) => c).sort((a, b) => a.launchR - b.launchR);
  perm.forEach((c, k) => { c.launchU = count > 1 ? k / (count - 1) : 0; });
  return { seed, count, origin, target, aim, crystals, spread };
}

function sAt(tau, speed, accel) { return tau <= 0 ? 0 : speed * (tau - accel * (1 - Math.exp(-tau / accel))); }
function tauForS(s, speed, accel) {
  let tau = s / speed + accel;
  for (let k = 0; k < 6; k++) { const f = sAt(tau, speed, accel) - s, d = speed * (1 - Math.exp(-tau / accel)); if (d < 1e-6) break; tau -= f / d; if (tau < 0) tau = 1e-4; }
  return tau;
}
function pathU(c, s) {
  const lut = c.lut;
  if (s <= 0) return 0;
  if (s >= c.pathLen) return 1;
  let lo = 0, hi = lut.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lut[m] < s) lo = m; else hi = m; }
  return (lo + (s - lut[lo]) / (lut[hi] - lut[lo] || 1)) / (lut.length - 1);
}
function pathPos(c, s) {
  if (s <= c.pathLen) return bez(c.ctl, pathU(c, s));
  return V.madd(c.ctl[3], c.tan1, s - c.pathLen);
}
function pathTan(c, s) { return s >= c.pathLen ? c.tan1 : V.norm(bezD(c.ctl, pathU(c, s))); }

function timing(c, o) {
  c.formT = o.formT0 + c.formU * o.formDur;
  c.launchT = o.launchT0 + c.launchU * o.stagger;
  c.arriveT = c.launchT + tauForS(c.pathLen, o.speed, o.accel);
  c.timeAt = (u) => c.launchT + tauForS(Math.max(0, u) * c.pathLen, o.speed, o.accel);
}
const DEF = { formT0: 0, formDur: 0.7, growDur: 0.24, converge: 0.32, launchT0: 1.2, stagger: 0.5, speed: 24, accel: 0.07, antic: 0.22, passLife: 2.0 };
function fillOpts(o) { const r = Object.assign({}, DEF); for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; }

// crystal state at time t (world). phase: 'pre' | 'hover' | 'fly' | 'gone'
export function crystalState(c, t, oo) {
  const o = oo.formT0 === undefined || oo.speed === undefined ? fillOpts(oo) : oo;
  if (c.formT === undefined || c._o !== o) { timing(c, o); c._o = o; }
  if (t < c.formT) return { phase: 'pre', k: 1 - (c.formT - t) / o.converge, pos: c.slot };
  const age = t - c.formT;
  const g = clamp(age / o.growDur);
  const scale = g < 1 ? Math.max(0, E.outBack(g, 2.4)) : 1;
  // formation flash snaps on 24 fps (held, not tweened)
  const flash = pulse(Math.max(c.formT, q24(t)), c.formT, 0.025, 0.11) * 0.95;
  if (t < c.launchT) {
    const bob = { x: Math.sin(t * c.bobW + c.bobP) * c.bobA, y: Math.cos(t * c.bobW * 0.8 + c.bobP * 1.7) * c.bobA * 1.2, z: Math.sin(t * c.bobW * 0.6 + c.bobP * 2.3) * c.bobA };
    const pull = smoothstep(c.launchT - o.antic, c.launchT, t);
    const pos = V.add(V.madd(c.slot, c.aim, -0.16 * pull), V.scale(bob, 1 - pull));
    let dir = nlerp(c.dir0, c.aim, E.outCubic(clamp(age / 0.45)));
    dir = nlerp(dir, c.tan0, pull);
    return { phase: 'hover', pos, dir, roll: c.roll0 + t * c.rollSpd, scale, flash, vel: 0, s: 0 };
  }
  const tau = t - c.launchT;
  const s = sAt(tau, o.speed, o.accel);
  if (s > c.pathLen + o.speed * o.passLife) return { phase: 'gone' };
  const pos = pathPos(c, s);
  const vel = o.speed * (1 - Math.exp(-tau / o.accel));
  return { phase: 'fly', pos, dir: pathTan(c, s), roll: c.roll0 + c.launchT * c.rollSpd + spinAngle(c.flySpin, 0.6, tau), scale, flash, vel, s, tau };
}

function cocBlur(S, z, dof) {
  if (!dof) return 0;
  const dz = z - S.cam.z;
  if (dz <= 0.05) return 0;
  const coc = (dof.aperture == null ? 0.035 : dof.aperture) * S.cam.focal * Math.abs(1 / dz - 1 / (dof.focus || 10));
  return Math.min(dof.max || 28, coc < 0.9 ? 0 : coc);
}
// keep crystals from collapsing into an end-on "candy" silhouette when they point at the lens
function antiEndOn(S, pos, d) {
  const view = V.norm(V.sub(pos, { x: S.cam.x, y: S.cam.y, z: S.cam.z }));
  const dv = V.dot(d, view);
  const k = smoothstep(0.7, 0.95, Math.abs(dv));
  if (k <= 0) return d;
  let perp = V.madd(d, view, -dv);
  if (V.len(perp) < 1e-3) perp = { x: 1, y: 0, z: 0 };
  return nlerp(d, V.norm(perp), 0.42 * k);
}

// fragments of one crystal (cached): two big chunks (front/back halves) + many small slivers of power-law size,
// laid out inside the parent volume and aligned with it so the first frame still reads as "this crystal split"
function fragsOf(c, n) {
  if (c._frags && c._frags.length === n) return c._frags;
  const rng = new RNG(c.seed * 13 + 5);
  const fr = [];
  for (let j = 0; j < n; j++) {
    const big = j < 2;
    const off = big ? { x: j === 0 ? 0.2 : -0.2, y: rng.range(-0.3, 0.3) * c.geom.rad, z: rng.range(-0.3, 0.3) * c.geom.rad }
      : { x: rng.range(-0.42, 0.42), y: rng.range(-1, 1) * c.geom.rad * 0.6, z: rng.range(-1, 1) * c.geom.rad * 0.6 };
    fr.push({
      geom: big ? gemGeometry(c.seed * 37 + j, { sides: 5, body: 0.42, chisel: true, front: 0.32, rad: 0.17 }) : shardGeometry(c.seed * 37 + j), off, size: big ? rng.range(0.5, 0.65) : 0.07 + 0.45 * Math.pow(rng.next(), 2.5),
      out: randDir(rng), burst: rng.range(1.6, 5.2) * (big ? 0.45 : 1), k0: randDir(rng), a0: rng.range(-0.3, 0.3) + (j === 1 ? Math.PI : 0), ks: randDir(rng), w: rng.range(5, 16) * rng.sign() * (big ? 0.4 : 1),
      life: rng.range(0.75, 1.5) * (big ? 1.3 : 1), seed: c.seed * 50 + j, width: big ? rng.range(1.2, 1.6) : rng.range(0.7, 1.3), big,
    });
  }
  c._frags = fr;
  return fr;
}

// fragment set (shared by shatter + shield). Pushes depth-sortable items.
function fragItems(S, items, frags, base, o) {
  // base: { pos, vel:{x,y,z}, B (basis), L, t0 }
  const t = o.t;
  const tau = (t - base.t0) * (o.slowmo || 1);
  if (tau < 0) return;
  const grav = o.gravity == null ? 3.5 : o.gravity, drag = o.drag == null ? 1.2 : o.drag;
  for (const f of frags) {
    if (tau > f.life * (o.lifeK || 1)) continue;
    const lf = tau / (f.life * (o.lifeK || 1));
    const offW = V.add(V.add(V.scale(base.B.d, f.off.x * base.L), V.scale(base.B.u, f.off.y * base.L)), V.scale(base.B.w, f.off.z * base.L));
    const p0 = V.add(base.pos, offW);
    const v0 = V.add(V.scale(base.vel, o.inherit == null ? 0.45 : o.inherit), V.scale(V.norm(V.add(V.scale(f.out, 0.8), V.scale(V.norm(offW), 0.6))), f.burst * (o.burst == null ? 1 : o.burst)));
    const p = ballistic(p0, v0, grav, drag, tau);
    const th = spinAngle(f.w * (o.spin == null ? 1 : o.spin), 0.5, tau);
    const d = rotAxis(rotAxis(base.B.d, f.k0, f.a0), f.ks, th);
    const u = rotAxis(rotAxis(base.B.u, f.k0, f.a0), f.ks, th);
    const B = { d, u, w: V.cross(d, u) };
    const sz = base.L * f.size * (1 - smoothstep(0.7, 1, lf));
    // smear from 2 frames back while the piece is fast (> 0.4 of its size per frame)
    const vv = ballisticVel(v0, grav, drag, tau);
    const spf = V.len(vv) / 60;
    const smear = spf > 0.4 * sz && tau > 0.004 ? ballistic(p0, v0, grav, drag, Math.max(0, tau - 1 / 30)) : null;
    items.push({ z: p.z, kind: 'frag', f, p, B, L: sz, a: 1 - smoothstep(0.8, 1, lf), lf, smear, smearK: clamp((spf / Math.max(1e-4, sz) - 0.4) * 1.5) });
  }
}
function drawSmear(S, it, GP, A) {
  const q0 = S.cam.project(it.smear.x, it.smear.y, it.smear.z), q1 = S.cam.project(it.p.x, it.p.y, it.p.z);
  if (!q0 || !q1) return;
  const em = S.L.emit;
  const w = clamp(it.L * q1.s * 0.35, 1, 18);
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
  em.globalAlpha = A * it.a * 0.35 * it.smearK; em.fillStyle = rgba(GP.mid);
  em.beginPath(); streak(em, q0.x, q0.y, q1.x, q1.y, w); em.fill();
  em.globalAlpha = A * it.a * 0.6 * it.smearK; em.fillStyle = rgba(GP.hot);
  em.beginPath(); streak(em, lerp(q0.x, q1.x, 0.4), lerp(q0.y, q1.y, 0.4), q1.x, q1.y, Math.max(1, w * 0.3)); em.fill();
  em.restore();
}

// drawCrystals(S, swarm, { t=S.t, formT0=0, formDur=0.7, growDur=0.24, converge=0.32, launchT0=1.2, stagger=0.5, speed=24,
//   accel=0.07, antic=0.22, passLife=2, shatterAt=null|(c)=>time|null, zMin, zMax, glow=1, alpha=1, streak=1, tip=1,
//   dof=null|{focus,aperture=0.035,max=28}, palette='crimson', gather=1, sparks=1, shardCount=null (10..28 auto),
//   shardGravity=3.5, crackFrames=2 (pre-shatter crack-up frames at 24 fps; 0 = off), endOn=1 (anti end-on tilt) })
export function drawCrystals(S, swarm, oo = {}) {
  const o = fillOpts(oo);
  const t = o.t == null ? S.t : o.t;
  o.t = t;
  const tb = boil(t);
  const zMin = o.zMin == null ? -Infinity : o.zMin, zMax = o.zMax == null ? Infinity : o.zMax;
  const A = o.alpha == null ? 1 : o.alpha;
  const glow = o.glow == null ? 1 : o.glow;
  const streakK = o.streak == null ? 1 : o.streak;
  const crackFrames = o.crackFrames == null ? 2 : o.crackFrames;
  const G = gemPal(o.palette);
  const GP = G.glow;
  const cam = S.cam;
  const items = [];
  const em = S.L.emit;
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
  for (const c of swarm.crystals) {
    timing(c, o); c._o = o;
    const ts = o.shatterAt ? o.shatterAt(c) : null;
    if (ts != null && t >= ts) {
      const st0 = crystalState(c, ts, o);
      if (st0.phase === 'pre' || st0.phase === 'gone') continue;
      const B = basis(o.endOn === 0 ? st0.dir : antiEndOn(S, st0.pos, st0.dir), st0.roll);
      const L = c.L * st0.scale;
      const n = o.shardCount || Math.round(clamp(10 + c.L / 0.05, 10, 28));
      fragItems(S, items, fragsOf(c, n), { pos: st0.pos, vel: V.scale(st0.dir, st0.vel), B, L, t0: ts }, { t, gravity: o.shardGravity, drag: 1.4, inherit: 0.4 });
      const dt = t - ts, dtq = q24(dt);
      if (st0.pos.z >= zMin && st0.pos.z < zMax) {
        // jagged pop (2 frames solid, 2 frames outline, snapped to 24 fps) + one small star + burst spikes
        const q = cam.project(st0.pos.x, st0.pos.y, st0.pos.z);
        if (q && dt < 0.4) {
          const Rpx = Math.min(150, L * q.s * 0.6);
          const tbq = Math.floor(dt * 24);
          if (dtq < 2 / 24) burstFlash(em, q.x, q.y, Rpx * (0.8 + 0.25 * tbq), { color: GP, alpha: A, seed: c.seed, tb: tbq, spikes: 9 });
          else if (dtq < 4 / 24) burstFlash(em, q.x, q.y, Rpx * (1.05 + 0.2 * (tbq - 2)), { color: GP, alpha: A * (tbq === 2 ? 1 : 0.6), seed: c.seed, tb: tbq, spikes: 9, mode: 'line' });
          const ks = 1 - dtq / 0.25;
          if (ks > 0) drawStar(em, q.x, q.y, Math.min(44, L * q.s * 0.4) * ks, { color: GP, alpha: A * ks, rot: hash1(c.seed) * 0.8, aspect: 1.3, diag: 0.3 });
          shatterBurst(em, q, L * q.s, dtq, c.seed, GP, A);
        }
        if (dt < 1.6) {
          drawParticles(S, { kind: 'glitter', seed: c.seed, origin: st0.pos, t, t0: ts, count: 8, spread: L * 0.3, speed: 2.4, gravity: 1.5, drag: 1.6, life: 1.1, size: L * 0.16, color: GP, alpha: A, maxPx: 26 });
          drawParticles(S, { kind: 'sparks', seed: c.seed + 7, origin: st0.pos, t, t0: ts, count: 10, speed: 6.5, life: 0.28, size: L * 0.035, tail: 0.04, color: GP, alpha: A, dir: st0.vel > 1 ? st0.dir : null, cone: 1.3 });
        }
      }
      continue;
    }
    const st = crystalState(c, t, o);
    if (st.phase === 'gone') continue;
    if (st.phase === 'pre') {
      if (st.k > 0 && o.sparks !== 0) items.push({ z: c.slot.z, kind: 'conv', c, k: st.k });
      continue;
    }
    // crack-up frames just before the break
    let crack = 0;
    if (ts != null && crackFrames > 0 && t >= ts - crackFrames / 24) crack = t >= ts - 1 / 24 ? 2 : 1;
    items.push({ z: st.pos.z, kind: 'gem', c, st, crack });
  }
  em.restore();
  // gather glow at the origin while forming
  const gather = o.gather == null ? 1 : o.gather;
  if (gather > 0 && swarm.origin.z >= zMin && swarm.origin.z < zMax) {
    const gk = smoothstep(o.formT0 - 0.15, o.formT0 + 0.1, t) * (1 - smoothstep(o.launchT0 + o.stagger * 0.6, o.launchT0 + o.stagger + 0.2, t));
    const q = cam.project(swarm.origin.x, swarm.origin.y, swarm.origin.z);
    if (gk > 0.01 && q) {
      em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
      const tw = 0.8 + 0.2 * hash1(Math.floor(tb / 2) * 1.7);
      glowDot(em, q.x, q.y, 0.04 * q.s * tw, GP, A * gk * gather * 0.6);
      drawStar(em, q.x, q.y, Math.min(70, 0.3 * q.s * tw), { color: GP, alpha: A * gk * gather * 0.5, rot: 0.15 + hash1(Math.floor(tb / 2)) * 0.1, aspect: 1.5, diag: 0.3 });
      em.restore();
    }
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    if (it.z < zMin || it.z >= zMax) continue;
    if (it.kind === 'gem') {
      const { c, st } = it;
      const dir = o.endOn === 0 ? st.dir : antiEndOn(S, st.pos, st.dir);
      const B = basis(dir, st.roll);
      const L = c.L * st.scale;
      if (L < 0.005) continue;
      const blur = cocBlur(S, st.pos.z, o.dof);
      let trail = null;
      if (st.phase === 'fly' && streakK > 0 && st.vel > 2) {
        const len = st.vel * 0.11 * streakK;
        const s0 = st.s - L * 0.5; // trail starts at the tail vertex so it never washes the facets out
        const pts = [];
        for (let k = 0; k <= 9; k++) {
          const s = s0 - (len * k) / 9;
          const p = s <= 0 ? V.madd(c.ctl[0], c.tan0, s) : pathPos(c, s);
          const q = cam.project(p.x, p.y, p.z);
          if (!q) break;
          pts.push(q);
        }
        const q0 = cam.project(st.pos.x, st.pos.y, st.pos.z);
        if (q0 && pts.length > 1) trail = { pts, w: c.geom.rad * c.width * L * q0.s * 0.7, k: clamp(st.vel / 12) * (blur > 8 ? 0.3 : 1) };
      }
      drawGem(S, c.geom, st.pos, B, L, {
        pal: G, glow, alpha: A, flash: st.flash, tb, seed: c.seed, width: c.width,
        tip: st.phase === 'fly' ? 0.7 * (o.tip == null ? 1 : o.tip) : 0.35 * (o.tip == null ? 1 : o.tip),
        streak: trail, blur, crack: it.crack,
      });
    } else if (it.kind === 'frag') {
      if (it.smear && it.smearK > 0.01) drawSmear(S, it, GP, A);
      drawGem(S, it.f.geom, it.p, it.B, it.L, { pal: G, glow: glow * (it.f.big ? 0.6 : 0.38), alpha: A * it.a, tb, seed: it.f.seed, width: it.f.width, sparkle: it.f.big ? 1 : 0, blur: cocBlur(S, it.p.z, o.dof), frontA: 0.95, planes: 0, mottle: it.f.big ? 1 : 0, bokehMax: it.f.big ? 3 : 1 });
    } else if (it.kind === 'conv') {
      drawConverge(S, it.c, it.k, GP, A, tb);
    }
  }
}

// short radial burst spikes when a crystal breaks (dt snapped to 24 fps)
function shatterBurst(em, q, Lpx, dt, seed, GP, A) {
  const life = 0.17;
  if (dt > life) return;
  const k = 1 - dt / life;
  const tb = Math.floor(dt * 24 + 1e-6);
  const n = 7;
  const R = Math.min(150, Lpx * 0.8);
  for (let i = 0; i < n; i++) {
    const a = (i + hash2(seed + i, tb) * 0.8) / n * TAU;
    const r0 = R * (0.3 + 0.55 * (1 - k)), r1 = r0 + R * (0.35 + 0.6 * hash2(seed * 1.7 + i, tb)) * k;
    const w = Math.max(1, R * 0.045 * k);
    em.globalAlpha = A * k * 0.7;
    em.fillStyle = rgba(GP.mid);
    em.beginPath(); streak(em, q.x + Math.cos(a) * r0, q.y + Math.sin(a) * r0, q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1, w * 2); em.fill();
    em.fillStyle = rgba(GP.core);
    em.beginPath(); streak(em, q.x + Math.cos(a) * r0, q.y + Math.sin(a) * r0, q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1, w * 0.7); em.fill();
  }
  em.globalAlpha = 1;
}

// sparks converging into a crystal slot just before it materialises
function drawConverge(S, c, k, GP, A, tb) {
  const em = S.L.emit, cam = S.cam;
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
  const rng = new RNG(c.seed * 3 + 11);
  const q0 = cam.project(c.slot.x, c.slot.y, c.slot.z);
  if (!q0) { em.restore(); return; }
  for (let j = 0; j < 6; j++) {
    const d = randDir(rng), R = c.L * rng.range(1.0, 2.2);
    const st = V.madd(c.slot, d, R);
    const e = (x) => { const u = clamp(x); return u * u; };
    const a = V.lerp(st, c.slot, e(k)), b = V.lerp(st, c.slot, e(k - 0.22));
    const qa = cam.project(a.x, a.y, a.z), qb = cam.project(b.x, b.y, b.z);
    if (!qa || !qb) continue;
    const w = Math.max(0.8, c.L * 0.04 * qa.s);
    em.globalAlpha = A * clamp(k * 2) * 0.8;
    em.fillStyle = rgba(GP.hot);
    em.beginPath(); streak(em, qb.x, qb.y, qa.x, qa.y, w); em.fill();
    em.fillStyle = rgba(GP.core);
    em.beginPath(); streak(em, lerp(qb.x, qa.x, 0.5), lerp(qb.y, qa.y, 0.5), qa.x, qa.y, w * 0.45); em.fill();
  }
  speck(em, q0.x, q0.y, Math.max(0.8, Math.min(4, c.L * 0.05 * q0.s * k)), GP, A * k);
  em.restore();
}

// ------------------------------------------------------------------ free shards
// drawShards(S, { seed=1, origin, t=S.t, t0=0, count=40, spread=0.5, speed=6, dir=null, cone=0.7, gravity=2.5, drag=0.8,
//   slowmo=1, size=0.22 (median-ish; power-law 0.25..2.25 × size), sizeVar=null (number → old uniform ±sizeVar), life=3,
//   palette='crimson'|'ice'|'amethyst'|'prism', inherit:{x,y,z}, spin=1, spinDrag=0.35, glitter=1, flash=1, box=null,
//   zMin, zMax, dof, alpha=1, glow=1 })
export function drawShards(S, o = {}) {
  const t = o.t == null ? S.t : o.t, t0 = o.t0 || 0;
  const slow = o.slowmo == null ? 1 : o.slowmo;
  const tau = (t - t0) * slow;
  if (tau < 0) return;
  const seed = o.seed == null ? 1 : o.seed;
  const count = o.count == null ? 40 : o.count;
  const origin = o.origin || { x: 0, y: -1, z: 0 };
  const spread = o.spread == null ? 0.5 : o.spread;
  const speed = o.speed == null ? 6 : o.speed;
  const size = o.size == null ? 0.22 : o.size, sizeVar = o.sizeVar;
  const life = o.life == null ? 3 : o.life;
  const grav = o.gravity == null ? 2.5 : o.gravity, drag = o.drag == null ? 0.8 : o.drag;
  const prism = o.palette === 'prism';
  const G = gemPal(prism ? 'crimson' : o.palette);
  const GP = prism ? PAL.white : G.glow;
  const zMin = o.zMin == null ? -Infinity : o.zMin, zMax = o.zMax == null ? Infinity : o.zMax;
  const A = o.alpha == null ? 1 : o.alpha, glow = o.glow == null ? 1 : o.glow;
  const inh = o.inherit || { x: 0, y: 0, z: 0 };
  const dirN = o.dir ? V.norm(o.dir) : null;
  const cam = S.cam, tb = boil(t);
  const items = [];
  for (let i = 0; i < count; i++) {
    const rng = new RNG(seed * 7717 + i * 131);
    const lifeI = life * rng.range(0.6, 1.2);
    if (tau > lifeI) continue;
    const lf = tau / lifeI;
    let p0;
    if (o.box) { const b = o.box; p0 = { x: rng.range(b.x0, b.x1), y: rng.range(b.y0, b.y1), z: rng.range(b.z0, b.z1) }; }
    else p0 = V.madd(origin, randDir(rng), spread * Math.cbrt(rng.next()));
    const d = dirN ? coneDir(rng, dirN, o.cone == null ? 0.7 : o.cone) : randDir(rng);
    const v0 = V.add(inh, V.scale(d, speed * rng.range(0.3, 1.2)));
    const p = ballistic(p0, v0, grav, drag, tau);
    const k0 = randDir(rng), ks = randDir(rng);
    const th = spinAngle(rng.range(2, 9) * rng.sign() * (o.spin == null ? 1 : o.spin), o.spinDrag == null ? 0.35 : o.spinDrag, tau) + rng.range(0, TAU);
    const d0 = rotAxis({ x: 1, y: 0, z: 0 }, k0, rng.range(0, TAU)), u0 = rotAxis({ x: 0, y: 1, z: 0 }, k0, rng.range(0, TAU));
    const sr = rng.range(-1, 1), wd = rng.range(0.6, 1.2), hue = rng.next();
    if (p.z < zMin || p.z >= zMax) continue;
    const dd = rotAxis(d0, ks, th);
    let uu = rotAxis(u0, ks, th); uu = V.norm(V.madd(uu, dd, -V.dot(uu, dd)));
    const sK = sizeVar != null ? 1 + sizeVar * sr : 0.25 + 2.0 * Math.pow((sr + 1) * 0.5, 2.6);
    const L = size * sK * (1 - smoothstep(0.8, 1, lf));
    items.push({ z: p.z, p, B: { d: dd, u: uu, w: V.cross(dd, uu) }, L, a: smoothstep(0, 0.04, lf + (o.box ? 1 : 0)) * (1 - smoothstep(0.75, 1, lf)), geom: shardGeometry(seed * 101 + i), seed: seed * 300 + i, width: wd, hue });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    drawGem(S, it.geom, it.p, it.B, it.L, { pal: G, glow: glow * (prism ? 0.6 : 0.4), alpha: A * it.a, tb, seed: it.seed, width: it.width, sparkle: 0, prism, hueT: it.hue + t * 0.15, blur: cocBlur(S, it.p.z, o.dof), frontA: prism ? 0.55 : 0.95, planes: 0, mottle: it.L > 0.3 ? 0.6 : 0, bokehMax: 1 });
  }
  // jagged pop at the origin (snapped to 24 fps)
  if (!o.box && (o.flash == null || o.flash > 0)) {
    const q = cam.project(origin.x, origin.y, origin.z);
    const dq = q24(tau / slow) * slow;
    const fk = o.flash == null ? 1 : o.flash;
    if (q && origin.z >= zMin && origin.z < zMax && dq < 5 / 24) {
      const em = S.L.emit; em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
      const Rpx = Math.min(300, (spread * 0.8 + size * 2.5) * q.s);
      const f = Math.round(dq * 24);
      if (f < 2) burstFlash(em, q.x, q.y, Rpx * (0.8 + 0.3 * f), { color: GP, alpha: A * fk, seed, tb: f, spikes: 11 });
      else burstFlash(em, q.x, q.y, Rpx * (1.1 + 0.25 * (f - 2)), { color: GP, alpha: A * fk * (1 - (f - 2) / 3), seed, tb: f, spikes: 11, mode: 'line' });
      const ks = 1 - dq / 0.22;
      if (ks > 0) drawStar(em, q.x, q.y, Math.min(60, Rpx * 0.4) * ks, { color: GP, alpha: A * fk * ks, aspect: 1.5, rot: hash1(seed) * 0.4, diag: 0.3 });
      em.restore();
    }
  }
  if (o.glitter == null || o.glitter > 0) {
    drawParticles(S, { kind: 'glitter', seed: seed + 55, origin, box: o.box, t, t0, slowmo: slow, count: Math.round(count * 0.8 * (o.glitter || 1)), spread: spread + 0.4, speed: speed * 0.5, gravity: grav * 0.5, drag: drag + 0.5, life: life * 0.9, size: size * 0.6, color: prism ? 'prism' : GP, alpha: A, zMin, zMax, maxPx: 30 });
  }
}

// ------------------------------------------------------------------ energy ribbons (ref1)
// Broad, nearly opaque crimson bands sweeping around the casting axis in a funnel, a hard cel split
// (bright half / dark half), one white-hot leading edge, a dim trailing edge, small riding glints.
// Band width is steered toward the view so bands stay broad on screen. Quads are depth-filtered
// individually so ribbons can wrap *around* a character (call twice with zMin/zMax).
// drawCrystalRibbons(S, { origin, target|dir, t=S.t, t0=0, grow=0.35 (s), k=1 (intensity/fade), count=8, length=3.2,
//   radius=0.55, spreadR=1.6 (radius at the far end), turns=0.9, width=0.55, spin=3 (rad/s), seed=1, color='red',
//   palette, zMin, zMax, segs=64, face=0.6 (0..1 how much band width turns toward the camera) })
export function drawCrystalRibbons(S, o = {}) {
  const t = o.t == null ? S.t : o.t, t0 = o.t0 || 0;
  const k = o.k == null ? 1 : o.k;
  if (t < t0 || k <= 0.005) return;
  const origin = o.origin || { x: 4, y: -1.3, z: 0 };
  const dir = V.norm(o.dir || V.sub(o.target || { x: -4, y: -1, z: 0 }, origin));
  const count = o.count == null ? 6 : o.count, len = o.length == null ? 3.2 : o.length;
  const r0 = o.radius == null ? 0.55 : o.radius, r1 = o.spreadR == null ? 1.6 : o.spreadR;
  const turns = o.turns == null ? 0.7 : o.turns, wid = o.width == null ? 0.5 : o.width, spin = o.spin == null ? 3 : o.spin;
  const face = o.face == null ? 0.6 : o.face;
  const hand = o.hand == null ? 1 : o.hand;
  const segs = o.segs || 64, seed = o.seed == null ? 1 : o.seed;
  const grow = clamp((t - t0) / (o.grow == null ? 0.35 : o.grow));
  const P = pal(o.color || 'red');
  const G = gemPal(o.palette);
  const zMin = o.zMin == null ? -Infinity : o.zMin, zMax = o.zMax == null ? Infinity : o.zMax;
  const cam = S.cam, sc = S.L.scene, em = S.L.emit, tb = boil(t);
  const camP = { x: cam.x, y: cam.y, z: cam.z };
  const ref = Math.abs(dir.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u0 = V.norm(V.cross(dir, ref)), w0 = V.cross(dir, u0);
  sc.save(); em.save();
  sc.setTransform(1, 0, 0, 1, 0, 0); em.setTransform(1, 0, 0, 1, 0, 0);
  em.globalCompositeOperation = 'lighter';
  sc.lineJoin = em.lineJoin = 'round'; sc.lineCap = em.lineCap = 'round';
  for (let r = 0; r < count; r++) {
    const rng = new RNG(seed * 97 + r * 13);
    // one coherent helical funnel: evenly spaced phases, one handedness, gentle size variation
    const ph = (r / count) * TAU + rng.range(-0.25, 0.25);
    const tr = turns * rng.range(0.8, 1.2) * hand;
    const rr = rng.range(0.8, 1.15), ww = wid * rng.range(0.7, 1.3);
    const sp = spin * rng.range(0.85, 1.15) * hand;
    const off = rng.range(-0.1, 0.1);
    const lenR = len * rng.range(0.7, 1.1);
    const sEnd = grow * rng.range(0.85, 1.0), sStart = Math.max(0, sEnd - rng.range(0.5, 0.8));
    if (sEnd - sStart < 0.02) continue;
    const centre = (s) => {
      const th = ph + tr * TAU * s - sp * (t - t0);
      const rad = lerp(r0, r1, Math.pow(s, 1.3)) * rr * (1 + 0.08 * Math.sin(s * 9 + r));
      const radial = V.add(V.scale(u0, Math.cos(th)), V.scale(w0, Math.sin(th)));
      return { c: V.add(V.madd(origin, dir, s * lenR + off), V.scale(radial, rad)), radial };
    };
    const A = [], Bv = [], M = [], D = [];
    let prevV = null, prevW = null;
    const ds = (sEnd - sStart) / segs;
    for (let i = 0; i <= segs; i++) {
      const s = lerp(sStart, sEnd, i / segs);
      const { c, radial } = centre(s);
      const cn = centre(s + ds * 0.5).c, cp = centre(s - ds * 0.5).c;
      const tan = V.norm(V.sub(cn, cp));
      // band lies (mostly) on the funnel surface; a slow small twist keeps it alive without going edge-on
      const tw = 0.22 + 0.18 * Math.sin(s * 5 + r * 1.7 + (t - t0) * 2.2);
      const wdT = V.add(V.scale(dir, Math.cos(tw)), V.scale(radial, Math.sin(tw)));
      let wdV = V.norm(V.cross(tan, V.norm(V.sub(c, camP))));
      // keep the view-facing width direction continuous along the band (no sign flips → no Z kinks)
      if (V.dot(wdV, prevV || wdT) < 0) wdV = V.scale(wdV, -1);
      prevV = wdV;
      let wd = V.norm(V.lerp(wdT, wdV, face));
      if (prevW && V.dot(wd, prevW) < 0) wd = V.scale(wd, -1);
      prevW = wd;
      const taper = Math.pow(Math.sin(Math.PI * clamp((s - sStart) / (sEnd - sStart))), 0.6);
      const hw = ww * 0.5 * taper * (0.6 + 0.6 * s);
      const pa = V.madd(c, wd, hw), pb = V.madd(c, wd, -hw);
      A.push(cam.project(pa.x, pa.y, pa.z)); Bv.push(cam.project(pb.x, pb.y, pb.z)); M.push(cam.project(c.x, c.y, c.z));
      D.push({ z: c.z, back: radial.z, s });
    }
    // body: 3 strips across the width fading from the leading edge (bright, opaque) to the trailing edge
    // (dark, thin) = the anime "swoosh" read; back half dimmer/deeper. Each quad is wound consistently so
    // a folded band unions instead of cancelling.
    const strips = [[0, 0.22, G.bright, 0.96, 0.34], [0.22, 0.56, G.body, 0.84, 0.18], [0.56, 1, mixColor(G.body, G.dark, 0.5), 0.5, 0.08]];
    for (let pass = 0; pass < 2; pass++) {
      const back = pass === 0;
      for (const [f0, f1, col, sa, ea] of strips) {
        sc.beginPath(); em.beginPath();
        let any = false;
        for (let i = 0; i < segs; i++) {
          const a0 = A[i], a1 = A[i + 1], b0 = Bv[i], b1 = Bv[i + 1];
          if (!a0 || !a1 || !b0 || !b1) continue;
          const zc = (D[i].z + D[i + 1].z) / 2;
          if (zc < zMin || zc >= zMax) continue;
          if ((D[i].back > 0) !== back) continue;
          const q = [lerpP(a0, b0, f0), lerpP(a1, b1, f0), lerpP(a1, b1, f1), lerpP(a0, b0, f1)];
          const ar = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[1].y - q[0].y) * (q[2].x - q[0].x) + (q[2].x - q[0].x) * (q[3].y - q[0].y) - (q[2].y - q[0].y) * (q[3].x - q[0].x);
          if (ar < 0) q.reverse();
          sc.moveTo(q[0].x, q[0].y); sc.lineTo(q[1].x, q[1].y); sc.lineTo(q[2].x, q[2].y); sc.lineTo(q[3].x, q[3].y); sc.closePath();
          em.moveTo(q[0].x, q[0].y); em.lineTo(q[1].x, q[1].y); em.lineTo(q[2].x, q[2].y); em.lineTo(q[3].x, q[3].y); em.closePath();
          any = true;
        }
        if (!any) continue;
        // back half: translucent energy (dim red glow over a light dark veil), not grey smoke
        sc.globalAlpha = k * sa * (back ? 0.28 : 1); sc.fillStyle = rgba(back ? G.dark : col); sc.fill();
        em.globalAlpha = k * ea * (back ? 0.9 : 1); em.fillStyle = rgba(back ? P.deep : P.mid); em.fill();
      }
    }
    // edges: only the leading edge burns white-hot (front half); the back half keeps a dim hot line
    const qm = M[segs >> 1] || A[segs >> 1];
    const lwp = qm ? clamp(ww * qm.s * 0.05, 0.9, 4) : 1.5;
    for (let pass = 0; pass < 2; pass++) {
      em.beginPath();
      let pen = false;
      for (let i = 0; i <= segs; i++) {
        const p = A[i];
        const ok = p && D[i].z >= zMin && D[i].z < zMax && ((D[i].back > 0) === (pass === 0));
        if (!ok) { pen = false; continue; }
        if (!pen) { em.moveTo(p.x, p.y); pen = true; } else em.lineTo(p.x, p.y);
      }
      const back = pass === 0;
      em.globalAlpha = k * (back ? 0.22 : 0.7); em.strokeStyle = rgba(P.hot); em.lineWidth = lwp * 1.6; em.stroke();
      if (!back) { em.globalAlpha = k * 0.95; em.strokeStyle = rgba(P.core); em.lineWidth = lwp * 0.55; em.stroke(); }
    }
    // small crisp glints riding the band (boil on twos)
    const tb2 = Math.floor(tb / 2);
    for (let j = 0; j < 7; j++) {
      const i = Math.floor(hash3(r, j, tb2) * segs);
      const a = A[i], b = Bv[i], d = D[i];
      if (!a || !b || d.z < zMin || d.z >= zMax || d.back > 0.3) continue;
      const h = hash3(j, r, tb2 * 1.3);
      if (h < 0.35) continue;
      const p = lerpP(a, b, hash3(r, j * 1.7, tb2) * 0.6);
      speck(em, p.x, p.y, 1 + 1.5 * h, P, k * h);
    }
  }
  sc.restore(); em.restore();
}

// ------------------------------------------------------------------ crystal shield (optional)
// Hexagonal crystal barrier: flat glassy hex plates tile into one membrane growing from the centre out; a band
// of light sweeps across it; then a cut line slices it: a wide band of cells bursts into shards, the two halves
// slide apart, tilt and drop, with a hot cut edge and a 24 fps-held blue cut flash.
// drawCrystalShield(S, { x, y, z, t=S.t, t0=0 (formation start), form=0.45 (s), radius=1.3, cell=0.34, normal={x:-1,y:0,z:-0.45},
//   cut: null | { t0, angle=0.5 (rad, in the shield plane), sweep=0.08 (s), sep=2.4 (m/s), gravity=6 }, palette='crimson',
//   alpha=1, glow=1, seed=1, zMin, zMax, sweepSpeed=1.6 (light band, m/s; 0 = off) })
let HEX = null;
function hexGeom() {
  if (HEX) return HEX;
  // flat hexagonal glass plate: one front face, one back face, thin sides (no pyramid spokes)
  const v = [];
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; v.push({ x: 0.035, y: Math.cos(a) * 0.5, z: Math.sin(a) * 0.5 }); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; v.push({ x: -0.035, y: Math.cos(a) * 0.49, z: Math.sin(a) * 0.49 }); }
  const f = [[0, 1, 2, 3, 4, 5], [11, 10, 9, 8, 7, 6]];
  for (let k = 0; k < 6; k++) f.push([k, 6 + k, 6 + ((k + 1) % 6), (k + 1) % 6]);
  HEX = finalizeGeom(v, f, { rad: 0.5, x1: 0, kinds: f.map(() => 0), n: 6 });
  return HEX;
}
export function drawCrystalShield(S, o = {}) {
  const t = o.t == null ? S.t : o.t, t0 = o.t0 || 0;
  if (t < t0) return;
  const C0 = { x: o.x == null ? 3 : o.x, y: o.y == null ? -1.2 : o.y, z: o.z || 0 };
  const R = o.radius == null ? 1.3 : o.radius, cs = o.cell == null ? 0.34 : o.cell;
  const nrm = V.norm(o.normal || { x: -1, y: 0, z: -0.45 });
  const form = o.form == null ? 0.45 : o.form;
  const A = o.alpha == null ? 1 : o.alpha, glow = o.glow == null ? 1 : o.glow;
  const seed = o.seed == null ? 1 : o.seed;
  const zMin = o.zMin == null ? -Infinity : o.zMin, zMax = o.zMax == null ? Infinity : o.zMax;
  const G = gemPal(o.palette);
  const GP = G.glow;
  const cam = S.cam, tb = boil(t), em = S.L.emit;
  const ref = Math.abs(nrm.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
  const pu = V.norm(V.cross(nrm, ref)), pw = V.cross(nrm, pu);
  const geom = hexGeom();
  const cut = o.cut || null;
  const ca = cut ? (cut.angle == null ? 0.5 : cut.angle) : 0;
  const lu = Math.cos(ca), lw2 = Math.sin(ca);
  const sweepV = o.sweepSpeed == null ? 1.6 : o.sweepSpeed;
  const items = [];
  const step = cs * 0.5;
  const n = Math.ceil(R / (step * 1.5)) + 1;
  for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
    // pointy-top axial hex layout (cell circumradius = step)
    const cu = step * Math.sqrt(3) * (q + r / 2), cw = step * 1.5 * r;
    const d = Math.hypot(cu, cw);
    if (d > R) continue;
    const id = (q + 50) * 131 + (r + 50);
    const tf = t0 + (d / R) * form * 0.8 + hash2(id, seed) * form * 0.2;
    if (t < tf) continue;
    const g = clamp((t - tf) / 0.16);
    const scl = g < 1 ? Math.max(0, E.outBack(g, 2.6)) : 1;
    let pos = V.add(C0, V.add(V.scale(pu, cu), V.scale(pw, cw)));
    pos = V.madd(pos, nrm, -0.12 * (d / R) * (d / R)); // slight dome toward the viewer side
    let B = { d: nrm, u: pu, w: pw }, a = A * (0.55 + 0.35 * hash2(id, seed + 3.3)), flash = pulse(Math.max(tf, q24(t)), tf, 0.02, 0.1) * 0.8;
    // light band sweeping across the plate
    let sw = 0;
    if (sweepV > 0) {
      const sweepPos = -R * 1.3 + ((t - t0) * sweepV) % (R * 3.2);
      const along0 = cu * 0.8 + cw * 0.6;
      sw = Math.exp(-Math.pow((along0 - sweepPos) / 0.35, 2));
      flash = Math.max(flash, sw * 0.35);
    }
    if (cut && t >= cut.t0) {
      const side = cu * -lw2 + cw * lu;      // signed distance to the cut line
      const along = cu * lu + cw * lw2;
      const tc = cut.t0 + (along + R) / (2 * R) * (cut.sweep == null ? 0.08 : cut.sweep);
      if (t >= tc) {
        const dt = t - tc;
        if (Math.abs(side) < cs * 1.1) {
          const fr = fragsOf(cellCrystal(seed, id, cs), 10);
          fragItems(S, items, fr, { pos, vel: V.scale(nrm, 2), B, L: cs * 1.1, t0: tc }, { t, gravity: 5, drag: 1.2, inherit: 0.5, burst: 0.9 });
          continue;
        }
        const sgn = side > 0 ? 1 : -1;
        const perp = V.norm(V.add(V.scale(pu, -lw2 * sgn), V.scale(pw, lu * sgn)));
        const sep = cut.sep == null ? 2.4 : cut.sep;
        // each half moves as one rigid plate: rotate about the half's pivot (near its centroid), then slide + drop
        const pivot = V.madd(C0, perp, R * 0.42);
        const rot = sgn * dt * 1.8;
        const ax = V.norm(V.cross(nrm, perp));
        pos = V.add(pivot, rotAxis(V.sub(pos, pivot), ax, rot));
        pos = V.madd(pos, perp, sep * dt * Math.exp(-dt * 0.6));
        pos = { x: pos.x, y: pos.y + 0.5 * (cut.gravity == null ? 6 : cut.gravity) * dt * dt, z: pos.z };
        B = { d: rotAxis(nrm, ax, rot), u: rotAxis(pu, ax, rot), w: rotAxis(pw, ax, rot) };
        a *= 1 - smoothstep(0.5, 1.4, dt);
        flash = Math.max(flash, pulse(Math.max(tc, q24(t)), tc, 0.02, 0.12) * 0.6 * Math.exp(-Math.abs(side) / (cs * 2)));
        // the cells right at the cut keep a hot edge for 0.3 s
      }
    }
    if (a <= 0.01) continue;
    items.push({ z: pos.z, kind: 'cell', pos, B, L: cs * 1.02 * scl, a, flash, id, sw });
  }
  items.sort((p, q) => q.z - p.z);
  for (const it of items) {
    if (it.z < zMin || it.z >= zMax) continue;
    if (it.kind === 'cell') drawGem(S, geom, it.pos, it.B, it.L, { pal: G, glow: glow * (0.4 + 0.5 * it.sw), alpha: it.a, flash: it.flash, tb, seed: seed * 50 + it.id, width: 1, sparkle: 0, frontA: 0.5, baseA: 0.22, backA: 0.18, core: 0, planes: 0, mottle: 0.5, split: 0, ridges: 0, specMix: 0.6 * it.sw, keyline: 0.1, rankW: 0.3, tone: clamp(0.3 + 0.45 * hash2(it.id, seed + 7.1) + 0.5 * it.sw) });
    else {
      if (it.smear && it.smearK > 0.01) drawSmear(S, it, GP, A);
      drawGem(S, it.f.geom, it.p, it.B, it.L, { pal: G, glow: glow * 0.38, alpha: A * it.a, tb, seed: it.f.seed, width: it.f.width, sparkle: 0, frontA: 0.95, planes: 0, mottle: 0 });
    }
  }
  // hot straight cut edges on both halves (0.3 s)
  if (cut && t >= cut.t0 && t < cut.t0 + 0.3 && C0.z >= zMin && C0.z < zMax) {
    const dt = t - cut.t0, kk = 1 - dt / 0.3;
    const ld = V.add(V.scale(pu, lu), V.scale(pw, lw2)), pn = V.add(V.scale(pu, -lw2), V.scale(pw, lu));
    const off = cs * 1.1, hl = Math.sqrt(Math.max(0, R * R - off * off));
    const sep = cut.sep == null ? 2.4 : cut.sep, gv = cut.gravity == null ? 6 : cut.gravity;
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
    for (const sgn of [1, -1]) {
      const disp = V.add(V.scale(pn, sgn * (off + sep * dt * Math.exp(-dt * 0.6))), { x: 0, y: 0.5 * gv * dt * dt, z: 0 });
      const a = V.add(V.madd(C0, ld, -hl), disp), b = V.add(V.madd(C0, ld, hl), disp);
      const qa = cam.project(a.x, a.y, a.z), qb = cam.project(b.x, b.y, b.z);
      if (!qa || !qb) continue;
      em.globalAlpha = A * kk * 0.6; em.fillStyle = rgba(GP.hot);
      em.beginPath(); const mx = (qa.x + qb.x) / 2, my = (qa.y + qb.y) / 2; streak(em, qa.x, qa.y, mx, my, Math.max(3, cs * qa.s * 0.1)); streak(em, qb.x, qb.y, mx, my, Math.max(3, cs * qa.s * 0.1)); em.fill();
      em.globalAlpha = A * kk; em.fillStyle = rgba(GP.core);
      em.beginPath(); streak(em, qa.x, qa.y, mx, my, Math.max(1.2, cs * qa.s * 0.03)); streak(em, qb.x, qb.y, mx, my, Math.max(1.2, cs * qa.s * 0.03)); em.fill();
    }
    em.restore();
  }
  // the cut line flash across the shield (blue: Kai's blade): held 3 frames at 24 fps, then fades over 6
  if (cut && t >= cut.t0 && t < cut.t0 + 0.5 && C0.z >= zMin && C0.z < zMax) {
    const f = Math.floor((t - cut.t0) * 24 + 1e-6);
    const k = f < 3 ? 1 : f < 9 ? 1 - (f - 2) / 7 : 0;
    const ld = V.add(V.scale(pu, lu), V.scale(pw, lw2));
    const pa = V.madd(C0, ld, -R * 1.3), pb = V.madd(C0, ld, R * 1.3);
    const qa = cam.project(pa.x, pa.y, pa.z), qb = cam.project(pb.x, pb.y, pb.z);
    if (qa && qb && k > 0.01) {
      em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
      const w = Math.max(1.5, cs * qa.s * 0.06);
      const bp = PAL.blue;
      const mx = (qa.x + qb.x) / 2, my = (qa.y + qb.y) / 2;
      em.globalAlpha = A * k * 0.7; em.fillStyle = rgba(bp.mid);
      em.beginPath(); streak(em, qa.x, qa.y, mx, my, w * 3); streak(em, qb.x, qb.y, mx, my, w * 3); em.fill();
      em.globalAlpha = A * k; em.fillStyle = rgba(bp.core);
      em.beginPath(); streak(em, qa.x, qa.y, mx, my, w); streak(em, qb.x, qb.y, mx, my, w); em.fill();
      em.restore();
    }
  }
}
const CELLC = new Map();
function cellCrystal(seed, id, cs) {
  const key = seed * 100000 + id;
  let c = CELLC.get(key);
  if (!c) { c = { seed: key, geom: { rad: 0.3 }, L: cs }; CELLC.set(key, c); }
  return c;
}
