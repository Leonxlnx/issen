// Builder D — energy VFX: lightning bolts, electric aura, crackle fields and shared energy-drawing helpers.
// Everything is a pure function of (S.t, params). Shapes boil on 24 fps steps, positions move at 60 fps.
//
// Colour model ("white-hot core -> saturated colour -> deep fringe"):
//   * S.L.scene gets a source-over UNDERLAY (darkest + deep palette tones) that knocks the bright sky down and
//     lays a saturated colour body under the light, so the additive passes read as colour instead of pastel.
//   * S.L.emit gets the light: deep / mid glow strokes, then a hot band and a thin white core (bloomed by the compositor).
// Underlays default to S.L.scene whenever the light goes into S.L.emit; pass under:false to disable.
import { RNG, TAU, clamp, lerp, smoothstep, hash1, hash2, hash3, noise2, rgba } from '../core/math.js';

// ---------------------------------------------------------------------------------------------
// palettes: white-hot core -> hot -> saturated mid -> deep -> darkest fringe
// ---------------------------------------------------------------------------------------------
export const PAL = {
  blue: { core: [234, 252, 255], hot: [127, 232, 255], mid: [42, 156, 255], deep: [24, 64, 208], dark: [10, 26, 110] },
  red: { core: [255, 238, 236], hot: [255, 72, 96], mid: [255, 24, 56], deep: [190, 0, 36], dark: [80, 0, 22] },
  white: { core: [255, 255, 255], hot: [214, 236, 255], mid: [140, 190, 255], deep: [60, 96, 220], dark: [18, 28, 100] },
  violet: { core: [246, 236, 255], hot: [200, 150, 255], mid: [140, 80, 255], deep: [80, 30, 200], dark: [30, 10, 90] },
  gold: { core: [255, 250, 230], hot: [255, 214, 120], mid: [255, 150, 40], deep: [190, 70, 10], dark: [80, 20, 0] },
};
const hexRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// 'blue' | 'red' | '#hex' | [r,g,b] | {core,hot,mid,deep,dark} -> palette object
export function pal(c) {
  if (!c) return PAL.blue;
  if (typeof c === 'string') { if (PAL[c]) return PAL[c]; c = hexRgb(c); }
  if (Array.isArray(c)) {
    const W = [255, 255, 255];
    return { core: mixc(c, W, 0.88), hot: mixc(c, W, 0.45), mid: c, deep: c.map((v) => v * 0.6), dark: c.map((v) => v * 0.25) };
  }
  if (c.core && c.hot && c.mid && c.deep && !c.dark) return { ...c, dark: c.deep.map((v) => v * 0.4) };
  return c;
}
// +0.5: step boundaries fall between frames, never inside a motion-blur shutter (no 50/50 double boil)
export const boilStep = (t, fps = 24) => Math.floor(t * fps + 0.5);
export const seedMix = (a, b) => ((Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0) || 1;
// default scene underlay context for a light context
const underFor = (S, ctx, o) => (o.under === false ? null : o.under || (ctx === S.L.emit ? S.L.scene : null));

// ---------------------------------------------------------------------------------------------
// low-level geometry helpers (flat arrays [x0,y0,x1,y1,...])
// ---------------------------------------------------------------------------------------------
// fill a tapered ribbon along a flat polyline. wfn(u, i) -> full width (px)
export function fillTaper(ctx, pts, wfn, i0 = 0, i1 = -1) {
  const n = pts.length >> 1;
  if (i1 < 0) i1 = n - 1;
  if (i1 - i0 < 1) return;
  const L = [], R = [];
  for (let i = i0; i <= i1; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = wfn(i / (n - 1), i) * 0.5;
    const x = pts[2 * i], y = pts[2 * i + 1];
    L.push(x - dy * w, y + dx * w); R.push(x + dy * w, y - dx * w);
  }
  ctx.beginPath();
  ctx.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) ctx.lineTo(R[i], R[i + 1]);
  ctx.closePath();
  ctx.fill();
}
function strokeFlat(ctx, pts) {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
}
// 4-point star glint (lens sparkle). size = half length of the long spikes (px)
export function starGlint(ctx, x, y, size, P, a = 1, rot = 0) {
  if (a <= 0.002 || size < 0.5) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  const spike = (len, w, col, al) => {
    ctx.fillStyle = rgba(col, clamp(al, 0, 1));
    ctx.beginPath();
    ctx.moveTo(-len, 0); ctx.lineTo(0, -w); ctx.lineTo(len, 0); ctx.lineTo(0, w); ctx.closePath();
    ctx.moveTo(0, -len * 0.62); ctx.lineTo(w, 0); ctx.lineTo(0, len * 0.62); ctx.lineTo(-w, 0); ctx.closePath();
    ctx.fill();
  };
  spike(size * 1.25, Math.max(0.8, size * 0.09), P.mid, a * 0.45);
  spike(size, Math.max(0.6, size * 0.05), P.hot, a * 0.8);
  spike(size * 0.7, Math.max(0.5, size * 0.028), P.core, a);
  ctx.fillStyle = rgba(P.core, clamp(a, 0, 1));
  ctx.beginPath(); ctx.arc(0, 0, Math.max(0.7, size * 0.07), 0, TAU); ctx.fill();
  ctx.restore();
}
// glowing spark dash from (x0,y0) to (x1,y1), additive ctx (legacy round-capped look)
export function sparkDash(ctx, x0, y0, x1, y1, w, P, al) {
  if (al <= 0.004) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(P.mid, clamp(al * 0.45, 0, 1)); ctx.lineWidth = w * 3.2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = rgba(P.hot, clamp(al * 0.9, 0, 1)); ctx.lineWidth = w * 1.6; ctx.stroke();
  ctx.strokeStyle = rgba(P.core, clamp(al, 0, 1)); ctx.lineWidth = w * 0.65; ctx.stroke();
}
// tapered spark spindle along a flat trail [tailX,tailY, ..., headX,headY]: sharp tail, round bright head.
export function sparkSpindle(ctx, trail, w, P, al) {
  if (al <= 0.004 || trail.length < 4) return;
  const n = trail.length >> 1;
  const hx = trail[2 * n - 2], hy = trail[2 * n - 1];
  if (Math.hypot(hx - trail[0], hy - trail[1]) < 0.8) { sparkPoint(ctx, hx, hy, w, P, al); return; }
  const prof = (u) => Math.pow(u, 0.8);
  ctx.fillStyle = rgba(P.mid, clamp(al * 0.5, 0, 1));
  fillTaper(ctx, trail, (u) => w * 2.8 * prof(u) + 0.3);
  ctx.fillStyle = rgba(P.hot, clamp(al * 0.95, 0, 1));
  fillTaper(ctx, trail, (u) => w * 1.35 * prof(u) + 0.2);
  ctx.fillStyle = rgba(P.core, clamp(al, 0, 1));
  fillTaper(ctx, trail, (u) => w * 0.6 * prof(u) + 0.1);
}
// a 1-2 px glitter point with a faint coloured halo
export function sparkPoint(ctx, x, y, w, P, al) {
  if (al <= 0.004) return;
  const s = Math.max(0.9, w);
  ctx.fillStyle = rgba(P.mid, clamp(al * 0.4, 0, 1));
  ctx.fillRect(x - s * 1.4, y - s * 1.4, s * 2.8, s * 2.8);
  ctx.fillStyle = rgba(P.core, clamp(al, 0, 1));
  ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
}
// soft radial glow disc (gradient) — use sparingly, for flares at contact points
export function glowDot(ctx, x, y, r, col, a = 1, sy = 1) {
  if (a <= 0.002 || r < 0.5) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, sy);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(col, clamp(a, 0, 1)));
  g.addColorStop(0.25, rgba(col, clamp(a * 0.45, 0, 1)));
  g.addColorStop(0.6, rgba(col, clamp(a * 0.12, 0, 1)));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.restore();
}
// flat-topped soft disc (for scene underlays: dark region behind energy masses)
export function softDisc(ctx, x, y, r, col, a = 1, sy = 1, rot = 0) {
  if (a <= 0.002 || r < 0.5) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, sy);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(col, clamp(a, 0, 1)));
  g.addColorStop(0.45, rgba(col, clamp(a * 0.8, 0, 1)));
  g.addColorStop(0.8, rgba(col, clamp(a * 0.25, 0, 1)));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// bolt geometry
