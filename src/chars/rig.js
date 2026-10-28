// Shared 2D character rig + anime cel-shading toolkit (builder B).
// Characters are drawn in "canonical" local metres: x forward (facing right), y DOWN, origin at the
// ground point between the feet. facing=-1 mirrors the whole drawing. Parts are closed Path2D
// silhouettes skinned to bone frames; every part is drawn ink-under-fill (stroke 2*w then fill) so
// only the outer half of the line survives, giving clean overlaps like real key-frame line art.
//
// Shading model (satsuei style):
//  - per part: base fill, hard shadow = thin crescent away from the key light + optional big
//    terminator mass (o.term / o.termP), thin sheen glint, explicit shadow / highlight shapes;
//  - inner lines use the material's colour-trace 'line' colour, only contours are navy ink;
//  - rim light is applied ONCE per character on its outer silhouette (endChar), not per part;
//  - aura = directional, noise-broken outline glow boiling at 24 fps.
import { TAU, clamp, lerp, smoothstep, rgba, noise2, fbm2, angLerp, hash1, hash2 } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';

export const INK = [13, 15, 34];
export const INKS = rgba(INK);

// ------------------------------------------------------------------ frames
export class Fr {
  constructor(x, y, a, k = 1) { this.x = x; this.y = y; this.a = a; this.k = k; this.c = Math.cos(a) * k; this.s = Math.sin(a) * k; }
  p(u, v) { return { x: this.x + u * this.c - v * this.s, y: this.y + u * this.s + v * this.c }; }
  d(u, v) { return { x: u * this.c - v * this.s, y: u * this.s + v * this.c }; }
}
export const fr = (pt, a, k = 1) => new Fr(pt.x, pt.y, a, k);
export const pt = (x, y) => ({ x, y });
export const plerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const padd = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const pdist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const pang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const dirv = (a, l = 1) => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });

// two-bone IK: root a, target b, bone lengths, bend = +1/-1 picks the elbow side
export function ik2(a, b, l1, l2, bend) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy) || 1e-6;
  const maxd = (l1 + l2) * 0.998, mind = Math.abs(l1 - l2) + 0.02;
  let e = b;
  if (d > maxd) { e = { x: a.x + dx / d * maxd, y: a.y + dy / d * maxd }; d = maxd; }
  if (d < mind) { e = { x: a.x + dx / d * mind, y: a.y + dy / d * mind }; d = mind; }
  const ang = Math.atan2(dy, dx);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ja = ang + bend * A;
  return { j: { x: a.x + Math.cos(ja) * l1, y: a.y + Math.sin(ja) * l1 }, e };
}

// ------------------------------------------------------------------ poses
// pose spec: string name, raw object, or blend {a, b, k} (nestable).
// steps > 0 quantises every blend factor to 1/steps ("drawn on twos": key -> breakdowns -> key).
export function resolvePose(table, spec, steps = 0) {
  if (typeof spec === 'string') return table[spec] || table.stand;
  if (spec && spec.a !== undefined && spec.b !== undefined) {
    let k = clamp(spec.k ?? 0.5, 0, 1.25);
    if (steps > 0 && spec.smooth !== true) k = Math.round(k * steps) / steps;
    return blendPose(resolvePose(table, spec.a, steps), resolvePose(table, spec.b, steps), k);
  }
  if (spec && typeof spec === 'object') return spec;
  return table.stand;
}
export function blendPose(A, B, k) {
  const out = {};
  for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const a = A[key], b = B[key];
    if (a === undefined) { out[key] = b; continue; }
    if (b === undefined) { out[key] = a; continue; }
    if (typeof a === 'number' && typeof b === 'number') out[key] = a + (b - a) * k;
    else if (Array.isArray(a) && Array.isArray(b) && typeof a[0] === 'number' && typeof b[0] === 'number') out[key] = a.map((v, i) => v + (b[i] - v) * k);
    else if (isTarget(a) && isTarget(b)) out[key] = (a === b) ? a : { mix: [a, b, clamp(k)] };
    else out[key] = k < 0.5 ? a : b;
  }
  return out;
}
const isTarget = (v) => typeof v === 'string' || (Array.isArray(v) && typeof v[0] === 'number') || (v && v.mix);
// resolve a hand/foot target: [x,y] | 'anchorName' | {mix:[a,b,k]}
export function target(v, anchors) {
  if (Array.isArray(v)) return { x: v[0], y: v[1] };
  if (typeof v === 'string') return anchors[v] ? { x: anchors[v].x, y: anchors[v].y } : { x: 0, y: -1 };
  if (v && v.mix) return plerp(target(v.mix[0], anchors), target(v.mix[1], anchors), v.mix[2]);
  return { x: 0, y: -1 };
}
// is this pose spec a plain idle pose (for default "on twos" secondary motion)?
export function isIdle(spec, idle = ['stand', 'float']) { return spec === undefined || (typeof spec === 'string' && idle.includes(spec)); }

// ------------------------------------------------------------------ curves
export function crp(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}
// open Catmull-Rom resample
export function spline(pts, per = 6) {
  const n = pts.length;
  if (n < 3) { if (n === 2) { const o = []; for (let i = 0; i <= per; i++) o.push(plerp(pts[0], pts[1], i / per)); return o; } return pts.slice(); }
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < per; j++) out.push(crp(p0, p1, p2, p3, j / per));
  }
  out.push(pts[n - 1]);
  return out;
}
// closed smooth Path2D through points (Catmull-Rom -> cubic bezier)
export function closedPath(pts, tension = 1, path = new Path2D()) {
  const n = pts.length;
  if (n < 3) return path;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const k = tension / 6;
    path.bezierCurveTo(p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k, p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k, p2.x, p2.y);
  }
  path.closePath();
  return path;
}
// smooth path where points flagged {sharp:true} become corners
export function mixedPath(pts, tension = 1, path = new Path2D()) {
  const n = pts.length;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const p0 = p1.sharp ? p1 : pts[(i - 1 + n) % n], p3 = p2.sharp ? p2 : pts[(i + 2) % n];
    const k = tension / 6;
    path.bezierCurveTo(p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k, p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k, p2.x, p2.y);
  }
  path.closePath();
  return path;
}
export function polyP(pts, closed = true) {
  const p = new Path2D();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  if (closed) p.closePath();
  return p;
}
// piecewise-linear profile from keys [[s,w],...]
export function prof(keys) {
  return (s) => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (s <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return lerp(a[1], b[1], (s - a[0]) / (b[0] - a[0] || 1)); }
    return keys[keys.length - 1][1];
  };
}
// limb outline along a polyline of joints. wA = width on the side of n=(-dy,dx) (the "back" for a
// downward limb facing right), wB the other side. s runs 0..1 along the sampled spline.
// returns outline point list (closed), plus side arrays for detail work
export function limb(joints, wA, wB, o = {}) {
  const per = o.per || 7;
  const sp = spline(joints, per);
  const n = sp.length;
  const A = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const s = i / (n - 1);
    const wa = typeof wA === 'function' ? wA(s) : wA, wb = typeof wB === 'function' ? wB(s) : wB;
    A.push({ x: sp[i].x - dy * wa, y: sp[i].y + dx * wa });
    B.push({ x: sp[i].x + dy * wb, y: sp[i].y - dx * wb });
  }
  const out = A.slice();
  // end cap
  const e = sp[n - 1], e0 = sp[n - 2];
  const ed = { x: e.x - e0.x, y: e.y - e0.y }; const el = Math.hypot(ed.x, ed.y) || 1;
  const capE = o.capEnd ?? 0.5;
  if (capE > 0) { const w = (pdist(A[n - 1], e) + pdist(B[n - 1], e)) * 0.5; out.push({ x: e.x + ed.x / el * w * capE, y: e.y + ed.y / el * w * capE }); }
  for (let i = n - 1; i >= 0; i--) out.push(B[i]);
  const s0 = sp[0], s1 = sp[1];
  const sd = { x: s0.x - s1.x, y: s0.y - s1.y }; const sl = Math.hypot(sd.x, sd.y) || 1;
  const capS = o.capStart ?? 0.5;
  if (capS > 0) { const w = (pdist(A[0], s0) + pdist(B[0], s0)) * 0.5; out.push({ x: s0.x + sd.x / sl * w * capS, y: s0.y + sd.y / sl * w * capS }); }
  return { pts: out, A, B, sp };
}
// Big designed shadow mass for a limb: the half of the limb facing away from the key light, cut
// along a line frac of the way across (0.5 = half the limb in shadow). Curves with the limb.
export function limbShade(R, lm, frac = 0.45, i0 = 0, i1 = -1) {
  const l = R.light;
  const n = lm.sp.length; if (i1 < 0) i1 = n - 1;
  const far = [], cut = [];
  for (let i = i0; i <= i1; i++) {
    const a = lm.A[i], b = lm.B[i], c = lm.sp[i];
    const da = (a.x - c.x) * l.x + (a.y - c.y) * l.y, db = (b.x - c.x) * l.x + (b.y - c.y) * l.y;
    const f = da < db ? a : b, nr = da < db ? b : a;
    // how much the limb side faces the light (0 when the limb axis points at the light)
    const side = Math.min(1, Math.abs(da - db) / (pdist(a, b) || 1));
    const k = frac * (0.25 + 0.75 * side);
    far.push(padd(f, { x: f.x - c.x, y: f.y - c.y }, 0.6));
    cut.push(plerp(f, nr, k));
  }
  const p = new Path2D();
  p.moveTo(far[0].x, far[0].y);
  for (let i = 1; i < far.length; i++) p.lineTo(far[i].x, far[i].y);
  // smooth terminator line (Catmull-Rom through the cut points, reversed)
  const cs = spline(cut.slice().reverse(), 2);
  for (const q of cs) p.lineTo(q.x, q.y);
  p.closePath();
  return p;
}