// ---------------------------------------------------------------------------------------------
// midpoint displacement of a flat polyline. jitter = perpendicular offset relative to segment length.
// The displacement decays fast (0.6 per level) so bolts get long straight runs with decisive angular kinks
// instead of self-similar "hairy rope" roughness.
function displace(rng, pts, jitter, minSeg, kink = 0.25, decay = 0.6) {
  let disp = jitter;
  for (let lvl = 0; lvl < 10; lvl++) {
    const out = [pts[0], pts[1]];
    let maxSeg = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
      if (l > minSeg) {
        let off = (rng.next() * 2 - 1) * l * disp;
        if (rng.next() < kink) off *= 2.4;
        const al = 0.5 + (rng.next() - 0.5) * 0.4;
        out.push(x0 + dx * al - (dy / l) * off, y0 + dy * al + (dx / l) * off);
        maxSeg = Math.max(maxSeg, l * 0.5);
      }
      out.push(x1, y1);
    }
    pts = out;
    disp *= decay;
    if (maxSeg <= minSeg) break;
  }
  return pts;
}
// initial coarse guide: straight or bowed (quadratic) with optional S-wiggle
function guide(ax, ay, bx, by, bend, wig, n = 6) {
  const dx = bx - ax, dy = by - ay;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const off = bend * 4 * u * (1 - u) + wig * Math.sin(u * TAU) * u * (1 - u) * 4;
    pts.push(ax + dx * u - dy * off, ay + dy * u + dx * off);
  }
  return pts;
}
// build a bolt tree: [{pts, depth, w}] ; w = width factor (trunk 1, branches ~0.4, sub-branches ~0.16)
export function boltTree(seed, a, b, o = {}) {
  const rng = new RNG(seed);
  const jitter = o.jitter ?? 0.3, branches = o.branches ?? 0.6, maxDepth = o.depth ?? 2;
  const minSeg = o.minSeg ?? 6;
  const decay = o.decay ?? 0.6;
  const out = [];
  const grow = (ax, ay, bx, by, depth, w, bend, gp = null) => {
    let L = Math.hypot(bx - ax, by - ay);
    if (gp) { L = 0; for (let i = 2; i < gp.length; i += 2) L += Math.hypot(gp[i] - gp[i - 2], gp[i + 1] - gp[i - 1]); }
    if (L < 3) return;
    const pts = displace(rng, gp || guide(ax, ay, bx, by, bend, (rng.next() - 0.5) * 0.25 * (o.wiggle ?? 1), 4), jitter * (depth ? 1.15 : 1), Math.max(2.5, minSeg * (depth ? 0.7 : 1)), o.kink ?? 0.25, decay);
    out.push({ pts, depth, w });
    if (depth >= maxDepth || branches <= 0) return;
    const n = pts.length >> 1;
    if (n < 3) return;
    const nb = Math.floor(branches * (depth === 0 ? 7 : 3) * (0.5 + rng.next()) * Math.min(1.6, Math.sqrt(L / 250)) + rng.next());
    for (let k = 0; k < nb; k++) {
      const u = lerp(0.06, 0.88, rng.next());
      const i = Math.max(1, Math.min(n - 2, Math.floor(u * (n - 1))));
      const tx = pts[2 * i + 2] - pts[2 * i - 2], ty = pts[2 * i + 3] - pts[2 * i - 1];
      const ang = Math.atan2(ty, tx) + rng.sign() * rng.range(0.25, 0.95);
      const len = L * rng.range(0.1, 0.38) * (depth === 0 ? 1 : 0.7) * (1 - u * 0.35);
      const sx = pts[2 * i], sy = pts[2 * i + 1];
      grow(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, depth + 1, w * (0.45 - rng.next() * 0.1), (rng.next() - 0.5) * 0.3);
    }
  };
  if (o.guide) grow(o.guide[0], o.guide[1], o.guide[o.guide.length - 2], o.guide[o.guide.length - 1], 0, 1, 0, o.guide);
  else grow(a.x, a.y, b.x, b.y, 0, 1, o.bend ?? 0);
  return out;
}