// ------------------------------------------------------------------ cloth chains
// Deterministic "verlet-like" chain: segment angles ease from the root direction a0 to the hang
// direction (gravity + wind) and carry travelling sine/noise waves toward the tip.
export function hangAngle(wind, grav = 1) { return Math.atan2(grav + (wind.y || 0), wind.x || 0); }
export function chain(root, n, segLen, o) {
  const pts = [{ x: root.x, y: root.y }];
  let x = root.x, y = root.y;
  const amp = o.amp ?? 0.25, freq = o.freq ?? 1.2, kk = o.k ?? 5, seed = o.seed ?? 0, t = o.t ?? 0;
  const stiff = o.stiff ?? 0.45, ampPow = o.ampPow ?? 1.2;
  let prev = o.a0;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    let a = angLerp(o.a0, o.hang, smoothstep(0, stiff, f));
    const ph = TAU * freq * t - f * kk + seed;
    const env = Math.pow(f, ampPow);
    a += amp * env * (Math.sin(ph) + 0.42 * Math.sin(1.93 * ph + 1.3 + seed * 0.7) + 0.5 * noise2(seed * 3.1 + f * 2.2, t * freq * 0.8));
    // static shape bias: curve > 0 bends the chain into a C (curveF 1) or S (curveF 2) along its length
    if (o.curve) a += o.curve * Math.sin(Math.PI * f * (o.curveF ?? 1));
    if (o.maxBend) { const d = ((a - prev + Math.PI) % TAU + TAU) % TAU - Math.PI; if (Math.abs(d) > o.maxBend) a = prev + Math.sign(d) * o.maxBend; }
    prev = a;
    const sl = segLen * (o.lenMod ? o.lenMod(f) : 1);
    x += Math.cos(a) * sl; y += Math.sin(a) * sl;
    if (o.collide) { const q = o.collide({ x, y }, f); if (q) { x = q.x; y = q.y; prev = Math.atan2(y - pts[i - 1].y, x - pts[i - 1].x); } }
    if (o.ground != null && y > o.ground) { y = o.ground; }
    pts.push({ x, y });
  }
  return pts;
}

// push a point out of a capsule (segment a-b, radius r); returns null when outside
export function capsulePush(p, a, b, r) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1));
  const cx = a.x + abx * t, cy = a.y + aby * t;
  const dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy);
  if (d >= r) return null;
  if (d < 1e-6) return { x: cx + r, y: cy };
  return { x: cx + dx / d * r, y: cy + dy / d * r };
}

// ------------------------------------------------------------------ curved-spike contours (hair)
// nodes: [{x,y,b}] — quadratic segment from previous node to this node bulges by b along the
// outward normal (b>0 convex, b<0 concave). Contour orientation: ccw on screen when ccw=true.
export function curvePath(nodes, ccw = true, path = new Path2D()) {
  const n = nodes.length;
  path.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i <= n; i++) {
    const a = nodes[i - 1], b = nodes[i % n];
    const dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1;
    const nx = ccw ? -dy / l : dy / l, ny = ccw ? dx / l : -dx / l;
    const k = b.b || 0;
    path.quadraticCurveTo((a.x + b.x) / 2 + nx * k, (a.y + b.y) / 2 + ny * k, b.x, b.y);
  }
  path.closePath();
  return path;
}

// ------------------------------------------------------------------ materials
// base / shade / hi: [r,g,b]. o.line: colour-trace for inner lines (default shade * 0.6),
// o.deep: darkest accent, o.sheen: lit-edge glint colour (default: 25% toward cool grey on dark mats)
export function mat(base, shade, hi = null, o = {}) {
  const lum = (base[0] + base[1] + base[2]) / 765;
  const sheen = o.sheen !== undefined ? o.sheen : (lum < 0.35 ? base.map((v, i) => v + ([118, 128, 196][i] - v) * 0.25) : null);
  const line = o.line || shade.map((v) => v * 0.6);
  return {
    base, shade, hi, line, b: rgba(base), s: rgba(shade), h: hi ? rgba(hi) : null, l: rgba(line),
    deep: o.deep ? rgba(o.deep) : rgba(shade.map((v) => v * 0.7)), deepRGB: o.deep || shade.map((v) => v * 0.7),
    rimMul: o.rimMul ?? 1, emitMul: o.emitMul ?? 1, gloss: o.gloss ?? 0, sh: sheen ? rgba(sheen) : null,
  };
}

// ------------------------------------------------------------------ render context / layers
let LAY = null;
function layers(W, H) {
  if (LAY && LAY.W === W && LAY.H === H) return LAY;
  const mk = () => { const c = makeCanvas(W, H); return { c, x: c.getContext('2d') }; };
  LAY = { W, H, sc: mk(), em: mk(), tmp: mk(), tmp2: mk(), dirty: { x: 0, y: 0, w: W, h: H } };
  return LAY;
}
// boil noise for the aura (512^2, drawn x4): blotchy alpha mask, generated once
let NOISE = null;
function noiseCanvas() {
  if (NOISE) return NOISE;
  const N = 512, c = makeCanvas(N, N), x = c.getContext('2d');
  const img = x.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = fbm2(i / 22, j / 22, 3) + 0.35 * noise2(i / 5.5, j / 5.5);
    const a = smoothstep(-0.12, 0.32, v);
    const k = (j * N + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = (a * 255) | 0;
  }
  x.putImageData(img, 0, 0);
  NOISE = c;
  return c;
}
const BIG = (() => { const p = new Path2D(); p.rect(-60, -60, 120, 120); return p; })();
// fill (path) minus (path shifted by dx,dy). Must be called with clip(path) active.
function crescent(ctx, path, dx, dy) {
  const p = new Path2D(BIG);
  p.addPath(path, new DOMMatrix([1, 0, 0, 1, dx, dy]));
  ctx.fill(p, 'evenodd');
}
// region = everything except poly (for rimClip)
export function outside(poly) { const p = new Path2D(BIG); p.addPath(closedPath(poly, 1)); return p; }
// region = everything except an existing Path2D (clip with 'evenodd')
export function outsidePath(path) { const p = new Path2D(BIG); p.addPath(path); return p; }
export function vn(v) { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
// terminator half-plane: the part of pts' extent (along the key light) farther than `frac` from the
// dark side is lit; everything nearer the dark side is shadow. bend > 0 curves the terminator.
export function termPath(R, pts, frac = 0.4, bend = 0.1) {
  const l = R.light;
  let mn = Infinity, mx = -Infinity, cx = 0, cy = 0;
  for (const p of pts) { const d = p.x * l.x + p.y * l.y; if (d < mn) mn = d; if (d > mx) mx = d; cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const ext = Math.max(1e-3, mx - mn);
  const b = mn + frac * ext;
  const dc = cx * l.x + cy * l.y;
  const q = { x: cx + l.x * (b - dc), y: cy + l.y * (b - dc) };
  const tg = { x: -l.y, y: l.x };
  const L = ext * 4 + 1;
  const p = new Path2D();
  p.moveTo(q.x + tg.x * L - l.x * L, q.y + tg.y * L - l.y * L);
  p.lineTo(q.x + tg.x * L, q.y + tg.y * L);
  for (let i = 0; i <= 10; i++) {
    const s = lerp(1, -1, i / 10) * ext;
    const bu = bend * ext * (1 - (s / ext) ** 2);
    p.lineTo(q.x + tg.x * s + l.x * bu, q.y + tg.y * s + l.y * bu);
  }
  p.lineTo(q.x - tg.x * L, q.y - tg.y * L);
  p.lineTo(q.x - tg.x * L - l.x * L, q.y - tg.y * L - l.y * L);
  p.closePath();
  return p;
}

/**
 * Begin drawing a character. Returns render context R or null if behind camera.
 * heightM: nominal character height (for line weight scaling).
 */
export function beginChar(S, o, heightM) {
  const L = layers(S.W, S.H);
  for (const k of ['sc', 'em']) { const x = L[k].x; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, S.W, S.H); }
  const x = o.x ?? 0, y = o.y ?? 0, z = o.z ?? 0, facing = (o.facing ?? 1) < 0 ? -1 : 1;
  const p = S.cam.toLocal(L.sc.x, x, y, z);
  if (!p) return null;
  S.cam.toLocal(L.em.x, x, y, z);
  const sc = o.scale ?? 1;
  L.sc.x.scale(facing * sc, sc); L.em.x.scale(facing * sc, sc);
  const s = p.s * sc;
  const hpx = s * heightM;
  // line weights (in local metres): ~1.6px at 250px tall, ~2.2px at 700px tall
  const k = clamp(hpx / 700, 0.25, 2.2);
  const linePx = (o.lineScale ?? 1) * (0.6 + 1.55 * Math.sqrt(k));
  const toLocalDir = (dd) => vn({ x: (dd.x ?? 0) * facing, y: dd.y ?? 0 });
  const rims = [];
  const rimA = o.rimA === undefined ? { color: [70, 190, 255], dir: { x: -1, y: -0.35 }, k: 1 } : o.rimA;
  const rimB = o.rimB === undefined ? { color: [255, 50, 95], dir: { x: 1, y: -0.3 }, k: 0.6 } : o.rimB;
  for (const r of [rimA, rimB]) if (r && (r.k ?? 1) > 0) {
    const c = typeof r.color === 'string' ? hexRGB(r.color) : (r.color || [255, 255, 255]);
    rims.push({ d: toLocalDir(r.dir || { x: -1, y: 0 }), col: c, k: r.k ?? 1 });
  }
  const sil = clamp(o.silhouette ?? 0);
  const scrFoot = S.cam.project(x, y, z), scrHead = S.cam.project(x, y - heightM * sc, z) || { x: scrFoot.x, y: scrFoot.y - hpx };
  // screen-space working rectangle (generous: long scarves / coat tails / blades)
  const hh = Math.max(8, Math.abs(scrFoot.y - scrHead.y));
  const cxs = (scrFoot.x + scrHead.x) / 2;
  const bx0 = Math.max(0, Math.floor(cxs - hh * 2.3)), bx1 = Math.min(S.W, Math.ceil(cxs + hh * 2.3));
  const by0 = Math.max(0, Math.floor(scrHead.y - hh * 1.35)), by1 = Math.min(S.H, Math.ceil(scrFoot.y + hh * 0.7));
  const bb = { x: bx0, y: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) };
  // secondary-motion clock: anime "ones" (24 fps) by default, "twos" (12) for idle poses.
  // o.step: explicit fps (0 = smooth 60 fps).
  // o.hold = n (2|3): hold every drawing for n frames of 24 fps (impact "on twos/threes")
  let tt = o.t ?? S.t;
  if (o.hold > 1) tt = Math.floor(tt * 24 / o.hold + 1e-6) * o.hold / 24;
  const step = o.step ?? (o._idle ? 12 : 24);
  const R = {
    scrFoot, scrHead, bb, rimsScreen: [rimA, rimB].filter((r) => r && (r.k ?? 1) > 0).map((r) => ({ d: vn(r.dir || { x: -1, y: 0 }), col: typeof r.color === 'string' ? hexRGB(r.color) : (r.color || [255, 255, 255]), k: r.k ?? 1 })),
    S, L, c: L.sc.x, e: L.em.x, s, px: 1 / s, hpx, facing,
    t: step > 0 ? Math.floor(tt * step + 0.5) / step : tt,   // half-step phase: no boundary inside a shutter
    lw: linePx / s, lwIn: linePx * 0.62 / s,
    light: toLocalDir(o.light || { x: -0.55, y: -0.83 }),
    rims, rimW: Math.max(1.7 / s, 0.0075 * Math.sqrt(k) + 0.9 / s),
    emitK: (o.emitK ?? 1) * (1 - sil), sil,
    wind: { x: (o.wind?.x ?? 0) * facing, y: o.wind?.y ?? 0 },
    eyeGlow: o.eyeGlow ?? 0.8, aura: o.aura ?? 0,
    detail: hpx > 300 ? 1 : hpx > 170 ? 0.6 : 0.3,
    body: null,
  };
  R.e.globalCompositeOperation = 'lighter';
  return R;
}