// glow passes for lightning (additive): [width multiplier, palette key, alpha]
const BOLT_PASSES = [[5.5, 'deep', 0.3], [3, 'mid', 0.32]];
// source-over scene underlay: [width multiplier, palette key, alpha]. The last pass is the opaque saturated colour
// body (scaled by o.paint): over a bright sky the additive light alone always washes out to pastel, so the colour
// band between the white core and the deep fringe is PAINTED into the scene and the light only adds core + glow.
const UNDER_PASSES = [[7.5, 'dark', 0.32], [4.4, 'deep', 0.62], [2.7, 'mid', 0.9]];
const depthW = (d) => (d === 0 ? 1 : d === 1 ? 0.45 : 0.22);
// draws a prepared tree into ctx (additive). width = core width in px.
// o: { glow=1, taperIn=0.04, taperOut=0.25, under (scene ctx for the source-over underlay), underK=1,
//      paint=1 (opaque colour body in the underlay), hot=1, core=1 }
export function renderTree(ctx, tree, P, width, k, o = {}) {
  if (!tree || !tree.length || k <= 0.002) return;
  const glow = o.glow ?? 1;
  const maxD = tree.reduce((m, p) => Math.max(m, p.depth), 0);
  // ---- scene underlay: darkest + deep tones + saturated colour body, source-over, same transform as the light ctx ----
  const under = o.under;
  const uk = (o.underK ?? 1) * k;
  const paint = o.paint ?? 1;
  if (under && uk > 0.004) {
    under.save();
    under.setTransform(ctx.getTransform());
    under.globalCompositeOperation = 'source-over';
    under.lineCap = 'round'; under.lineJoin = 'round';
    for (let pi = 0; pi < UNDER_PASSES.length; pi++) {
      const [wm, key, a0] = UNDER_PASSES[pi];
      const a = pi === UNDER_PASSES.length - 1 ? a0 * paint : a0;
      if (a * uk <= 0.004) continue;
      for (let d = 0; d <= maxD; d++) {
        under.beginPath();
        let any = false;
        for (const p of tree) if (p.depth === d) { strokeFlat(under, p.pts); any = true; }
        if (!any) continue;
        under.strokeStyle = rgba(P[key], clamp(a * uk * (d ? 0.8 : 1), 0, 1));
        under.lineWidth = Math.max(1.2, width * wm * depthW(d));
        under.stroke();
      }
    }
    under.restore();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // ---- additive glow strokes ----
  if (glow > 0) {
    for (const [wm, key0, a] of BOLT_PASSES) {
      const key = key0 === 'mid' && width < 2 && !under ? 'deep' : key0;
      for (let d = 0; d <= maxD; d++) {
        ctx.beginPath();
        let any = false;
        for (const p of tree) if (p.depth === d) { strokeFlat(ctx, p.pts); any = true; }
        if (!any) continue;
        ctx.strokeStyle = rgba(P[key], clamp(a * k * glow * (d ? 0.8 : 1), 0, 1));
        ctx.lineWidth = Math.max(0.8, width * wm * depthW(d) * (0.7 + 0.3 * glow));
        ctx.stroke();
      }
    }
  }
  // ---- hot + white core: tapered fills ----
  const tapIn = o.taperIn ?? 0.04, tapOut = o.taperOut ?? 0.25;
  for (const [wm, key, a] of [[1.5, 'hot', 0.6 * (o.hot ?? 1)], [1.0, 'core', 1.0 * (o.core ?? 1)]]) {
    if (a <= 0) continue;
    ctx.fillStyle = rgba(P[key], clamp(a * k, 0, 1));
    for (const p of tree) {
      const base = width * wm * p.w;
      if (p.depth === 0) fillTaper(ctx, p.pts, (u) => Math.max(0.5, base * Math.min(1, u / tapIn + 0.3, (1 - u) / tapOut + 0.08)));
      else fillTaper(ctx, p.pts, (u) => Math.max(0.4, base * Math.pow(1 - u, 0.9)));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// lightningBolt — screen-space fractal bolt (points in px, final screen coords unless o.shake)
// ---------------------------------------------------------------------------------------------
// o: { a:{x,y}, b:{x,y}, seed=1, width=2.2, color='blue', branches=0.6, jitter=0.3, depth=2, bend=0, wiggle=1, t=S.t, tb,
//      k=1 (intensity), glow=1, flicker=0.3, glints=1, flareA=0, flareB=0.6, fps=24, shake=false, minSeg=max(6,width*3),
//      taperIn=0.04, taperOut=0.25, under=S.L.scene when ctx is S.L.emit (false = no underlay), underK=1, tree }
export function lightningBolt(S, ctx, o) {
  ctx = ctx || S.L.emit;
  const t = o.t ?? S.t;
  const fps = o.fps ?? 24;
  const step = o.tb != null ? Math.round(o.tb * fps) : boilStep(t, fps);
  const seed = seedMix(o.seed ?? 1, step);
  const P = pal(o.color);
  let k = o.k ?? 1;
  const fl = o.flicker ?? 0.3;
  k *= 1 - fl * hash2(o.seed ?? 1, step * 1.37);
  if (k <= 0.003) return null;
  const width = o.width ?? 2.2;
  const minSeg = o.minSeg ?? Math.max(6, width * 3);
  const tree = o.tree || boltTree(seed, o.a, o.b, { ...o, minSeg });
  if (!tree.length) return tree;
  const under = underFor(S, ctx, o);
  ctx.save();
  if (o.shake) S.cam.toScreen(ctx); else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  renderTree(ctx, tree, P, width, k, { ...o, under, underK: o.underK ?? 1 });
  // glints at a few kinks + glitter specks
  const rng = new RNG(seed ^ 0x5bd1e995);
  const main = tree[0].pts, n = main.length >> 1;
  const ng = Math.round((o.glints ?? 1) * (0.6 + rng.next() * 1.8));
  for (let g = 0; g < ng; g++) {
    const i = Math.floor(rng.range(0.15, 0.9) * (n - 1));
    starGlint(ctx, main[2 * i], main[2 * i + 1], width * rng.range(3, 7), P, k * rng.range(0.5, 1), rng.range(-0.3, 0.3));
  }
  const nsp = Math.round((o.glints ?? 1) * Math.max(2, n * 0.25));
  for (let g = 0; g < nsp; g++) {
    const i = Math.floor(rng.next() * n);
    const r = width * rng.range(2, 9);
    const an = rng.next() * TAU;
    const x = main[2 * i] + Math.cos(an) * r, y = main[2 * i + 1] + Math.sin(an) * r;
    const sz = rng.range(0.5, 1.3) * Math.max(1, width * 0.5);
    ctx.fillStyle = rgba(rng.next() < 0.5 ? P.hot : P.core, clamp(k * 0.9, 0, 1));
    ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
  }
  const fa = o.flareA ?? 0, fb = o.flareB ?? 0.6;
  if (fa > 0) { glowDot(ctx, o.a.x, o.a.y, width * 12, P.mid, 0.3 * fa * k); starGlint(ctx, o.a.x, o.a.y, width * 7 * fa, P, k * fa); }
  if (fb > 0) { glowDot(ctx, o.b.x, o.b.y, width * 12, P.mid, 0.3 * fb * k); starGlint(ctx, o.b.x, o.b.y, width * 7 * fb, P, k * fb); }
  ctx.restore();
  return tree;
}

// bolt between two world points (metres). width in px, or widthM in metres (scaled by depth).
export function boltWorld(S, o) {
  const p = S.cam.project(o.a.x, o.a.y, o.a.z ?? 0), q = S.cam.project(o.b.x, o.b.y, o.b.z ?? 0);
  if (!p || !q) return null;
  const s = (p.s + q.s) * 0.5;
  const width = o.widthM != null ? Math.max(0.6, o.widthM * s) : (o.width ?? 2.2);
  return lightningBolt(S, o.ctx || S.L.emit, { ...o, a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y }, width, shake: false });
}

// bolt along a polyline of screen points (zig-zag dash trails). o.pts = [{x,y},...]
export function lightningPath(S, ctx, o) {
  const pts = o.pts;
  const res = [];
  for (let i = 0; i < pts.length - 1; i++) {
    res.push(lightningBolt(S, ctx, { ...o, a: pts[i], b: pts[i + 1], seed: (o.seed ?? 1) * 31 + i, flareA: 0, flareB: i === pts.length - 2 ? (o.flareB ?? 0.6) : (o.kinkFlare ?? 0.35) }));
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// smooth energy strand (aura streams, flowing ribbons, liquid energy sheets): chunked tapered ribbons
// pts flat screen array; wfn(u)->px ; afn(u)->0..1 ; passes [[wMul,key,alpha],...]
// under: optional scene ctx for a source-over underlay ([[1.8,'dark',0.3],[1.15,'deep',0.5]] x wfn)
// ---------------------------------------------------------------------------------------------
const STRAND_PASSES = [[5, 'deep', 0.3], [2.6, 'mid', 0.36], [1.5, 'hot', 0.75], [0.6, 'core', 1]];
const STRAND_UNDER = [[1.3, 'dark', 0.3], [0.85, 'deep', 0.5], [0.5, 'mid', 0.8]];   // x the widest light pass
export function drawStrand(ctx, pts, P, wfn, afn, k = 1, passes = STRAND_PASSES, chunk = 4, under = null, underPasses = null) {
  const n = pts.length >> 1;
  if (n < 2) return;
  const layer = (c, ps, minW) => {
    for (const [wm, key, a] of ps) {
      for (let i0 = 0; i0 < n - 1; i0 += chunk) {
        const i1 = Math.min(n - 1, i0 + chunk);
        const am = afn((i0 + i1) * 0.5 / (n - 1));
        const al = a * k * am;
        if (al <= 0.004) continue;
        c.fillStyle = rgba(P[key], clamp(al, 0, 1));
        fillTaper(c, pts, (u) => Math.max(minW, wfn(u) * wm), i0, i1);
      }
    }
  };
  if (under) {
    under.save();
    under.setTransform(ctx.getTransform());
    under.globalCompositeOperation = 'source-over';
    layer(under, underPasses || STRAND_UNDER.map(([wm, key, a]) => [wm * passes[0][0], key, a]), 0.6);
    under.restore();
  }
  layer(ctx, passes, 0.4);
}

// ---------------------------------------------------------------------------------------------
// drawAura — electric aura around a character standing at world (x,y,z) (feet)
// o: { x, y, z, h=1.8, k=0..1, color='blue', t=S.t, seed=7, width=1 (hull width factor), facing=1,
//      flow={x:-0.5*facing, y:-1} (direction the streams peel off to: back and up, in world x/y),
//      arcs=1, streams=1 (2 hero streams + 5 thin), wisps=1 (smooth threads peeling off along flow), sparks=1, ground=1, haze=1, glitter=1,
//      pass='both'|'back'|'front' — parts behind the body (front<0.45) go additively into S.L.scene so a character
//        drawn AFTER covers them; parts in front go into S.L.emit. 'both' does both in one call: call it BEFORE drawKai.
//      ctx=S.L.emit, sceneCtx=S.L.scene, under (scene underlay; false disables) }
// ---------------------------------------------------------------------------------------------
export function drawAura(S, o) {
  const k = o.k ?? 1;
  if (k <= 0.002) return;
  const { x = 0, y = 0, z = 0, h = 1.8 } = o;
  const t = o.t ?? S.t;
  const seed = o.seed ?? 7;
  const P = pal(o.color);
  const emit = o.ctx || S.L.emit;
  const scene = o.sceneCtx || S.L.scene;
  const under = o.under === false ? null : (o.under || scene);
  const pass = o.pass ?? 'both';
  const facing = o.facing ?? 1;
  const flow = o.flow ?? { x: -0.5 * facing, y: -1 };
  const cam = S.cam;
  const pf = cam.project(x, y, z);
  if (!pf) return;
  const s = pf.s;
  const step = boilStep(t);
  const wf = o.width ?? 1;
  const shoulder = (v) => smoothstep(0.55, 0.68, v) * (1 - smoothstep(0.84, 0.96, v));
  const rad = (v) => h * wf * (0.17 + 0.07 * Math.sin(Math.PI * clamp(v, 0, 1)) - 0.04 * smoothstep(0.85, 1.05, v)) * (1 + 0.4 * shoulder(v));
  const W2S = (wx, wy, wz) => cam.project(wx, wy, wz);
  const hull = (th, v, rm = 1) => { const R = rad(v) * rm; return W2S(x + Math.cos(th) * R, y - v * h, z + Math.sin(th) * R); };
  const pxScale = clamp(s / 120, 0.35, 3);
  const frontOf = (th) => 0.5 - 0.5 * Math.sin(th);
  const wantBack = pass !== 'front', wantFront = pass !== 'back';
  const pick = (f) => (f < 0.45 ? (wantBack ? scene : null) : (wantFront ? emit : null));
  const backK = 0.7;
  const prep = (c) => { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round'; };
  prep(emit); if (scene !== emit) prep(scene);
  const pc = W2S(x + flow.x * h * 0.12, y - h * 0.55 + flow.y * h * 0.05, z);

  // --- haze: dark/deep colour body in the scene (behind the character), soft deep glow in emit ---
  const hz = (o.haze ?? 1) * k;
  if (hz > 0.003 && pc) {
    if (wantBack && under) {
      under.save(); under.setTransform(1, 0, 0, 1, 0, 0); under.globalCompositeOperation = 'source-over';
      softDisc(under, pc.x, pc.y, h * 0.75 * s, P.dark, 0.32 * hz, 1.45);
      softDisc(under, pc.x, pc.y - h * 0.08 * s, h * 0.5 * s, P.deep, 0.22 * hz, 1.6);
      under.restore();
    }
    if (wantFront) glowDot(emit, pc.x, pc.y, h * 0.62 * s, P.deep, 0.1 * hz, 1.6);
  }
  // --- ground glow ---
  const gR = 1.4 * h * 0.6;
  const g1 = W2S(x, y, z - gR), g2 = W2S(x, y, z + gR);
  if ((o.ground ?? 1) > 0 && g1 && g2 && wantFront) {
    const ry = Math.max(2, Math.abs(g1.y - g2.y) * 0.5), rx = gR * s;
    glowDot(emit, pf.x, (g1.y + g2.y) * 0.5, rx, P.deep, 0.45 * k * (o.ground ?? 1), ry / rx);
    glowDot(emit, pf.x, (g1.y + g2.y) * 0.5, rx * 0.4, P.mid, 0.35 * k * (o.ground ?? 1), ry / rx);
  }

  // --- flowing filaments: smooth guide (60 fps) + fractal crackle (24 fps boil); they peel off along `flow` ---
  const nStreams = Math.round(7 * (o.streams ?? 1));
  for (let j = 0; j < nStreams; j++) {
    const hero = j < 2;
    const hj = (q) => hash2(seed * 13 + j, q);
    const turns = lerp(0.12, 0.35, hj(2)) * (hj(3) < 0.5 ? -1 : 1);
    const rate = lerp(0.5, 1.0, hj(4)), len = hero ? lerp(0.75, 1.0, hj(5)) : lerp(0.45, 0.85, hj(5));
    const cyc = t * rate + hj(6);
    const ci = Math.floor(cyc), f = cyc - ci;
    // hero streams start on the visible (front/side) half
    const ph = hero ? (j === 0 ? -0.5 : -2.4) * Math.PI / 2 + (hash2(seed + j, ci) - 0.5) * 1.2 : hj(1) * TAU + hash2(seed + j, ci) * TAU;
    const c = lerp(-len * 0.3, 1.05 + len * 0.3, f);
    const v0 = Math.max(-0.01, c - len * 0.5), v1 = Math.min(1.15, c + len * 0.5);
    if (v1 - v0 < 0.08) continue;
    const env = Math.pow(Math.sin(Math.PI * f), 0.5);
    const N = 22, gp = [];
    let front = 0, cnt = 0;
    for (let i = 0; i <= N; i++) {
      const v = lerp(v0, v1, i / N);
      // wraps the body low, peels off back/up along `flow` high; a slow wave keeps it liquid
      const th = ph + turns * TAU * (v - c) * (1.6 - v) + t * 0.9 * Math.sign(turns) + 0.45 * Math.sin(v * 8 + j * 1.7 + t * 2.2);
      const off = 0.45 * h * Math.pow(Math.max(0, v), 1.6) * (0.4 + f);
      const R = rad(v) * lerp(1.1, 1.4, 0.5 + 0.5 * Math.sin(v * 7 + j * 2.3));
      const p = W2S(x + Math.cos(th) * R + flow.x * off, y - v * h + flow.y * off * 0.4, z + Math.sin(th) * R);
      if (!p) continue;
      gp.push(p.x, p.y);
      front += frontOf(th); cnt++;
    }
    if (gp.length < 8) continue;
    front /= cnt;
    const ctx = pick(front);
    if (!ctx) continue;
    const w = (hero ? 2.4 : 1.0) * pxScale;
    const tree = boltTree(seedMix(seed * 7 + j, step), null, null, { guide: gp, jitter: hero ? 0.1 : 0.2, branches: hero ? 0.45 : 0.35, depth: hero ? 2 : 1, minSeg: Math.max(6, w * 3), kink: hero ? 0.12 : 0.25 });
    const kk = k * env * (hero ? 1 : lerp(0.5, 1, front)) * (ctx === scene ? backK : 1);
    renderTree(ctx, tree, P, w, kk, { taperIn: 0.2, taperOut: 0.3, under: ctx === emit && under ? under : null, underK: hero ? 0.85 : 0.6 });
  }

  // --- wisps: smooth glowing threads that lift off the body and stream away along `flow` (ref7) ---
  const nW = Math.round(12 * (o.wisps ?? 1) * (0.5 + 0.5 * k));
  const WISP_PASSES = [[4, 'deep', 0.3], [2, 'mid', 0.55], [1, 'hot', 0.85], [0.4, 'core', 1]];
  for (let j = 0; j < nW; j++) {
    const hj = (q) => hash2(seed * 41 + j, q);
    const life = lerp(0.6, 1.2, hj(1));
    const cyc = t / life + hj(2), ci = Math.floor(cyc), f = cyc - ci;
    const hc = (q) => hash3(seed * 43 + j, ci, q);
    const th0 = hc(1) * TAU, v0 = lerp(0.15, 0.95, Math.sqrt(hc(2)));
    const turn = (hc(3) - 0.5) * 1.6, len = lerp(0.35, 0.8, hc(4));
    const head = clamp(f * 1.6), tail = clamp(f * 1.6 - 0.55);
    if (head - tail < 0.04) continue;
    const N = 16, pts = [];
    let front = 0;
    for (let i = 0; i <= N; i++) {
      const s = lerp(tail, head, i / N);
      const th = th0 + turn * s + 0.35 * Math.sin(s * 7 + j + t * 3);
      const v = v0 + s * len * 0.55;
      const R = rad(Math.min(v, 1.05)) * lerp(1.05, 1.5, s);
      const off = h * len * Math.pow(s, 1.3) * 0.8;
      const p = W2S(x + Math.cos(th) * R + flow.x * off, y - v * h + flow.y * off * 0.35, z + Math.sin(th) * R);
      if (!p) continue;
      pts.push(p.x, p.y);
      front += frontOf(th);
    }
    if (pts.length < 8) continue;
    const ctx = pick(front / (pts.length / 2));
    if (!ctx) continue;
    const w = lerp(0.8, 1.6, hc(5)) * pxScale;
    const al = k * Math.sin(Math.PI * f) * (ctx === scene ? backK : 1);
    drawStrand(ctx, pts, P, (u) => w * Math.pow(Math.sin(Math.PI * u), 0.7), () => 1, al, WISP_PASSES, 4);
  }

  // --- crackling arcs hugging the body (denser at shoulders and arms) ---
  const nArcs = Math.round((12 + 22 * k) * (o.arcs ?? 1));
  for (let j = 0; j < nArcs; j++) {
    const per = 2 + Math.floor(hash2(seed + 3, j) * 4);
    const off = Math.floor(hash2(seed + 5, j) * per);
    const cyc = Math.floor((step + off) / per), age = (step + off) - cyc * per;
    const hc = (q) => hash3(seed + j * 17, cyc, q);
    if (hc(0) < 0.25) continue;
    const th = hc(1) * TAU;
    const v = hc(12) < 0.65 ? lerp(0.3, 1, Math.sqrt(hc(2))) : lerp(0.02, 1.0, hc(2));
    const dth = (hc(3) < 0.5 ? -1 : 1) * lerp(0.4, 1.4, hc(4));
    const dv = (hc(5) - 0.5) * 0.45;
    const leap = hc(6) < 0.3 ? lerp(1.4, 2.1, hc(7)) : lerp(0.95, 1.25, hc(7));
    const A = hull(th, v, lerp(0.9, 1.1, hc(8)));
    const v2 = clamp(v + dv, -0.02, 1.08);
    const R2 = rad(v2) * leap, th2 = th + dth, fo = 0.18 * h * v2 * (leap - 0.9);
    const B = W2S(x + Math.cos(th2) * R2 + flow.x * fo, y - v2 * h + flow.y * fo * 0.5, z + Math.sin(th2) * R2);
    if (!A || !B) continue;
    const front = frontOf(th + dth * 0.5);
    const ctx = pick(front);
    if (!ctx) continue;
    const kk = k * Math.pow(0.55, age) * lerp(0.45, 1, front) * (ctx === scene ? backK : 1);
    lightningBolt(S, ctx, {
      a: A, b: B, color: P, seed: seed * 101 + j * 7 + cyc * 13, tb: step / 24, width: lerp(0.8, 1.5, hc(9)) * pxScale,
      branches: 0.5, jitter: 0.32, depth: 1, k: kk, flicker: 0.15, glints: 0.5, flareB: hc(10) < 0.3 ? 0.45 : 0, bend: (hc(11) - 0.5) * 0.5,
      under: ctx === emit ? under || false : false, underK: 0.7,
    });
  }

  // --- ground arcs crawling out from the feet ---
  const nG = Math.round((2 + 4 * k) * (o.ground ?? 1));
  for (let j = 0; j < nG; j++) {
    const per = 3 + Math.floor(hash2(seed + 9, j) * 3);
    const cyc = Math.floor((step + j) / per), age = step + j - cyc * per;
    const hc = (q) => hash3(seed * 3 + j * 29, cyc, q);
    if (hc(0) < 0.2) continue;
    const an = hc(1) * TAU, r0 = lerp(0.15, 0.4, hc(2)) * h * 0.5, r1 = lerp(0.9, 2.4, hc(3)) * h * 0.5;
    const A = W2S(x + Math.cos(an) * r0, y, z + Math.sin(an) * r0 * 0.8);
    const B = W2S(x + Math.cos(an + (hc(4) - 0.5) * 0.6) * r1, y, z + Math.sin(an) * r1 * 0.8);
    if (!A || !B) continue;
    const ctx = pick(Math.sin(an) < 0.3 ? 1 : 0.2);
    if (!ctx) continue;
    lightningBolt(S, ctx, {
      a: A, b: B, color: P, seed: seed * 7 + j * 53 + cyc, tb: step / 24, width: lerp(0.9, 1.6, hc(5)) * pxScale,
      branches: 0.8, jitter: 0.28, depth: 2, k: k * Math.pow(0.6, age) * (ctx === scene ? backK : 1), flicker: 0.1, glints: 0.5, flareB: 0.35,
      under: ctx === emit ? under || false : false, underK: 0.5,
    });
  }

  // --- rising sparks / embers (continuous 60 fps trajectories, drifting with the flow) ---
  const nSp = Math.round(40 * k * (o.sparks ?? 1));
  for (let i = 0; i < nSp; i++) {
    const life = lerp(0.7, 1.6, hash2(seed + 11, i));
    const cyc = (t + hash2(seed + 12, i) * 5) / life;
    const ci = Math.floor(cyc), a = cyc - ci;
    const hp = (q) => hash3(seed + i * 3, ci, q);
    const th = hp(1) * TAU, R = rad(0.3) * lerp(0.5, 1.7, hp(2));
    const v0 = lerp(-0.02, 0.75, hp(3) * hp(3));
    const vy = lerp(0.5, 1.8, hp(4)) * h / 1.8, vo = lerp(0.05, 0.5, hp(8));
    const pos = (aa) => {
      const tt = aa * life;
      const rise = vy * tt - 0.15 * tt * tt;
      const sw = Math.sin(tt * lerp(4, 9, hp(5)) + hp(6) * 6) * 0.06;
      const RR = R + vo * tt;
      return W2S(x + Math.cos(th) * RR + sw + flow.x * 0.5 * tt * h / 1.8, y - v0 * h - rise, z + Math.sin(th) * RR);
    };
    const ctx = pick(frontOf(th));
    if (!ctx) continue;
    const al = k * Math.pow(1 - a, 1.2) * smoothstep(0, 0.08, a) * (0.55 + 0.45 * hash2(i, step)) * (ctx === scene ? backK : 1);
    const w = lerp(0.6, 1.6, hp(7) ** 2) * pxScale;
    if (hp(10) < 0.35) { const p = pos(a); if (p) sparkPoint(ctx, p.x, p.y, w, P, al); continue; }
    const tr = [];
    for (let q = 0; q <= 3; q++) { const p = pos(Math.max(0, a - 0.04 * (1 - q / 3))); if (p) tr.push(p.x, p.y); }
    sparkSpindle(ctx, tr, w, P, al);
    if (hp(9) < 0.08 && tr.length) starGlint(ctx, tr[tr.length - 2], tr[tr.length - 1], w * 6, P, al);
  }

  // --- glitter specks (boil), denser at the upper body / along the flow ---
  const nGl = Math.round(120 * k * (o.glitter ?? 1));
  for (let i = 0; i < nGl; i++) {
    const hq = (q) => hash3(seed + 77, i + step * 131, q);
    const v = lerp(-0.05, 1.15, Math.sqrt(hq(1))), th = hq(2) * TAU;
    const rm = lerp(0.9, 2.2, hq(3));
    const R = rad(v) * rm, fo = 0.5 * h * Math.pow(Math.max(0, v), 1.4) * hq(8);
    const p = W2S(x + Math.cos(th) * R + flow.x * fo, y - v * h + flow.y * fo * 0.5, z + Math.sin(th) * R);
    if (!p) continue;
    const ctx = pick(frontOf(th));
    if (!ctx) continue;
    const sz = lerp(0.8, 2.4, hq(4) * hq(4)) * pxScale;
    const al = k * lerp(0.4, 1, hq(7)) * (ctx === scene ? backK : 1);
    if (hq(5) < 0.1) starGlint(ctx, p.x, p.y, sz * 4, P, al);
    else { ctx.fillStyle = rgba(hq(6) < 0.5 ? P.core : P.hot, clamp(al, 0, 1)); ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz); }
  }
  emit.restore(); if (scene !== emit) scene.restore();
}

// ---------------------------------------------------------------------------------------------
// energy web: pre-rendered, tileable "cell web" textures (domain-warped two-scale Voronoi crackle) — the dense
// micro-vein / cauliflower-cell energy mass of ref2/ref3/ref5. Generated once per variant (deterministic), then
// colourised per palette into an additive light texture (bright cell edges + rim glow + sparkles) and a source-over
// underlay texture (saturated colour body with darker cell blotches).
// ---------------------------------------------------------------------------------------------
const WEB_N = 768;
const _webRaw = [];
const _webTex = new Map();
function webRaw(variant) {
  if (_webRaw[variant]) return _webRaw[variant];
  const N = WEB_N;
  const E = new Float32Array(N * N), G = new Float32Array(N * N), C = new Float32Array(N * N);
  // tileable feature points for two cell scales
  const mk = (n, sd) => { const p = new Float32Array(n * n * 2); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { p[(j * n + i) * 2] = i + 0.1 + 0.8 * hash2(i * 1.31 + sd, j * 0.77 + sd * 0.3); p[(j * n + i) * 2 + 1] = j + 0.1 + 0.8 * hash2(j * 1.17 - sd, i * 0.53 + 3.1 + sd); } return p; };
  const nA = 8, nB = 23;
  const pA = mk(nA, 11 + variant * 7), pB = mk(nB, 31 + variant * 13);
  const rA = new Float32Array(nA * nA); for (let i = 0; i < rA.length; i++) rA[i] = hash2(i * 3.7 + variant, 9.1);
  let F1 = 0, F2 = 0, ID = 0;
  const vor = (x, y, n, p) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      let cx = xi + i, cy = yi + j;
      const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
      const q = (wy * n + wx) * 2;
      const dx = p[q] + (cx - wx) - x, dy = p[q + 1] + (cy - wy) - y;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = wy * n + wx; } else if (d < f2) f2 = d;
    }
    F1 = Math.sqrt(f1); F2 = Math.sqrt(f2); ID = id;
  };
  // low-res tileable warp field (periodic noise via 4-corner blend), bilinear upsampled
  const WN = 64, wfx = new Float32Array(WN * WN), wfy = new Float32Array(WN * WN), wm = new Float32Array(WN * WN);
  const per = (fx, fy, s, off) => {
    // periodic noise on the torus: sample noise on a circle per axis
    const a = fx * TAU, b = fy * TAU;
    return noise2(Math.cos(a) * s + off, Math.sin(a) * s + Math.cos(b) * s * 0.7) * 0.6 + noise2(Math.sin(b) * s * 1.3 - off, Math.cos(b) * s + Math.sin(a) * s * 0.5) * 0.4;
  };
  for (let j = 0; j < WN; j++) for (let i = 0; i < WN; i++) {
    const fx = i / WN, fy = j / WN;
    wfx[j * WN + i] = per(fx, fy, 1.3, variant * 5.1) + 0.45 * per(fx, fy, 3.1, variant * 2.3 + 7);
    wfy[j * WN + i] = per(fy, fx, 1.3, variant * 3.7 + 19) + 0.45 * per(fy, fx, 3.1, variant * 1.9 + 31);
    wm[j * WN + i] = per(fx, fy, 2.2, variant * 4.3 + 53);
  }
  const samp = (arr, x, y) => {
    const fx = x * WN, fy = y * WN, i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
    const i1 = (i0 + 1) % WN, j1 = (j0 + 1) % WN, ii = ((i0 % WN) + WN) % WN, jj = ((j0 % WN) + WN) % WN;
    return lerp(lerp(arr[jj * WN + ii], arr[jj * WN + i1], ax), lerp(arr[j1 * WN + ii], arr[j1 * WN + i1], ax), ay);
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const wx = u + 0.035 * samp(wfx, u, v), wy = v + 0.035 * samp(wfy, u, v);
      const m = samp(wm, u, v);
      vor(wx * nA, wy * nA, nA, pA);
      const eA = F2 - F1, idA = ID, f1A = F1;
      // fine scale with its own small jitter for crackly edges
      vor(wx * nB + 0.08 * Math.sin(TAU * (v * 15 + u * 5)), wy * nB + 0.08 * Math.sin(TAU * (u * 14 - v * 4)), nB, pB);
      const eB = F2 - F1;
      const lineA = 1 - smoothstep(0.0, 0.05, eA);
      const lineB = (1 - smoothstep(0.0, 0.07, eB)) * smoothstep(-0.25, 0.35, m);
      const ri = rA[idA];
      const brightEdge = 0.55 + 0.45 * Math.abs(Math.sin(idA * 1.7 + ri * 9));
      const i = y * N + x;
      E[i] = Math.max(lineA * brightEdge, lineB * 0.55);
      G[i] = Math.exp(-eA * 5.5) * (0.5 + 0.5 * ri) + 0.35 * Math.exp(-eB * 7) * smoothstep(-0.2, 0.4, m);
      C[i] = clamp(smoothstep(0.12, 0.5, f1A) * (ri < 0.6 ? 1 : 0.4));
    }
  }
  return (_webRaw[variant] = { E, G, C, N });
}
// colourised textures for a palette: { light, under } canvases (tileable)
export function webTextures(P, variant = 0) {
  const key = `${variant}|${P.core}|${P.hot}|${P.mid}|${P.deep}|${P.dark}`;
  if (_webTex.has(key)) return _webTex.get(key);
  const raw = webRaw(variant), N = raw.N;
  const mkc = () => { const c = document.createElement('canvas'); c.width = N; c.height = N; return c; };
  const light = mkc(), und = mkc();
  const lc = light.getContext('2d'), uc = und.getContext('2d');
  const li = lc.createImageData(N, N), ui = uc.createImageData(N, N);
  const ramp = [[0, [0, 0, 0]], [0.2, mixc(P.deep, P.mid, 0.5)], [0.45, P.mid], [0.78, P.hot], [1, P.core]];
  const rampAt = (v) => {
    for (let r = 1; r < ramp.length; r++) if (v <= ramp[r][0]) { const a = ramp[r - 1], b = ramp[r], f = (v - a[0]) / (b[0] - a[0]); return [lerp(a[1][0], b[1][0], f), lerp(a[1][1], b[1][1], f), lerp(a[1][2], b[1][2], f)]; }
    return P.core;
  };
  const LUT = []; for (let i = 0; i <= 255; i++) LUT.push(rampAt(i / 255));
  for (let i = 0; i < N * N; i++) {
    const e = raw.E[i], g = raw.G[i], c = raw.C[i];
    // additive light: edges climb the ramp toward white, rim glow stays in deep/mid
    const v = clamp(e * 0.86 + g * 0.24);
    const col = LUT[(v * 255) | 0];
    li.data[i * 4] = col[0]; li.data[i * 4 + 1] = col[1]; li.data[i * 4 + 2] = col[2]; li.data[i * 4 + 3] = 255;
    // underlay: saturated body, mid toward the bright rims, darker blotches in some cell centres
    const bm = clamp(g * 1.1 + e * 0.7);
    const base = bm < 0.5 ? mixc(P.dark, P.deep, bm * 2) : mixc(P.deep, P.mid, (bm - 0.5) * 2);
    const col2 = mixc(base, mixc(P.dark, [0, 0, 0], 0.4), c * 0.7);
    ui.data[i * 4] = col2[0]; ui.data[i * 4 + 1] = col2[1]; ui.data[i * 4 + 2] = col2[2];
    ui.data[i * 4 + 3] = 255 * clamp(0.78 + 0.2 * bm);
  }
  lc.putImageData(li, 0, 0); uc.putImageData(ui, 0, 0);
  const r = { light, under: und, N };
  _webTex.set(key, r);
  return r;
}
let _webA = null, _webM = null;
function webScratch(W, H) {
  if (!_webA || _webA.width !== W || _webA.height !== H) {
    _webA = document.createElement('canvas'); _webA.width = W; _webA.height = H;
    _webM = document.createElement('canvas'); _webM.width = W; _webM.height = H;
  }
  return [_webA, _webM];
}
// drawEnergyWeb(S, o) — a soft-masked patch of the energy web. Screen-space (shake applied with o.shake).
// o: { cx, cy, rx, ry, angle=0 (flow direction: cells stretch and slide along it), color, k=1, t=S.t, seed=1,
//      scale=1 (cell size factor; 1 = ~150 px big cells at 1080p), stretch=1.7 (elongation along the flow),
//      speed=1 (slide speed), fps=12 (boil), blobs=[[u,v,r],...] extra mask ellipses in local units (-1..1),
//      light=1, under=1 (underlay strength), ctx=S.L.emit, sceneCtx=S.L.scene, shake=true }
export function drawEnergyWeb(S, o) {
  const k = o.k ?? 1;
  if (k <= 0.003) return;
  const P = pal(o.color);
  const t = o.t ?? S.t;
  const fps = o.fps ?? 12;
  const step = boilStep(t, fps);
  const seed = o.seed ?? 1;
  const variant = (step + seed) % 3;
  const tex = webTextures(P, variant);
  const { W, H } = S;
  const px = H / 1080;
  const cx = o.cx ?? W * 0.5, cy = o.cy ?? H * 0.5, rx = o.rx ?? W * 0.25, ry = o.ry ?? H * 0.3;
  const ang = o.angle ?? 0;
  const [A, M] = webScratch(W, H);
  const a = A.getContext('2d'), m = M.getContext('2d');
  // texture transform: tile -> screen. Big cells are N/8 texels; scale so they are ~150 px * scale.
  const sc = (150 * px * (o.scale ?? 1)) / (tex.N / 8);
  const st = o.stretch ?? 1.7;
  const slide = t * 60 * px * (o.speed ?? 1) + hash2(seed, step) * 37 * px;
  const jit = hash2(seed + 3, step) * tex.N;
  const mat = new DOMMatrix().translateSelf(cx, cy).rotateSelf(ang * 180 / Math.PI).translateSelf(-slide, 0).scaleSelf(sc * st, sc / Math.sqrt(st)).translateSelf(jit, jit * 0.37);
  const bx0 = cx - rx - ry, by0 = cy - rx - ry, bw = 2 * (rx + ry), bh = 2 * (rx + ry);
  // mask: union of soft ellipses (local u along flow, v across)
  m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, W, H);
  m.globalCompositeOperation = 'lighter';
  const ca = Math.cos(ang), sa = Math.sin(ang);
  if (o.band) {
    // band mask: a strip along the flow axis through (cx,cy), local x in [x0,x1], soft half-width hw(x) (stacked layers)
    const { x0, x1, hw } = o.band;
    const M2 = 90;
    m.save(); m.translate(cx, cy); m.rotate(ang);
    for (let L = 1; L <= 6; L++) {
      const f = Math.pow(L / 6, 1.5);
      m.fillStyle = 'rgba(255,255,255,0.2)';
      m.beginPath();
      for (let i = 0; i <= M2; i++) { const x = lerp(x0, x1, i / M2); m.lineTo(x, -hw(x, -1) * f); }
      for (let i = M2; i >= 0; i--) { const x = lerp(x0, x1, i / M2); m.lineTo(x, hw(x, 1) * f); }
      m.closePath(); m.fill();
    }
    m.restore();
  }
  const blobs = o.band ? [] : o.blobs || [[0, 0, 1]];
  for (const [bu, bv, br, bry] of blobs) {
    m.save();
    m.translate(cx + ca * bu * rx - sa * bv * ry, cy + sa * bu * rx + ca * bv * ry);
    m.rotate(ang); m.scale(1, (bry ?? 1) * ry / rx);
    const R = rx * br;
    const g = m.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.85)'); g.addColorStop(0.75, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g; m.beginPath(); m.arc(0, 0, R, 0, TAU); m.fill();
    m.restore();
  }
  const pass = (texCanvas, target, op, alpha) => {
    if (alpha <= 0.003) return;
    a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
    a.clearRect(bx0 - 2, by0 - 2, bw + 4, bh + 4);
    const pat = a.createPattern(texCanvas, 'repeat');
    pat.setTransform(mat);
    a.fillStyle = pat; a.fillRect(bx0, by0, bw, bh);
    a.globalCompositeOperation = 'destination-in';
    a.drawImage(M, 0, 0);
    target.save();
    if (o.shake ?? true) S.cam.toScreen(target); else target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = op; target.globalAlpha = clamp(alpha);
    target.drawImage(A, 0, 0);
    target.restore();
  };
  const sceneCtx = o.sceneCtx || S.L.scene;
  if (sceneCtx && (o.under ?? 1) > 0) pass(tex.under, sceneCtx, 'source-over', k * (o.under ?? 1) * 0.85);
  pass(tex.light, o.ctx || S.L.emit, 'lighter', k * (o.light ?? 1));
}