export function hexRGB(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export const toRGB = (c) => (typeof c === 'string' ? hexRGB(c) : c);

/**
 * Cel-shaded part: ink under fill, base, hard shadow crescent (away from key light), optional
 * terminator shadow mass (o.term + o.termPts | o.termP), thin sheen glint, explicit
 * shadow/highlight shapes, faint inner rim (o.rimInner to make it a real, emitting rim edge),
 * occluding emission below.
 */
export function part(R, path, m, o = {}) {
  const c = R.c, e = R.e;
  const lw = (o.lw ?? 1) * R.lw;
  if (o.line !== false && lw > 0) {
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = o.lineCol || INKS;
    c.lineWidth = lw * 2;
    c.stroke(path);
    // heavier line on the shadow side
    c.save(); c.translate(-R.light.x * lw * 0.5, -R.light.y * lw * 0.5); c.stroke(path); c.restore();
  }
  c.fillStyle = m.b; c.fill(path);
  // this part occludes emission drawn earlier for parts behind it
  e.save(); e.globalCompositeOperation = 'destination-out'; e.fillStyle = '#000'; e.fill(path); e.restore();
  c.save(); c.clip(path);
  const sw = o.shadeW ?? 0.03;
  if (m.s) {
    c.fillStyle = m.s;
    if (sw > 0) crescent(c, path, R.light.x * sw, R.light.y * sw);
    if (o.termP) c.fill(o.termP);
    else if (o.term && o.termPts) c.fill(termPath(R, o.termPts, o.term, o.termBend ?? 0.12));
  }
  // lit-edge sheen (dark materials): thin glint on the side facing the key light
  if (m.sh && (o.sheen ?? 1) > 0) { const w = Math.max(R.px * 1.3, (o.sheenW ?? 0.006)) * (o.sheen ?? 1); c.fillStyle = m.sh; crescent(c, path, -R.light.x * w, -R.light.y * w); }
  if (o.shadows) { c.fillStyle = m.s; for (const sp of o.shadows) if (sp) c.fill(sp); }
  if (o.deep) { c.fillStyle = m.deep; for (const sp of o.deep) if (sp) c.fill(sp); }
  if (o.his && m.h) { c.fillStyle = m.h; for (const hp of o.his) if (hp) c.fill(hp); }
  if (o.after) o.after(c);
  // inner rim: faint by default (the real rim is the silhouette pass in endChar)
  const inner = o.rimInner !== undefined;
  const rimMul = (inner ? o.rimInner : 0.14) * (o.rimK ?? 1) * m.rimMul;
  if (o.rimClip) { c.clip(o.rimClip, 'evenodd'); }
  if (rimMul > 0.01) {
    for (const r of R.rims) {
      const w = R.rimW * (o.rimW ?? 1) * (0.6 + 0.4 * r.k);
      const lum = (m.base[0] + m.base[1] + m.base[2]) / 765;
      const rc = r.col.map((v) => v + (255 - v) * (0.3 + 0.5 * lum));
      c.globalAlpha = clamp(0.9 * r.k * rimMul);
      c.fillStyle = rgba(rc);
      crescent(c, path, -r.d.x * w, -r.d.y * w);
      c.globalAlpha = 1;
      const ek = inner ? R.emitK * r.k * rimMul * m.emitMul * 0.3 : 0;
      if (ek > 0.01) {
        e.save(); e.clip(path); if (o.rimClip) e.clip(o.rimClip, 'evenodd'); e.globalAlpha = clamp(ek); e.fillStyle = rgba(r.col); crescent(e, path, -r.d.x * w * 0.9, -r.d.y * w * 0.9); e.restore();
      }
    }
  }
  c.restore();
}
// shadow cast by `caster` onto `targetPath`, offset away from the key light by dist metres
export function castShadow(R, targetPath, caster, dist, col, alpha = 1, exclude = null) {
  const c = R.c;
  c.save(); c.clip(targetPath);
  if (exclude) { const p = new Path2D(BIG); p.addPath(exclude); c.clip(p, 'evenodd'); }
  c.globalAlpha = alpha; c.fillStyle = typeof col === 'string' ? col : rgba(col);
  c.translate(-R.light.x * dist, -R.light.y * dist);
  c.fill(caster);
  c.restore();
}

// flat fill (no ink) helper
export function flat(R, path, color, alpha = 1) { const c = R.c; c.globalAlpha = alpha; c.fillStyle = typeof color === 'string' ? color : rgba(color); c.fill(path); c.globalAlpha = 1; }

// tapered ink line (filled ribbon). taper: 'both' | 'start' | 'end' | 'none'
export function ink(R, pts, w, o = {}) {
  if (pts.length < 2) return;
  const sp = pts.length > 2 ? spline(pts, o.per || 4) : spline(pts, 4);
  const n = sp.length;
  const taper = o.taper || 'both';
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const s = i / (n - 1);
    let k = 1;
    if (taper === 'both') k = Math.pow(Math.sin(Math.PI * clamp(s * 0.94 + 0.03)), 0.6);
    else if (taper === 'end') k = Math.pow(1 - s, 0.7) * 0.95 + 0.05 * (1 - s);
    else if (taper === 'start') k = Math.pow(s, 0.7);
    const ww = w * 0.5 * k;
    L.push({ x: sp[i].x - dy * ww, y: sp[i].y + dx * ww });
    Rr.push({ x: sp[i].x + dy * ww, y: sp[i].y - dx * ww });
  }
  const p = new Path2D();
  p.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < n; i++) p.lineTo(L[i].x, L[i].y);
  for (let i = n - 1; i >= 0; i--) p.lineTo(Rr[i].x, Rr[i].y);
  p.closePath();
  const ctx = o.ctx || R.c;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = o.col ? (typeof o.col === 'string' ? o.col : rgba(o.col)) : INKS;
  ctx.fill(p);
  ctx.globalAlpha = 1;
  return p;
}

// emission helpers (into R.e, additive)
export function emitFill(R, path, col, a = 1) {
  if (R.emitK <= 0) return;
  R.e.globalAlpha = clamp(a * R.emitK); R.e.fillStyle = typeof col === 'string' ? col : rgba(col); R.e.fill(path); R.e.globalAlpha = 1;
}
export function emitStroke(R, path, col, w, a = 1) {
  if (R.emitK <= 0) return;
  const e = R.e; e.globalAlpha = clamp(a * R.emitK); e.strokeStyle = typeof col === 'string' ? col : rgba(col); e.lineWidth = w; e.lineCap = 'round'; e.lineJoin = 'round'; e.stroke(path); e.globalAlpha = 1;
}

// ------------------------------------------------------------------ anime eye
// Almond eye in a local frame (u forward, v down). o: {w,h (metres), col glow colour, glow 0..1, lash, look, side:'near'|'far', fem}
export function drawEye(R, F, cx, cy, o) {
  const c = R.c;
  const w = o.w, h = o.h, glow = o.glow ?? 1;
  const dir = o.inner ?? 1; // +1: inner corner toward +u
  const tilt = o.tilt ?? 0.12; // outer corner raised (sharp look)
  const open = o.open ?? 1;
  const P = (u, v) => F.p(cx + u * w * dir, cy + (v * open + (1 - open) * 0.1) * h + u * tilt * h);
  // almond: outer corner (-0.5), inner (+0.5)
  const O = P(-0.5, 0.08), I = P(0.5, 0.02);
  const t1 = P(-0.32, -0.52), t2 = P(0.22, -0.66), b1 = P(0.32, 0.5), b2 = P(-0.22, 0.52);
  const alm = new Path2D();
  alm.moveTo(O.x, O.y); alm.bezierCurveTo(t1.x, t1.y, t2.x, t2.y, I.x, I.y); alm.bezierCurveTo(b1.x, b1.y, b2.x, b2.y, O.x, O.y); alm.closePath();
  c.fillStyle = rgba(o.white || [228, 234, 250]); c.fill(alm);
  const col = o.col;
  const look = o.look ?? 0;
  c.save(); c.clip(alm);
  // iris: tall ellipse filling most of the opening
  const ic = P(0.04 + look, 0.06);
  const kk = F.k || 1;
  const ry = h * kk * 0.66 * (o.irisK ?? 1), rx = Math.min(ry * 0.78, w * kk * 0.3);
  const irisP = new Path2D(); irisP.ellipse(ic.x, ic.y, rx, ry, F.a, 0, TAU);
  c.fillStyle = rgba(col.map((v) => v * 0.3)); c.fill(irisP);
  const irisIn = new Path2D(); irisIn.ellipse(ic.x, ic.y + ry * 0.18, rx * 0.8, ry * 0.7, F.a, 0, TAU);
  c.fillStyle = rgba(col.map((v) => Math.min(255, v * (0.75 + 0.35 * glow)))); c.fill(irisIn);
  const core = new Path2D(); core.ellipse(ic.x, ic.y + ry * 0.38, rx * 0.5, ry * 0.36, F.a, 0, TAU);
  c.fillStyle = rgba(col.map((v) => Math.min(255, v * 0.5 + 140 * (0.5 + 0.5 * glow)))); c.fill(core);
  const pup = new Path2D(); pup.ellipse(ic.x, ic.y - ry * 0.02, rx * 0.3, ry * 0.5, F.a, 0, TAU);
  c.fillStyle = rgba(col.map((v) => v * 0.1)); c.fill(pup);
  // upper-lid shadow band across the eye
  const ls = new Path2D(); ls.moveTo(O.x, O.y); ls.bezierCurveTo(t1.x, t1.y, t2.x, t2.y, I.x, I.y);
  const q = P(0.5, -0.12), q2 = P(-0.5, -0.06); ls.lineTo(q.x, q.y); ls.lineTo(q2.x, q2.y); ls.closePath();
  c.globalAlpha = 0.6; c.fillStyle = rgba(col.map((v) => v * 0.18)); c.fill(ls); c.globalAlpha = 1;
  // highlights
  const h1 = P(-0.06 + look, -0.22);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.ellipse(h1.x, h1.y, rx * 0.36, ry * 0.26, F.a, 0, TAU); c.fill();
  const h2 = P(0.16 + look, 0.32);
  c.beginPath(); c.ellipse(h2.x, h2.y, rx * 0.16, ry * 0.12, F.a, 0, TAU); c.fill();
  c.restore();
  // upper lash line: heavy, extends past the outer corner, flick
  const lw = (o.lashW ?? 1) * h * kk * 0.36;
  const fl = o.flick ?? 0.25;
  ink(R, [P(-0.66, 0.1 + fl * 0.6), P(-0.5, -0.12), P(-0.3, -0.5), P(0.05, -0.66), P(0.36, -0.5), P(0.54, -0.06)], lw, { taper: 'both' });
  // lower lash (partial, outer half)
  ink(R, [P(-0.48, 0.2), P(-0.2, 0.5), P(0.18, 0.5)], lw * 0.38, { taper: 'both', alpha: 0.9 });
  // double-lid crease
  if (o.crease !== false) ink(R, [P(-0.35, -0.82), P(0.0, -0.98), P(0.3, -0.84)], lw * 0.3, { taper: 'both', alpha: 0.75, col: o.creaseCol });
  if (o.fem) {
    ink(R, [P(-0.5, -0.2), P(-0.68, -0.42), P(-0.76, -0.48)], lw * 0.6, { taper: 'end' });
    ink(R, [P(-0.6, 0.05), P(-0.8, -0.05)], lw * 0.5, { taper: 'end' });
  }
  // emission: iris glow + bright core that survives at small scale (+ glint trail when glow > 1)
  if (glow > 0 && R.emitK > 0) {
    const e = R.e;
    const ek = o.emit ?? 0.9;
    e.save(); e.clip(alm);
    e.globalAlpha = clamp(glow * R.emitK * 0.55 * ek);
    e.fillStyle = rgba(col); e.fill(irisIn);
    e.globalAlpha = clamp(glow * R.emitK * ek);
    e.fillStyle = rgba(col.map((v) => Math.min(255, v * 0.5 + 130))); e.fill(core);
    e.restore();
    const cc = P(0.04 + look, 0.18);
    const r0 = Math.max(rx * 0.5, 1.6 * R.px);
    e.globalAlpha = clamp(glow * R.emitK * 0.85 * ek);
    e.fillStyle = rgba(col.map((v) => Math.min(255, v * 0.6 + 110)));
    e.beginPath(); e.ellipse(cc.x, cc.y, r0, r0 * 1.15, F.a, 0, TAU); e.fill();
    e.globalAlpha = 1;
    if (glow > 1) {
      const g = clamp((glow - 1) / 0.5);
      const a = P(-0.25, -0.05), b = P(-(1.1 + 2.2 * g), -(0.5 + 0.9 * g));
      ink(R, [a, plerp(a, b, 0.5), b], Math.max(h * kk * 0.55, R.px * 2.2) * g, { ctx: e, col, alpha: 0.85 * g * R.emitK, taper: 'end' });
    }
  }
  return alm;
}