// ---------------------------------------------------------------------------------------------
// drawCrackleField — dense screen-space region of liquid energy sheets, electric veins, flowing streamers and
// glitter (the "half the frame is crackling energy" look of ref1-ref4). Region = ellipse (cx,cy,rx,ry) in px.
// The field FLOWS along `angle` and funnels into its +u end (the contact point): put that end at the clash.
// o: { cx, cy, rx=W*0.25, ry=H*0.3, angle=0 (flow direction toward the contact end, radians), density=1, k=1,
//      color='blue', t=S.t, seed=17, sheets=1, streamers=1, veins=1, glitter=1, haze=0.22, funnel=1,
//      width=1.6 (vein core px), sheetW=1 (sheet width factor), speed=1 (flow speed), falloff=1 (edge fade),
//      web=1 (dense cell-web energy mass, see drawEnergyWeb), webScale=0.7 (cell size factor, also scales with rx),
//      webBlobs (mask ellipses [[u,v,r,ry],...] in local units), lanes=1 (streak lanes on the sheets),
//      ctx=S.L.emit, under (scene underlay ctx; default S.L.scene, false disables), shake=true }
// ---------------------------------------------------------------------------------------------
export function drawCrackleField(S, o = {}) {
  if (globalThis.__D_OFF?.crackle) return;
  const k = o.k ?? 1;
  if (k <= 0.002) return;
  const t = o.t ?? S.t;
  const P = pal(o.color);
  const ctx = o.ctx || S.L.emit;
  const under = underFor(S, ctx, o);
  const seed = o.seed ?? 17;
  const step = boilStep(t);
  const px = S.H / 1080;
  const cx = o.cx ?? S.W * 0.3, cy = o.cy ?? S.H * 0.5;
  const rx = o.rx ?? S.W * 0.25, ry = o.ry ?? S.H * 0.3;
  const ang = o.angle ?? 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const dens = o.density ?? 1, wv = (o.width ?? 1.6) * Math.max(0.6, px);
  const fall = o.falloff ?? 1;
  const fun = o.funnel ?? 1;
  const speed = o.speed ?? 1;
  // local (u along flow, v across) in -1..1 -> screen
  const L2S = (u, v) => ({ x: cx + ca * u * rx - sa * v * ry, y: cy + sa * u * rx + ca * v * ry });
  const env = (u, v) => clamp(1 - fall * smoothstep(0.6, 1.05, Math.hypot(u * 0.92, v)));
  // funnel: the field narrows toward its contact end (u=+1)
  const funW = (u) => { const up = clamp((u + 1) * 0.5); return lerp(1, 0.12 + 0.88 * Math.pow(1 - up, 1.6), fun); };
  ctx.save();
  if (o.shake ?? true) S.cam.toScreen(ctx); else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  // ---- underlay: dark colour body over the region (scene, source-over) ----
  const haze = (o.haze ?? 0.22) * k;
  if (under) {
    under.save(); under.setTransform(ctx.getTransform()); under.globalCompositeOperation = 'source-over';
    under.translate(cx, cy); under.rotate(ang);
    const ua = clamp(k) * (o.underK ?? 1);
    softDisc(under, -rx * 0.05, 0, rx * 1.05, P.dark, 0.55 * ua, ry / rx * 0.9);
    softDisc(under, rx * 0.2, 0, rx * 0.75, P.deep, 0.4 * ua, ry / rx * 0.7);
    softDisc(under, rx * 0.45, 0, rx * 0.45, P.deep, 0.3 * ua, ry / rx * 0.6);
    under.restore();
  }
  // ---- energy web: dense cell-web mass (saturated body in the scene + bright crackle edges in emit) ----
  const webK = (globalThis.__D_OFF?.web ? 0 : o.web ?? 1) * k;
  if (webK > 0.003) {
    ctx.restore();
    drawEnergyWeb(S, {
      cx, cy, rx, ry, angle: ang, color: P, t, seed, k: webK * 0.9, scale: (o.webScale ?? 0.7) * Math.sqrt(rx / (S.W * 0.3)), speed,
      blobs: o.webBlobs || [[-0.3, 0, 0.78, 0.95], [0.2, 0, 0.62, 0.8 * lerp(1, 0.7, fun)], [0.62, 0, 0.4, lerp(1, 0.5, fun)]],
      under: under ? 1 : 0, ctx, sceneCtx: under || undefined, shake: o.shake ?? true,
    });
    ctx.save();
    if (o.shake ?? true) S.cam.toScreen(ctx); else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
  }
  if (haze > 0.003) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    glowDot(ctx, 0, 0, rx * 1.05, P.deep, haze, ry / rx);
    glowDot(ctx, rx * 0.3, 0, rx * 0.55, P.mid, haze * 0.3, ry / rx * 0.8);
    ctx.restore();
  }
  // ---- liquid energy sheets: wide saturated colour wash + a bundle of thin sweeping streak lanes that slide
  //      along the sheet into the contact end (ref2/ref3 "energy wind") ----
  const nSh = Math.round(lerp(4, 6.99, hash2(seed, 91)) * dens * (o.sheets ?? 1));
  for (let j = 0; j < nSh; j++) {
    const hj = (q) => hash2(seed * 17 + j, q);
    const v0 = lerp(-0.75, 0.75, (j + hj(1)) / Math.max(1, nSh)), amp = lerp(0.08, 0.28, hj(2)), fr = lerp(0.5, 1.3, hj(3)), ph = hj(4) * TAU;
    const wmax = lerp(22, 64, hj(5)) * px * (o.sheetW ?? 1);
    const ua = lerp(-1.05, -0.55, hj(6)), ub = lerp(0.65, 1.0, hj(7));
    const vel = lerp(1.2, 2.4, hj(8)) * speed;
    const N = 44, pts = [];
    for (let i = 0; i <= N; i++) {
      const u = lerp(ua, ub, i / N);
      const v = (v0 + amp * Math.sin(u * fr * Math.PI + ph - t * vel)) * funW(u);
      const p = L2S(u, v);
      pts.push(p.x, p.y);
    }
    const pulseA = 0.8 + 0.2 * Math.sin(t * lerp(3, 6, hj(9)) + j);
    const wfn = (u) => wmax * Math.pow(Math.sin(Math.PI * clamp(u)), 0.75) * lerp(1, 0.5, u) * (0.6 + 0.4 * noise2(u * 5 + j * 3.1, t * 0.8 + seed));
    const afn = (u) => env(lerp(ua, ub, u), v0 * funW(lerp(ua, ub, u))) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.85, 1, u)) * (0.65 + 0.35 * noise2(u * 4 - j, t * 1.3));
    drawStrand(ctx, pts, P, wfn, afn, k * pulseA, [[1, 'deep', 0.3], [0.5, 'mid', 0.26]], 3, under, [[1.45, 'dark', 0.32], [1.0, 'deep', 0.55], [0.6, 'mid', 0.6]]);
    // streak lanes across the sheet
    const nrm = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N, i + 1);
      let dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1]; const l = Math.hypot(dx, dy) || 1;
      nrm.push(-dy / l, dx / l);
    }
    const nl = Math.round((6 + hj(10) * 6) * (o.lanes ?? 1));
    for (let l = 0; l < nl; l++) {
      const hl = (q) => hash3(seed * 29 + j, l, q);
      const off = (hl(1) - 0.5) * 0.95;
      const len = lerp(0.25, 0.6, hl(3));
      const c = lerp(-0.2, 1.2, (hl(4) + t * vel * 0.12) % 1);
      const fa = Math.max(0, c - len / 2), fb = Math.min(1, c + len / 2);
      if (fb - fa < 0.05) continue;
      const i0 = Math.floor(fa * N), i1 = Math.ceil(fb * N);
      const lp = [];
      for (let i = i0; i <= i1; i++) { const u = i / N, w = wfn(u) * 0.5 * off; lp.push(pts[2 * i] + nrm[2 * i] * w, pts[2 * i + 1] + nrm[2 * i + 1] * w); }
      if (lp.length < 4) continue;
      const al = k * pulseA * afn(c) * lerp(0.45, 1, hl(5));
      if (al < 0.02) continue;
      const lw = lerp(0.8, 2.8, hl(6) ** 2) * px;
      ctx.fillStyle = rgba(P.hot, clamp(al * 0.6, 0, 1));
      fillTaper(ctx, lp, (u) => lw * 2 * Math.pow(Math.sin(Math.PI * u), 0.6));
      if (hl(7) < 0.45) { ctx.fillStyle = rgba(P.core, clamp(al * 0.85, 0, 1)); fillTaper(ctx, lp, (u) => lw * 0.7 * Math.pow(Math.sin(Math.PI * u), 0.6)); }
    }
  }
  // ---- flowing streamers: long curves along the flow, sliding over time, fine crackle ----
  const ns = Math.round(9 * dens * (o.streamers ?? 1));
  for (let j = 0; j < ns; j++) {
    const hj = (q) => hash2(seed * 7 + j, q);
    const v0 = lerp(-0.85, 0.85, hj(1)), amp = lerp(0.08, 0.35, hj(2)), fr = lerp(0.6, 1.8, hj(3)), ph = hj(4) * TAU;
    const len = lerp(0.6, 1.4, hj(5));
    const rate = lerp(0.25, 0.6, hj(6)) * speed;
    const cyc = t * rate + hj(7), ci = Math.floor(cyc), f = cyc - ci;
    const uc = lerp(-1.2 - len * 0.5, 1.2 + len * 0.5, f);
    const vv = v0 + (hash2(seed + j, ci) - 0.5) * 0.4;
    const gp = [];
    let e = 0;
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const u = uc - len * 0.5 + len * (i / N);
      const v = (vv + amp * Math.sin(u * fr * Math.PI + ph + t * 0.8)) * funW(u);
      const p = L2S(u, v);
      gp.push(p.x, p.y);
      e += env(u, v);
    }
    e /= N + 1;
    const fe = Math.pow(Math.sin(Math.PI * f), 0.6);
    if (e * fe < 0.02) continue;
    const w = wv * lerp(0.7, 1.3, hj(8));
    const tree = boltTree(seedMix(seed * 31 + j, step), null, null, { guide: gp, jitter: 0.14, branches: 0.5, depth: 1, minSeg: Math.max(6, w * 3) });
    renderTree(ctx, tree, P, w, k * e * fe * 0.9, { taperIn: 0.25, taperOut: 0.25, under, underK: 0.6 });
  }
  // ---- short crackling veins (boil, flicker cycles), concentrated toward the contact end ----
  const nv = Math.round(60 * dens * (o.veins ?? 1));
  for (let j = 0; j < nv; j++) {
    const per = 2 + Math.floor(hash2(seed + 3, j) * 3);
    const cyc = Math.floor((step + j) / per), age = step + j - cyc * per;
    const hc = (q) => hash3(seed * 13 + j, cyc, q);
    if (hc(0) < 0.15) continue;
    const u = 1 - 2 * Math.pow(hc(1), 1.8) * 0.98;
    const v = (hc(2) * 2 - 1) * 0.95 * funW(u);
    const L = lerp(0.04, 0.18, hc(3));
    const a2 = (hc(4) - 0.5) * 1.8;
    const A = L2S(u, v), B = L2S(u + Math.cos(a2) * L, v + Math.sin(a2) * L * (rx / ry) * 0.6);
    const kk = k * env(u, v) * Math.pow(0.55, age);
    if (kk < 0.02) continue;
    lightningBolt(S, ctx, { a: A, b: B, color: P, seed: seed * 101 + j * 7 + cyc, tb: step / 24, width: wv * lerp(0.55, 1.1, hc(5)), branches: 0.8, jitter: 0.32, depth: 2, k: kk, flicker: 0.1, glints: 0.35, flareB: hc(6) < 0.2 ? 0.35 : 0, shake: o.shake ?? true, under: under || false, underK: 0.55 });
  }
  // ---- glitter ----
  const ng = Math.round(350 * dens * (o.glitter ?? 1));
  for (let i = 0; i < ng; i++) {
    const hq = (q) => hash3(seed + 5, i + step * 211, q);
    const u = 1 - 2 * Math.pow(hq(1), 1.25);
    const v = (hq(2) * 2 - 1) * 1.05 * lerp(funW(u), 1, 0.35);
    const p = L2S(u, v);
    const al = k * env(u, v) * lerp(0.3, 1, hq(3));
    if (al < 0.02) continue;
    const sz = lerp(1, 2.5, hq(4) ** 2.5) * Math.max(0.6, px);
    if (hq(5) < 0.04) starGlint(ctx, p.x, p.y, sz * 5, P, al);
    else { ctx.fillStyle = rgba(hq(6) < 0.35 ? P.core : hq(6) < 0.7 ? P.hot : P.mid, clamp(al, 0, 1)); ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz); }
  }
  ctx.restore();
}