// ------------------------------------------------------------------ hands
// Generic hand in frame F (origin wrist, u toward fingers, v across; thumb on -v side).
// shapes: 'open' (spread palm), 'claw' (flung, fingers splayed & curled), 'relaxed', 'fist'.
// o.k: size scale, o.spread, o.curl, o.gloss (glove highlight)
export function drawHand(R, F, shape, m, o = {}) {
  const k = o.k ?? 1;
  const G = new Fr(F.x, F.y, F.a, (F.k || 1) * k);
  const fingers = [];
  let palm;
  const sp = o.spread ?? 1, cu = o.curl ?? 0;
  // three-phalanx finger; curl distributed 0.25 / 0.45 / 0.30 over the joints
  const finger = (bu, bv, ang, len, w, curl) => {
    const a1 = ang + curl * 0.25, a2 = a1 + curl * 0.45, a3 = a2 + curl * 0.3;
    const p0 = { x: bu, y: bv };
    const p1 = { x: p0.x + Math.cos(a1) * len * 0.44, y: p0.y + Math.sin(a1) * len * 0.44 };
    const p2 = { x: p1.x + Math.cos(a2) * len * 0.32, y: p1.y + Math.sin(a2) * len * 0.32 };
    const p3 = { x: p2.x + Math.cos(a3) * len * 0.24, y: p2.y + Math.sin(a3) * len * 0.24 };
    return [G.p(p0.x, p0.y), G.p(p1.x, p1.y), G.p(p2.x, p2.y), G.p(p3.x, p3.y), w];
  };
  if (shape === 'open' || shape === 'claw') {
    // open: fingers spread but naturally curved (pinky curls most); claw: strongly hooked
    const c = shape === 'claw' ? 0.75 + cu : 0.16 + cu;
    palm = [G.p(-0.004, -0.026), G.p(0.046, -0.034), G.p(0.08, -0.03), G.p(0.088, -0.006), G.p(0.084, 0.022), G.p(0.064, 0.032), G.p(0.03, 0.032), G.p(-0.004, 0.024)];
    fingers.push(finger(0.074, 0.025, 0.34 * sp, 0.058, 0.0155, c * 1.5));
    fingers.push(finger(0.084, 0.009, 0.12 * sp, 0.074, 0.0165, c * 1.15));
    fingers.push(finger(0.087, -0.009, -0.05 * sp, 0.08, 0.0172, c * 0.9));
    fingers.push(finger(0.081, -0.026, -0.22 * sp, 0.072, 0.0165, c * 0.7));
    fingers.push(finger(0.024, -0.03, -0.92 * sp, 0.058, 0.019, 0.25 + c * 0.35));
  } else if (shape === 'fist') {
    palm = [G.p(0, -0.032), G.p(0.06, -0.038), G.p(0.098, -0.028), G.p(0.106, 0.004), G.p(0.096, 0.034), G.p(0.058, 0.04), G.p(0.02, 0.034), G.p(0, 0.028)];
  } else { // relaxed
    palm = [G.p(0, -0.028), G.p(0.05, -0.033), G.p(0.085, -0.026), G.p(0.09, 0.012), G.p(0.07, 0.03), G.p(0.03, 0.032), G.p(0, 0.026)];
    fingers.push(finger(0.078, 0.02, 0.32, 0.054, 0.015, 0.9));
    fingers.push(finger(0.086, 0.006, 0.24, 0.066, 0.016, 0.95));
    fingers.push(finger(0.087, -0.01, 0.16, 0.07, 0.017, 0.9));
    fingers.push(finger(0.082, -0.024, 0.06, 0.064, 0.016, 0.8));
    fingers.push(finger(0.025, -0.028, -0.5, 0.05, 0.019, 0.45));
  }
  const pal = closedPath(palm, 0.9);
  const lwK = o.lw ?? 0.85;
  const fk = (F.k || 1) * k;
  const drawF = (f) => {
    const [a, b, c, d, w] = f;
    const lm = limb([a, b, c, d], (s) => w * fk * (0.56 - 0.22 * s), (s) => w * fk * (0.54 - 0.22 * s), { per: 3, capEnd: 0.9, capStart: 0.3 });
    part(R, closedPath(lm.pts, 1), m, { shadeW: 0.005 * k, lw: lwK, termP: limbShade(R, lm, 0.4) });
    // knuckle creases
    if (R.detail > 0.6 && !o.gloss) for (const q of [b]) { const dd = pang(a, d) + Math.PI / 2; ink(R, [padd(q, dirv(dd, w * fk * 0.3)), padd(q, dirv(dd, -w * fk * 0.3))], R.lwIn * 0.6, { col: m.line, alpha: 0.6 }); }
  };
  for (let i = 0; i < fingers.length - 1; i++) if (i < 2) drawF(fingers[i]);
  part(R, pal, m, { shadeW: 0.012 * k, lw: lwK, his: o.gloss ? [closedPath([G.p(0.01, -0.02), G.p(0.06, -0.026), G.p(0.06, -0.018), G.p(0.01, -0.012)], 0.6)] : null });
  if ((shape === 'open' || shape === 'claw') && R.detail > 0.6) {
    ink(R, [G.p(0.02, -0.012), G.p(0.05, -0.002), G.p(0.07, 0.016)], R.lwIn * 0.8, { col: m.line, alpha: 0.85 });
    ink(R, [G.p(0.045, 0.02), G.p(0.068, 0.006)], R.lwIn * 0.6, { col: m.line, alpha: 0.7 });
  }
  for (let i = 2; i < fingers.length; i++) drawF(fingers[i]);
  if (shape === 'fist') for (const v of [-0.018, 0.0, 0.018]) ink(R, [G.p(0.075, v), G.p(0.1, v + 0.002)], R.lwIn, { alpha: 0.8 });
  return { palmC: G.p(0.05, 0.0), G };
}

// canonical local points -> world metres + screen px (for composing fx on the characters)
export function worldPts(S, o, map) {
  const facing = (o.facing ?? 1) < 0 ? -1 : 1, sc = o.scale ?? 1;
  const ox = o.x ?? 0, oy = o.y ?? 0, oz = o.z ?? 0;
  const out = {};
  for (const k in map) {
    const p = map[k]; if (!p) continue;
    const w = { x: ox + facing * sc * p.x, y: oy + sc * p.y, z: oz };
    const s = S.cam.project(w.x, w.y, w.z);
    out[k] = { x: w.x, y: w.y, z: w.z, sx: s ? s.x : NaN, sy: s ? s.y : NaN, s: s ? s.s : 0 };
  }
  return out;
}

// ------------------------------------------------------------------ compositing
const lighten = (c, k) => c.map((v) => v + (255 - v) * k);
function blit(dst, src, bb, dx = 0, dy = 0) { if (bb.w > 0 && bb.h > 0) dst.drawImage(src, bb.x, bb.y, bb.w, bb.h, bb.x + dx, bb.y + dy, bb.w, bb.h); }
const rot = (d, a) => ({ x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) });

export function endChar(S, R, o) {
  const L = R.L;
  const alpha = clamp(o.alpha ?? 1);
  const sil = R.sil;
  const W = S.W, H = S.H, bb = R.bb;
  // body points (local) -> screen, for smear streaks
  let bodyScr = null;
  if (R.body) { const m = L.sc.x.getTransform(); bodyScr = R.body.map((p) => m.transformPoint(new DOMPoint(p.x, p.y))); }
  const x = L.sc.x; x.setTransform(1, 0, 0, 1, 0, 0);
  // compositing grade (satsuei): darker, cooler toward the feet; energy colour bleeding from the rim sides
  const grade = (o.grade ?? 1) * (1 - sil);
  if (grade > 0 && R.scrFoot && R.scrHead) {
    x.save(); x.globalCompositeOperation = 'source-atop';
    x.beginPath(); x.rect(bb.x, bb.y, bb.w, bb.h); x.clip();
    const hy = R.scrHead.y, fy = R.scrFoot.y, h = Math.max(20, fy - hy);
    const cx = (R.scrFoot.x + R.scrHead.x) / 2, cy = (hy + fy) / 2;
    const g = x.createLinearGradient(0, hy - h * 0.1, 0, fy + h * 0.05);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.4, 'rgba(30,24,80,0)'); g.addColorStop(1, `rgba(16,12,52,${0.5 * grade})`);
    x.fillStyle = g; x.fillRect(bb.x, bb.y, bb.w, bb.h);
    const rs = R.rimsScreen;
    for (const r of rs) {
      const ax = cx + r.d.x * h * 0.75, ay = cy + r.d.y * h * 0.75;
      const gr = x.createLinearGradient(ax, ay, cx, cy);
      gr.addColorStop(0, rgba(r.col, 0.35 * Math.min(1, r.k) * grade)); gr.addColorStop(1, rgba(r.col, 0));
      x.fillStyle = gr; x.fillRect(bb.x, bb.y, bb.w, bb.h);
      // bounce of the opposing energy colour on the side away from this rim
      const other = rs.find((q) => q !== r);
      const bcol = other ? other.col : (r.col[2] > r.col[0] ? [255, 46, 96] : [70, 190, 255]);
      const bx = cx - r.d.x * h * 0.7, by = cy - r.d.y * h * 0.35;
      const gb = x.createLinearGradient(bx, by, cx, cy);
      gb.addColorStop(0, rgba(bcol, 0.12 * grade)); gb.addColorStop(1, rgba(bcol, 0));
      x.fillStyle = gb; x.fillRect(bb.x, bb.y, bb.w, bb.h);
    }
    x.restore();
  }
  const t = L.tmp.x, t2 = L.tmp2.x;
  const resetT = (c) => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(bb.x, bb.y, bb.w, bb.h); };
  // silhouette rim light: only the outer contour facing each rim light (crisp, + emission)
  if (sil < 1 && (o.rim ?? 1) > 0) {
    for (const r of R.rimsScreen) {
      // ~2.6 px at 350 px tall, ~3.8 px at 700 px, capped at 6.5 px for close-ups
      const w = clamp(1.4 + R.s * 0.0062, 2, 6.5) * (o.rimWidth ?? 1) * (0.75 + 0.25 * Math.min(1, r.k));
      resetT(t);
      blit(t, L.sc.c, bb);
      t.globalCompositeOperation = 'destination-out';
      blit(t, L.sc.c, bb, -r.d.x * w, -r.d.y * w);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = rgba(lighten(r.col, 0.3)); t.fillRect(bb.x, bb.y, bb.w, bb.h);
      x.save(); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = clamp(0.9 * r.k * (o.rim ?? 1) * (1 - sil)); blit(x, L.tmp.c, bb); x.restore();
      if (R.emitK > 0) { const e = L.em.x; e.save(); e.setTransform(1, 0, 0, 1, 0, 0); e.globalCompositeOperation = 'lighter'; e.globalAlpha = clamp(0.5 * r.k * R.emitK * (o.rim ?? 1)); blit(e, L.tmp.c, bb); e.restore(); }
    }
  }
  if (sil > 0) {
    x.globalCompositeOperation = 'source-atop'; x.globalAlpha = sil;
    x.fillStyle = rgba(toRGB(o.silColor || [8, 8, 18])); x.fillRect(bb.x, bb.y, bb.w, bb.h);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  }
  const aura = clamp(o.aura ?? 0);
  const smear = clamp(o.smear ?? 0);
  const glowCol = toRGB(o.auraColor || o.glowColor || [80, 190, 255]);
  const sc = S.L.scene, em = S.L.emit;
  const fac = o.facing ?? 1;
  if ((aura > 0 || smear > 0) && alpha > 0) {
    // tinted silhouette in tmp
    resetT(t);
    blit(t, L.sc.c, bb);
    t.globalCompositeOperation = 'source-in'; t.fillStyle = rgba(glowCol); t.fillRect(bb.x, bb.y, bb.w, bb.h);
    t.globalCompositeOperation = 'source-over';
    if (smear > 0) {
      const dir = vn({ x: -fac * (o.smearDir?.x ?? 1), y: o.smearDir?.y ?? 0 });
      const len = (o.smearLen ?? 1.6) * R.s * smear;
      const hy = R.scrHead.y, fy = R.scrFoot.y, h = Math.max(20, fy - hy);
      const cx = (R.scrFoot.x + R.scrHead.x) / 2, cy = (hy + fy) / 2;
      // anchor at the true leading edge (max extent of the body opposite the trail) so nothing is pushed ahead
      let lead = -Infinity;
      for (const p of (bodyScr && bodyScr.length ? bodyScr : [{ x: cx, y: cy }])) lead = Math.max(lead, -(p.x * dir.x + p.y * dir.y));
      const c0 = -(cx * dir.x + cy * dir.y);
      const anc = { x: cx - dir.x * (lead - c0 + h * 0.08), y: cy - dir.y * (lead - c0 + h * 0.08) };
      const ang = Math.atan2(dir.y, dir.x);
      // 1. stretched energy silhouette into emit (anchored at the leading edge)
      em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
      em.translate(anc.x, anc.y); em.rotate(ang); em.scale(1 + 1.4 * smear, 1 - 0.08 * smear); em.rotate(-ang); em.translate(-anc.x, -anc.y);
      em.globalAlpha = clamp(alpha * 0.35 * smear * (1 - sil * 0.6));
      blit(em, L.tmp.c, bb);
      em.restore();
      // 2. two faint deep-blue ghosts in the scene layer
      resetT(t2); blit(t2, L.sc.c, bb); t2.globalCompositeOperation = 'source-in'; t2.fillStyle = rgba([24, 64, 208]); t2.fillRect(bb.x, bb.y, bb.w, bb.h);
      sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 1; i <= 2; i++) { sc.globalAlpha = alpha * 0.12 * smear * (1.2 - i * 0.35); blit(sc, L.tmp2.c, bb, dir.x * len * 0.28 * i, dir.y * len * 0.28 * i); }
      sc.restore();
      // 3. speed streaks from the body (boil at 24 fps): white core over a cyan band
      const tb = Math.floor(S.t * 24 + 0.5);
      const src = bodyScr && bodyScr.length ? bodyScr : [{ x: cx, y: cy }];
      const nS = 20;
      em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter'; em.lineCap = 'round';
      const perp = { x: -dir.y, y: dir.x };
      for (let i = 0; i < nS; i++) {
        const hA = hash2(tb, i * 3.1), hB = hash2(tb + 7.3, i * 1.7), hC = hash2(i * 5.9, tb * 0.37 + 2.1);
        const a = src[Math.floor(hA * src.length) % src.length], b = src[Math.floor(hB * src.length) % src.length];
        const p0 = plerp(a, b, hC);
        const off = (hash2(i, tb + 11) - 0.5) * h * 0.06;
        const sx = p0.x + perp.x * off, sy = p0.y + perp.y * off;
        const l = len * (0.4 + 1.2 * hash2(i * 2.3, tb + 5));
        const wpx = 1 + 3 * hash2(i * 7.7, tb + 3);
        const g = em.createLinearGradient(sx, sy, sx + dir.x * l, sy + dir.y * l);
        g.addColorStop(0, rgba(glowCol, 0)); g.addColorStop(0.15, rgba(glowCol, 0.55 * smear * alpha)); g.addColorStop(1, rgba(glowCol, 0));
        em.strokeStyle = g; em.lineWidth = wpx * 2.6;
        em.beginPath(); em.moveTo(sx, sy); em.lineTo(sx + dir.x * l, sy + dir.y * l); em.stroke();
        const g2 = em.createLinearGradient(sx, sy, sx + dir.x * l * 0.7, sy + dir.y * l * 0.7);
        g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.12, `rgba(240,252,255,${0.85 * smear * alpha})`); g2.addColorStop(1, 'rgba(255,255,255,0)');
        em.strokeStyle = g2; em.lineWidth = Math.max(0.8, wpx * 0.6);
        em.beginPath(); em.moveTo(sx, sy); em.lineTo(sx + dir.x * l * 0.7, sy + dir.y * l * 0.7); em.stroke();
      }
      em.restore();
    }
    if (aura > 0) {
      // directional outline glow (toward each rim light), broken up by boiling noise, minus the body
      resetT(t2);
      const r = clamp(R.s * 0.02, 2, 14);
      const dirs = R.rimsScreen.length ? R.rimsScreen : [{ d: { x: 0, y: -1 }, k: 1 }];
      for (const q of dirs) {
        const d = q.d;
        t2.globalAlpha = clamp(0.55 + 0.45 * q.k);
        for (const off of [vscale(d, r), vscale(d, r * 0.66), vscale(rot(d, 0.5), r), vscale(rot(d, -0.5), r)]) blit(t2, L.tmp.c, bb, off.x, off.y);
      }
      t2.globalAlpha = 1;
      const tb = Math.floor(S.t * 24 + 0.5);
      const nz = noiseCanvas();
      t2.globalCompositeOperation = 'destination-in';
      t2.drawImage(nz, -Math.floor(hash1(tb * 1.31 + 0.7) * 120), -Math.floor(hash1(tb * 2.17 + 3.1) * 120), 2048, 2048);
      t2.globalCompositeOperation = 'destination-out'; blit(t2, L.sc.c, bb);
      t2.globalCompositeOperation = 'source-over';
      em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
      em.globalAlpha = clamp(0.75 * aura * alpha * (1 - sil)); blit(em, L.tmp2.c, bb);
      em.restore();
    }
  }
  sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = alpha; sc.globalCompositeOperation = 'source-over';
  blit(sc, L.sc.c, bb);
  sc.restore();
  if (R.emitK > 0) {
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter'; em.globalAlpha = alpha;
    blit(em, L.em.c, bb);
    em.restore();
  }
}
const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });

// ------------------------------------------------------------------ cloth sheet
// A cloth sheet between two edge chains A (front) and B (back); interior columns are interpolated
// (so the sheet never self-intersects) with S-curving ripples -> fold creases that start part-way
// down and fade before the hem; scalloped hem whose tucked folds reveal the lining.
// o: { m, cols, freq, seed, ripple, shadeW, term (shadow-mass fraction), deepEdge, edgeLining (mat),
//      lining (mat for hem tucks), tuck (m), hemWave (tuck scale), rimK }
export function sheet(R, A, B, o) {
  const n = A.length - 1, m = o.cols ?? 4;
  const seed = o.seed || 0;
  const rip = o.ripple ?? 0.12;
  const cols = [];
  for (let j = 0; j <= m; j++) {
    const s = j / m;
    const col = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      let p = plerp(A[i], B[i], s);
      if (j > 0 && j < m) {
        const w = rip * f * (0.7 * Math.sin(f * Math.PI * 1.5 + j * 1.7 + TAU * (o.freq || 1) * R.t * 0.55 + seed) + 0.45 * Math.sin(j * 4.7 + seed * 1.3));
        p = plerp(A[i], B[i], clamp(s + w / m * 1.7, 0.03, 0.97));
      }
      col.push(p);
    }
    cols.push(col);
  }
  // wavy hem: the hem undulates smoothly (odd columns ride up = folds turning back); only one or two of
  // the raised folds show their lining. No sharp corners -> no sawtooth / grass-skirt read.
  const tuckL = (o.tuck ?? 0.045) * (o.hemWave ?? 1);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push((i === 0 || i === n) ? { ...A[i], sharp: true } : A[i]);
  const tucks = [];
  let nT = 0;
  for (let j = 1; j < m; j++) {
    const a = cols[j][n], pa = cols[j][n - 1];
    const d = pdist(a, pa) || 1;
    const h = hash1(j * 7.3 + seed * 2.9);
    const lift = tuckL > 0 ? tuckL * (j % 2 ? 0.55 + 0.45 * h : 0.12 * h) : 0;
    const up = { x: a.x + (pa.x - a.x) / d * lift, y: a.y + (pa.y - a.y) / d * lift };
    pts.push(up);
    if (j % 2 === 1 && tuckL > 0 && (h > 0.4 || nT === 0) && nT < 2) { tucks.push({ j, up, a }); nT++; }
  }
  for (let i = n; i >= 0; i--) pts.push((i === 0 || i === n) ? { ...B[i], sharp: true } : B[i]);
  const path = mixedPath(pts, 1);
  // fold shadows: wedges beside a few interior columns, starting part-way down, widening toward the hem
  const shadows = [];
  const starts = [];
  const useCol = [];
  for (let j = 1; j < m; j++) {
    const h0 = 0.15 + 0.45 * hash1(j * 3.1 + seed * 7.7);
    const i0 = Math.max(1, Math.floor(n * h0));
    starts[j] = i0;
    useCol[j] = m <= 3 || hash1(j * 5.1 + seed * 1.9) > 0.38 || j === (m >> 1);
    if ((j + (o.odd ? 1 : 0)) % 2 === 0 && m > 2) continue;
    if (!useCol[j] && m > 3) continue;
    const c = cols[j], nx = cols[j + 1];
    const w = [];
    for (let i = i0; i <= n; i++) w.push(c[i]);
    for (let i = n; i >= i0; i--) { const f = (i - i0) / Math.max(1, n - i0); w.push(plerp(c[i], nx[i], 0.55 * Math.pow(f, 0.8))); }
    if (w.length > 3) shadows.push(closedPath(w, 1));
  }
  // deep shadow along the back edge (inside of the fold)
  const deep = [];
  if (o.deepEdge) {
    const w = [];
    for (let i = 1; i <= n; i++) w.push(cols[m][i]);
    for (let i = n; i >= 1; i--) w.push(plerp(cols[m][i], cols[m - 1][i], 0.4 * (i / n)));
    deep.push(closedPath(w, 1));
  }
  part(R, path, o.m, { shadeW: o.shadeW ?? 0.035, shadows, deep, rimK: o.rimK ?? 1, term: o.term ?? 0, termPts: o.term ? A.concat(B) : null, termBend: 0.15 });
  if (o.edgeLining) {
    // inner facing visible along the front edge
    const w = [];
    for (let i = 1; i <= n; i++) w.push(A[i]);
    for (let i = n; i >= 1; i--) w.push(plerp(A[i], cols[1][i], 0.16 + 0.1 * (i / n)));
    const c = R.c; c.save(); c.clip(path); c.fillStyle = o.edgeLining.b; c.fill(closedPath(w, 1)); c.restore();
    ink(R, w.slice(n), R.lwIn * 0.9, { alpha: 0.8, col: o.m.line });
  }
  // hem tucks: where the hem rides up the fold turns under -> a small shadowed turn-back inside the
  // hem (lining tone) and a short fold ink rising from it. Kept inside the silhouette (no torn bits).
  const lin = o.lining || null;
  if (R.detail > 0.3) for (const tk of tucks) {
    const j = tk.j;
    const prev = cols[j - 1][n], next = cols[j + 1] ? cols[j + 1][n] : tk.a;
    const i2 = Math.max(1, n - 2);
    const top = cols[j][i2];
    const turn = [plerp(tk.up, prev, 0.3), plerp(tk.up, top, 0.35), plerp(tk.up, next, 0.36)];
    const c = R.c; c.save(); c.clip(path);
    c.fillStyle = lin ? lin.s : o.m.deep; c.fill(closedPath([...turn, tk.up], 0.6));
    c.restore();
    ink(R, [tk.up, plerp(tk.up, top, 0.6), top], R.lwIn * 1.1, { col: o.m.line, alpha: 0.85, taper: 'start' });
  }
  if (R.detail > 0.3) {
    let drawn = 0;
    for (let j = 1; j < m; j++) {
      if (!useCol[j] || drawn >= 3) continue;
      const c = cols[j];
      const i0 = starts[j] ?? 1;
      const i1 = Math.max(i0 + 2, n - Math.max(1, Math.round(n * (0.05 + 0.12 * hash1(j * 5.3 + seed * 3.3)))));
      ink(R, c.slice(i0, i1 + 1), R.lwIn * 1.25, { taper: 'both', alpha: 0.9, col: o.m.line });
      drawn++;
    }
  }
  cols.path = path;
  return cols;
}
