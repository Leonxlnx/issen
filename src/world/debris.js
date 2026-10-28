// ISSEN — world: floating rock debris (builder A).
//
// Jagged fractured low-poly meshes (shards, slabs, cut blocks, rough rocks: an icosphere carved by
// many planar "fracture" cuts) rendered as real 3D instances in the shared world WebGL2 context:
// near-black stone with hard moon edge highlights, object-space grain, thin hard coloured energy
// rims, short-range energy fill, size-independent inverted-hull line art, unified aerial fog and depth
// of field (near rocks rendered into low-res buffers and blurred). A dense layer of tiny grit specks
// (point sprites with a 1 px lit rim) carries the references' density. Rocks drift upward (wrapping
// inside their box) and tumble; shockwave bursts kick them out with an impulse profile, smear-stretched
// along their screen velocity for the first frames. Everything depth-tests against the ruins / floor.
import { RNG, clamp, lerp, TAU, noise2, noise3 } from '../core/math.js';
import { worldGL, glProgram, glUse, glSet, glTex, glBegin, glFrame, glBlit, GLSL_COMMON, GLSL_DEPTH, ZN, ZF, envSkyUniforms, resolveLight, lin3, _registerWorldHook, FOG_DENSITY } from './ruins.js';

// ---------------------------------------------------------------------------------------
// meshes
// ---------------------------------------------------------------------------------------
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function icosphere(sub = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(k)) return cache.get(k);
      V.push(norm([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2]));
      cache.set(k, V.length - 1);
      return V.length - 1;
    };
    const F2 = [];
    for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  return { V, F };
}
function makeRockMesh(seed, kind) {
  const rng = new RNG(seed);
  const { V, F } = icosphere(2);
  const sc = kind === 'block' ? [rng.range(1.0, 1.4), rng.range(0.6, 0.95), rng.range(0.8, 1.2)]
    : kind === 'slab' ? [rng.range(1.2, 1.6), rng.range(0.18, 0.3), rng.range(0.8, 1.2)]
      : kind === 'shard' ? [rng.range(0.3, 0.45), rng.range(1.7, 2.6), rng.range(0.3, 0.5)]
        : [rng.range(0.8, 1.2), rng.range(0.7, 1.1), rng.range(0.8, 1.2)];
  const off = rng.range(0, 100);
  let P = V.map((v) => {
    const n = noise3(v[0] * 1.6 + off, v[1] * 1.6, v[2] * 1.6);
    const r = 1 + n * 0.1;
    return [v[0] * r * sc[0], v[1] * r * sc[1], v[2] * r * sc[2]];
  });
  const cutAt = (n, frac) => {
    const ext = Math.max(...P.map((p) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2]));
    const d = ext * frac;
    P = P.map((p) => { const k = p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d; return k > 0 ? [p[0] - n[0] * k, p[1] - n[1] * k, p[2] - n[2] * k] : p; });
  };
  // planar fracture cuts -> flat broken facets with hard angular silhouettes
  if (kind === 'block' || kind === 'slab') {
    for (const ax of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) cutAt(norm([ax[0] + rng.range(-0.12, 0.12), ax[1] + rng.range(-0.12, 0.12), ax[2] + rng.range(-0.12, 0.12)]), rng.range(0.55, 0.78));
    const nc = rng.int(4, 8);
    for (let c = 0; c < nc; c++) cutAt(norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]), rng.range(0.42, 0.75));
  } else if (kind === 'shard') {
    // faceted prism (cuts mostly around the long axis) + broken, angled tips
    const nc = rng.int(7, 11);
    for (let c = 0; c < nc; c++) cutAt(norm([rng.range(-1, 1), rng.range(-0.35, 0.35), rng.range(-1, 1)]), rng.range(0.3, 0.65));
    for (const sgn of [-1, 1]) cutAt(norm([rng.range(-0.9, 0.9), sgn * rng.range(0.6, 1.0), rng.range(-0.9, 0.9)]), rng.range(0.5, 0.85));
  } else {
    const nc = rng.int(10, 16);
    for (let c = 0; c < nc; c++) cutAt(norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]), rng.range(0.28, 0.6));
  }
  // normalise to max radius 1
  const mr = Math.max(...P.map((p) => Math.hypot(p[0], p[1], p[2])));
  P = P.map((p) => [p[0] / mr, p[1] / mr, p[2] / mr]);
  const pos = new Float32Array(F.length * 9), nrm = new Float32Array(F.length * 9);
  F.forEach(([a, b, c], i) => {
    const A = P[a], B = P[b], Cc = P[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
    let n = norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    const cen = [(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3, (A[2] + B[2] + Cc[2]) / 3];
    if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) n = [-n[0], -n[1], -n[2]];
    [A, B, Cc].forEach((p, k) => { pos.set(p, i * 9 + k * 3); nrm.set(n, i * 9 + k * 3); });
  });
  return { pos, nrm, count: F.length * 3 };
}
// broken architectural fragments: fluted round column drums / chamfered square piers with jagged fracture ends
// (optional capital flare at one end). Long axis = y, half-length 1 before normalisation.
function makePillarMesh(seed, kind) {
  const rng = new RNG(seed);
  const square = kind === 'pierfrag';
  const rho = square ? rng.range(0.22, 0.34) : rng.range(0.16, 0.27);
  const nSeg = square ? 24 : 36, K = 10;
  const flutes = square ? 0 : rng.pick([10, 12, 14, 16]);
  const capital = !square && rng.next() < 0.35;
  const prof = [];
  for (let i = 0; i < nSeg; i++) {
    const th = (i / nSeg) * TAU, c = Math.cos(th), s = Math.sin(th);
    let r = 1;
    if (square) r = 1 / Math.pow(Math.pow(Math.abs(c), 7) + Math.pow(Math.abs(s), 7), 1 / 7);
    else if (flutes) r = 1 - 0.075 * Math.pow(0.5 + 0.5 * Math.cos(th * flutes), 1.5);
    prof.push([c * r * rho, s * r * rho, th]);
  }
  // jagged fracture height per segment for one end (1 = intact length)
  const endH = (intact) => {
    if (intact) return prof.map(() => 1);
    const o = rng.range(0, 100), bite = rng.range(0, TAU), bd = rng.range(0.15, 0.5), tilt = rng.range(0.05, 0.35), td = rng.range(0, TAU);
    return prof.map(([, , th]) => 1 - 0.06 - 0.16 * (noise2(Math.cos(th) * 1.6 + o, Math.sin(th) * 1.6) * 0.5 + 0.5) - 0.07 * (noise2(Math.cos(th) * 5 + o, Math.sin(th) * 5 + 3) * 0.5 + 0.5)
      - bd * Math.pow(Math.max(0, Math.cos(th - bite)), 3) - tilt * (0.5 + 0.5 * Math.cos(th - td)));
  };
  const top = endH(capital), bot = endH(false);
  const V = [];
  const ring = (k) => prof.map(([x, z], i) => {
    const u = k / (K - 1);
    const y = lerp(-bot[i], top[i], u);
    let sc = 1;
    if (capital) { const e = (y - 0.78) / 0.22; sc = e < 0 ? 1 : e < 0.55 ? 1 + 0.42 * Math.pow(e / 0.55, 1.6) : 1.5; }
    return [x * sc, y, z * sc];
  });
  const rings = []; for (let k = 0; k < K; k++) rings.push(ring(k));
  const F = [];
  const tri = (a, b, c) => F.push([a, b, c]);
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < nSeg; i++) { const a = rings[k][i], b = rings[k][(i + 1) % nSeg], c = rings[k + 1][(i + 1) % nSeg], d = rings[k + 1][i]; tri(a, b, c); tri(a, c, d); }
  // rough fracture caps: outer ring -> jittered middle ring -> centre
  const cap = (R, sgn, flat) => {
    const meanY = R.reduce((s, p) => s + p[1], 0) / R.length;
    const mid = R.map((p) => [p[0] * 0.55, flat ? p[1] : lerp(p[1], meanY, 0.5) + sgn * rng.range(-0.05, 0.06), p[2] * 0.55]);
    const cen = [0, meanY + (flat ? 0 : sgn * rng.range(-0.04, 0.05)), 0];
    for (let i = 0; i < nSeg; i++) { const j = (i + 1) % nSeg; tri(R[i], R[j], mid[j]); tri(R[i], mid[j], mid[i]); tri(mid[i], mid[j], cen); }
  };
  cap(rings[K - 1], 1, capital); cap(rings[0], -1, false);
  let mr = 0; for (const f of F) for (const p of f) mr = Math.max(mr, Math.hypot(p[0], p[1], p[2]));
  const pos = new Float32Array(F.length * 9), nrm = new Float32Array(F.length * 9);
  F.forEach(([A, B, Cc], i) => {
    const a = A.map((v) => v / mr), b = B.map((v) => v / mr), c = Cc.map((v) => v / mr);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    // orient outward: sides by the radial direction, caps by the axial one
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const rad = Math.hypot(cen[0], cen[2]);
    const out = rad > rho * 0.8 / mr ? [cen[0], 0, cen[2]] : [0, cen[1], 0];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    // fracture caps: mostly axial normals (rough but readable as one broken face, no pinwheel facets)
    if (out[1] !== 0) { const sg = Math.sign(out[1]); n = norm([n[0] * 0.35, n[1] * 0.35 + sg * 0.65, n[2] * 0.35]); }
    [a, b, c].forEach((p, k) => { pos.set(p, i * 9 + k * 3); nrm.set(n, i * 9 + k * 3); });
  });
  return { pos, nrm, count: F.length * 3, halfLen: 1 / mr, rho: rho / mr, drums: square ? 0 : rng.range(2.2, 3.2) };
}
// 24 variants: ~40 % shards, 25 % slabs, 20 % cut blocks, 15 % rough rocks
const KINDS = ['shard', 'slab', 'block', 'shard', 'rock', 'shard', 'slab', 'block', 'shard', 'slab', 'rock', 'shard',
  'block', 'shard', 'slab', 'shard', 'block', 'rock', 'shard', 'slab', 'shard', 'block', 'slab', 'shard'];
// + 10 architectural fragment variants (not used by random rocks)
const FRAG_KINDS = ['pillar', 'pillar', 'pillar', 'pillar', 'pillar', 'pillar', 'pierfrag', 'pierfrag', 'pierfrag', 'pierfrag'];
const ALL_KINDS = KINDS.concat(FRAG_KINDS);
const PILLAR_V = ALL_KINDS.map((k, i) => (k === 'pillar' ? i : -1)).filter((i) => i >= 0);
const PIER_V = ALL_KINDS.map((k, i) => (k === 'pierfrag' ? i : -1)).filter((i) => i >= 0);
const CUT_STONE = KINDS.map((k, i) => (k === 'block' || k === 'slab' ? i : -1)).filter((i) => i >= 0);
const NATURAL = KINDS.map((k, i) => (k === 'shard' || k === 'rock' ? i : -1)).filter((i) => i >= 0);
let MESHES = null;
function meshes() {
  if (!MESHES) MESHES = ALL_KINDS.map((k, i) => (k === 'pillar' || k === 'pierfrag' ? makePillarMesh(7001 + i * 53, k) : makeRockMesh(9001 + i * 31, k)));
  return MESHES;
}

// ---------------------------------------------------------------------------------------
// field
// ---------------------------------------------------------------------------------------
/**
 * makeDebris(seed, opts) -> field
 *  count (300), box {x0,x1,y0,y1,z0,z1} (metres, y down), sizeMin (0.05) sizeMax (2.0) sizePow (2.6: higher = more small ones),
 *  dust (count of motes, default count*0.8), ground (false: rocks rest on the floor y=0, no drift),
 *  spin (1) tumble speed multiplier, blocky (0.45) fraction of cut-stone blocks/slabs vs jagged shards/rocks,
 *  avoid [{x0,x1,y0?,y1?,z0,z1}] boxes kept clear of rocks (e.g. the fighters / camera path)
 *  rocks: [{x,y,z,size,v?,spin?,tone?,rise?}] extra hand-placed rocks (e.g. big blurred foreground chunks)
 *  grit (default count*3, 0 for ground fields): tiny dark specks 0.02-0.12 m, concentrated within gritRadius (25 m) of gritCenter ({x:0,y:-3,z:3})
 */
export function makeDebris(seed = 1, opts = {}) {
  const rng = new RNG(seed);
  const box = { x0: -40, x1: 40, y0: -25, y1: 4, z0: -6, z1: 80, ...(opts.box || {}) };
  const count = opts.count ?? 300;
  const sMin = opts.sizeMin ?? 0.05, sMax = opts.sizeMax ?? 2.0, sPow = opts.sizePow ?? 2.6;
  const rocks = [];
  const avoid = opts.avoid || [];
  const inAvoid = (x, y, z) => avoid.some((b) => x > b.x0 && x < b.x1 && y > (b.y0 ?? -1e9) && y < (b.y1 ?? 1e9) && z > b.z0 && z < b.z1);
  for (let i = 0; i < count; i++) {
    const u = Math.pow(rng.next(), sPow);
    const size = sMin * Math.pow(sMax / sMin, u);
    const blocky = rng.next() < (opts.blocky ?? 0.45);
    const v = blocky ? rng.pick(CUT_STONE) : rng.pick(NATURAL);
    const ax = norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
    let x = rng.range(box.x0, box.x1), y = rng.range(box.y0, box.y1), z = rng.range(box.z0, box.z1);
    for (let k = 0; k < 6 && inAvoid(x, y, z); k++) { x = rng.range(box.x0, box.x1); y = rng.range(box.y0, box.y1); z = rng.range(box.z0, box.z1); }
    if (inAvoid(x, y, z)) continue;
    rocks.push({
      x, y, z, size, v, ax,
      w: (opts.spin ?? 1) * rng.range(0.15, 0.7) * rng.sign() / Math.sqrt(Math.max(0.3, size)), ph: rng.range(0, TAU),
      tone: rng.range(0.78, 1.18), sway: rng.range(0, TAU), rs: rng.range(0.7, 1.3), seed: rng.next(),
      ax2: norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]), ph2: rng.range(0, TAU),
    });
  }
  for (const h of opts.rocks || []) {
    rocks.push({ bob: h.bob ?? 0, drums: h.drums ?? 0, x: h.x, y: h.y, z: h.z, size: h.size ?? 1, v: h.v ?? rng.int(0, KINDS.length - 1), ax: norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]), w: (h.spin ?? 0.15) * rng.sign(), ph: rng.range(0, TAU),
      tone: h.tone ?? rng.range(0.85, 1.1), sway: rng.range(0, TAU), rs: h.rise ?? 0.3, seed: rng.next(), ax2: norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]), ph2: rng.range(0, TAU) });
  }
  const dustN = opts.dust ?? Math.round(count * 0.8);
  const dust = [];
  for (let i = 0; i < dustN; i++) dust.push({ x: rng.range(box.x0, box.x1), y: rng.range(box.y0, box.y1), z: rng.range(box.z0, box.z1), s: rng.range(0.6, 1.8), ph: rng.range(0, TAU), rs: rng.range(0.6, 1.5), tw: rng.range(2, 7) });
  // grit: dense tiny specks, concentrated around the fighters (rejection-sampled inside box ∩ sphere)
  const gritN = opts.grit ?? (opts.ground ? 0 : Math.round(count * 3));
  const gc = { x: 0, y: -3, z: 3, ...(opts.gritCenter || {}) }, gR = opts.gritRadius ?? 25;
  const grit = [];
  for (let i = 0; i < gritN; i++) {
    let ok = false, x = 0, y = 0, z = 0;
    for (let k = 0; k < 10 && !ok; k++) {
      const r = gR * Math.pow(rng.next(), 0.75), th = rng.range(0, TAU), cz = rng.range(-1, 1), sz = Math.sqrt(1 - cz * cz);
      x = gc.x + r * sz * Math.cos(th); y = gc.y + r * cz * 0.7; z = gc.z + r * sz * Math.sin(th);
      ok = x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1 && z > box.z0 && z < box.z1 && !inAvoid(x, y, z);
    }
    if (!ok) continue;
    grit.push({ x, y, z, s: lerp(0.02, 0.12, Math.pow(rng.next(), 1.8)), a: rng.range(0, TAU), sh: rng.range(0.45, 1), w: rng.range(-3, 3), rs: rng.range(0.7, 1.4), sway: rng.range(0, TAU), tone: rng.range(0.7, 1.3) });
  }
  return { rocks, dust, grit, box, ground: !!opts.ground, seed };
}

// axis-angle -> column-major mat3 (as 9 floats)
function rotMat(ax, a, out, o) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = ax;
  out[o] = t * x * x + c; out[o + 1] = t * x * y + s * z; out[o + 2] = t * x * z - s * y;
  out[o + 3] = t * x * y - s * z; out[o + 4] = t * y * y + c; out[o + 5] = t * y * z + s * x;
  out[o + 6] = t * x * z + s * y; out[o + 7] = t * y * z - s * x; out[o + 8] = t * z * z + c;
}
function mul3(A, B, out, o) { // out = A*B (column-major 9-arrays)
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[o + c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2];
}

// ---------------------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------------------
const VS_ROCK = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 iPS;            // xyz pos, w scale
layout(location=3) in vec3 iR0; layout(location=4) in vec3 iR1; layout(location=5) in vec3 iR2;
layout(location=6) in vec4 iP;             // tone, alpha, seed, -
layout(location=7) in vec4 iS;             // smear: world direction xyz, stretch factor w (1 = none)
uniform vec2 uRes; uniform vec3 uCam; uniform float uFocal; uniform vec2 uPP; uniform vec3 uShake;
uniform float uHull, uHullPx, uScaleRes;
out vec3 vW; out vec3 vN; out vec3 vO; out vec4 vP; out vec2 vD;
${GLSL_DEPTH}
void main(){
  mat3 R = mat3(iR0, iR1, iR2);
  vec3 lp = R * (aPos * iPS.w);
  vec3 n = R * aNrm;
  // velocity smear: stretch along the motion direction (normals use the inverse stretch)
  if(iS.w > 1.001){ vec3 d = iS.xyz; lp += d * dot(d, lp) * (iS.w - 1.0); n = normalize(n + d * dot(d, n) * (1.0 / iS.w - 1.0)); }
  vec3 wp = iPS.xyz + lp;
  float rpx0 = iPS.w * uFocal / max(iPS.z - uCam.z, 0.05) / uScaleRes;   // projected radius (px @1080p)
  if(uHull > 0.5){
    float dz0 = max(iPS.z - uCam.z, 0.05);
    float rpx = iPS.w * uFocal / dz0;
    if(rpx < 6.0 * uScaleRes){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vW = wp; vN = n; vO = aPos; vP = vec4(iP.xyz, rpx0); vD = vec2(aPos.y, iP.w); return; } // tiny rocks: no line
    float hp = min(uHullPx * uScaleRes, 2.5 * uScaleRes);
    wp += normalize(n + normalize(R * aPos) * 0.35) * (hp * max(wp.z - uCam.z, 0.05) / uFocal);
  }
  vec3 d = wp - uCam;
  float dz = max(d.z, 0.001);
  vec2 u = d.xy * uFocal;
  float r = uShake.z; float c = cos(r), s = sin(r);
  vec2 ur = vec2(u.x * c - u.y * s, u.x * s + u.y * c);
  float cx = (uPP.x + uShake.x) / uRes.x * 2.0 - 1.0;
  float cy = 1.0 - (uPP.y + uShake.y) / uRes.y * 2.0;
  gl_Position = vec4(cx * dz + ur.x * 2.0 / uRes.x, cy * dz - ur.y * 2.0 / uRes.y, clipZ(dz), dz);
  vW = wp; vN = n; vO = aPos * (iPS.w * 1.7 + 0.6) + iP.z * 17.0; vP = vec4(iP.xyz, rpx0); vD = vec2(aPos.y, iP.w);
}`;
const FS_ROCK = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vO; in vec4 vP; in vec2 vD;
out vec4 o;
uniform vec3 uCam;
uniform vec3 uMoonDir;
uniform vec4 uLA, uLB; uniform vec3 uLAC, uLBC; uniform vec4 uSplit;
uniform float uMode, uHull, uFogD, uRim, uFill, uFillR, uEmitK, uRimDist;
uniform vec3 uDark, uMid, uLit, uLine, uKey;
${GLSL_COMMON}
float n3(vec3 p){ return vn(p.xy + p.z * 1.7) * 0.6 + vn(p.yz * 2.1 + 3.0) * 0.4; }
void main(){
  vec3 V = normalize(vW - uCam);
  vec3 n = normalize(vN);
  float fc = dot(n, V);
  float alpha = vP.y;
  float fog = fogAmt(length(vW - uCam), uFogD);
  if(uHull > 0.5){
    if(fc < 0.0) discard;
    vec3 lc = mix(uLine, fogSky(V), fog);
    o = uMode < 0.5 ? vec4(toSrgb(lc) * alpha, alpha) : vec4(0.0, 0.0, 0.0, alpha);
    return;
  }
  if(fc > 0.02) discard;
  // cel bands from the moon (behind/above): near-black bodies, hard light on the up/left/back facets
  // 3-tone cel from the sky key (upper-left-front, same as the ruin sprites) + the moon backlight limb
  float nl = dot(n, normalize(uMoonDir));
  float kl = dot(n, normalize(vec3(-0.78, -0.58, -0.24)));
  float lit = max(smoothstep(-0.04, 0.04, kl), smoothstep(0.02, 0.1, nl));
  float hi = smoothstep(0.5, 0.56, nl);
  vec3 base = mix(uDark, uMid, lit);
  base = mix(base, uKey, smoothstep(0.5, 0.58, kl) * (vD.y > 0.5 ? 1.0 : 0.6));
  base = mix(base, uLit, hi);
  // stone grain + pits (object space)
  float tx = n3(vO * 1.4);
  float sp = step(0.86, vn(vO.xy * 9.0 + vO.z * 5.0));
  float fl = step(0.93, vn(vO.yz * 13.0 + vO.x * 3.0));
  base *= (0.62 + 0.8 * tx) * vP.x * (1.0 - sp * 0.45) * (1.0 + fl * 0.6 * lit);
  // column drum joints (architectural fragments)
  if(vD.y > 0.5){ float dr = abs(fract(vD.x * vD.y + 0.37) - 0.5); base *= mix(0.35, 1.0, smoothstep(0.0, 0.03, 0.5 - dr)); }
  vec3 col = base;
  // moonlit silhouette rim on the upper-left edges (backlight)
  float mr = smoothstep(0.78, 0.9, 1.0 - abs(fc)) * smoothstep(0.1, 0.45, dot(n, normalize(vec3(-0.45, -0.85, 0.25))));
  col += uLit * mr * 0.9;
  vec3 em = vec3(0.0);
  float sx = smoothstep(-uSplit.y, uSplit.y, vW.x - uSplit.x);
  for(int i = 0; i < 2; i++){
    vec4 L = i == 0 ? uLA : uLB; vec3 C = i == 0 ? uLAC : uLBC;
    if(L.w <= 0.0) continue;
    float ks = i == 0 ? mix(1.0, 1.0 - sx, uSplit.z) : mix(1.0, sx, uSplit.z);
    vec3 d = L.xyz - vW; float dist = length(d); vec3 dl = d / dist;
    // rims only on rocks big enough to show one, and only near the light (no coloured confetti far away)
    float att = ks / (1.0 + dist * dist / (L.w * L.w)) * (1.0 - smoothstep(uRimDist * 0.3, uRimDist * 0.75, dist)) * smoothstep(4.0, 12.0, vP.w);
    float attF = ks / (1.0 + dist * dist / (uFillR * uFillR));
    float ndl = dot(n, dl);
    float band = smoothstep(0.0, 0.12, ndl);
    col += base * 1.2 * C * attF * band * uFill * mix(0.25, 1.0, smoothstep(3.0, 10.0, vP.w));
    float rim = step(0.2, ndl) * smoothstep(0.2, 0.08, -fc);   // thin hard rim on the side facing the light
    em += C * att * rim * 1.5;
  }
  col += em * uRim;
  col = mix(col, fogSky(V), fog);
  em *= (1.0 - fog);
  if(uMode < 0.5) o = vec4(toSrgb(col) * alpha, alpha);
  else o = vec4(toSrgb(em * uEmitK) * alpha, alpha);
}`;
const VS_DUST = `#version 300 es
layout(location=0) in vec4 aD;   // x y z size
layout(location=1) in vec4 aC;   // rgb, alpha
uniform vec2 uRes; uniform vec3 uCam; uniform float uFocal; uniform vec2 uPP; uniform vec3 uShake; uniform float uScaleRes;
out vec4 vC;
${GLSL_DEPTH}
void main(){
  vec3 d = aD.xyz - uCam;
  float dz = max(d.z, 0.001);
  vec2 u = d.xy * uFocal / dz;
  float r = uShake.z; float c = cos(r), s = sin(r);
  vec2 sp = uPP + uShake.xy + vec2(u.x * c - u.y * s, u.x * s + u.y * c);
  gl_Position = d.z > 0.4 ? vec4((sp.x / uRes.x * 2.0 - 1.0) * dz, (1.0 - sp.y / uRes.y * 2.0) * dz, clipZ(dz), dz) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = clamp(aD.w * uScaleRes * (0.6 + 9.0 / dz), 1.0, 24.0);
  vC = aC;
}`;
const FS_DUST = `#version 300 es
precision highp float;
in vec4 vC; out vec4 o;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  float a = exp(-r * 4.0) * vC.a;
  float star = exp(-abs(q.x) * 9.0) * exp(-q.y * q.y * 3.0) + exp(-abs(q.y) * 9.0) * exp(-q.x * q.x * 3.0);
  a = max(a, star * vC.a * 0.6);
  o = vec4(vC.rgb * a, a);
}`;
// grit specks: dark angular flakes with a 1 px lit rim on the moon / light side
const VS_GRIT = `#version 300 es
layout(location=0) in vec4 aG;   // x y z size(m)
layout(location=1) in vec4 aA;   // angle, shape, tone, rim tint mix (0 = moon, >0 = energy)
layout(location=2) in vec3 aT;   // rim tint colour (linear)
uniform vec2 uRes; uniform vec3 uCam; uniform float uFocal; uniform vec2 uPP; uniform vec3 uShake; uniform float uScaleRes;
out vec4 vA; out vec3 vT; out float vPx; out float vDist; out vec3 vRd;
${GLSL_DEPTH}
void main(){
  vec3 d = aG.xyz - uCam;
  float dz = max(d.z, 0.001);
  vec2 u = d.xy * uFocal / dz;
  float r = uShake.z; float c = cos(r), s = sin(r);
  vec2 sp = uPP + uShake.xy + vec2(u.x * c - u.y * s, u.x * s + u.y * c);
  float px = aG.w * uFocal / dz;
  gl_Position = d.z > 0.4 ? vec4((sp.x / uRes.x * 2.0 - 1.0) * dz, (1.0 - sp.y / uRes.y * 2.0) * dz, clipZ(dz), dz) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = clamp(px * 1.5 + 1.0, 1.5, 14.0 * uScaleRes);
  vA = aA; vT = aT; vPx = gl_PointSize; vDist = length(d); vRd = normalize(d);
}`;
const FS_GRIT = `#version 300 es
precision highp float;
in vec4 vA; in vec3 vT; in float vPx; in float vDist; in vec3 vRd;
out vec4 o;
uniform vec3 uDark, uLit; uniform float uFogD;
${GLSL_COMMON}
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vA.x), s = sin(vA.x);
  vec2 p = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  // irregular angular chip: 5-sided polygon with random corner radii (per flake), squashed
  float sh = vA.y;
  vec2 pp = vec2(p.x, p.y / sh);
  float th = atan(pp.y, pp.x) / 6.2831853 + 0.5;
  float sec = floor(th * 5.0), fr = fract(th * 5.0);
  float r0 = 0.62 + 0.38 * fract(sin((sec + vA.z * 37.0) * 91.7) * 4375.85);
  float r1 = 0.62 + 0.38 * fract(sin((mod(sec + 1.0, 5.0) + vA.z * 37.0) * 91.7) * 4375.85);
  float dd = length(pp) / mix(r0, r1, fr) * 0.86;
  float aa = 2.0 / vPx;
  float a = 1.0 - smoothstep(0.86 - aa, 0.86, dd);
  if(a < 0.01) discard;
  // 1 px lit rim on the upper-left (screen) side of the flake
  float edge = smoothstep(0.86 - 2.4 / vPx, 0.86 - 0.9 / vPx, dd) * step(q.x + q.y, -0.25);   // ~1 px rim on the upper-left
  vec3 col = uDark * vA.z;
  vec3 rimC = mix(uLit, vT, step(0.01, vA.w));
  col = mix(col, rimC, edge * 0.85 * smoothstep(3.0, 5.0, vPx) * mix(0.55, 1.0, step(0.01, vA.w)));
  // tiny specks lift toward the sky colour (atmospheric, so they read as distant grit, not dirt on the lens)
  col = mix(col, fogSky(vRd), max(fogAmt(vDist, uFogD), 0.3 * (1.0 - smoothstep(2.0, 6.0, vPx))));
  o = vec4(toSrgb(col) * a, a);
}`;
const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec4 s = texture(uSrc, vUv) * 0.2270270;
  s += (texture(uSrc, vUv + uDir * 1.3846154) + texture(uSrc, vUv - uDir * 1.3846154)) * 0.3162162;
  s += (texture(uSrc, vUv + uDir * 3.2307692) + texture(uSrc, vUv - uDir * 3.2307692)) * 0.0702703;
  o = s;
}`;
const FS_COPY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
void main(){ o = texture(uSrc, vUv); }`;

// ---------------------------------------------------------------------------------------
// GL resources
// ---------------------------------------------------------------------------------------
const STRIDE = 21; // floats per rock instance
function rockGL(G) {
  if (G.rock) return G.rock;
  const gl = G.gl;
  const vaos = meshes().map((m) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    const stride = STRIDE * 4;
    const attr = (loc, size, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4); gl.vertexAttribDivisor(loc, 1); };
    attr(2, 4, 0); attr(3, 3, 4); attr(4, 3, 7); attr(5, 3, 10); attr(6, 4, 13); attr(7, 4, 17);
    gl.bindVertexArray(null);
    return { vao, ib, count: m.count };
  });
  const dvao = gl.createVertexArray();
  gl.bindVertexArray(dvao);
  const db = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, db);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);
  const gvao = gl.createVertexArray();
  gl.bindVertexArray(gvao);
  const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 44, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 44, 16);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 44, 32);
  gl.bindVertexArray(null);
  G.rock = { vaos, dvao, db, gvao, gb };
  return G.rock;
}
function fbo(G, name, w, h, depth) {
  const k = `${name}_${w}x${h}`;
  if (G.fbo[k]) return G.fbo[k];
  const gl = G.gl;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (depth) { const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
  return (G.fbo[k] = { fb, tex, w, h });
}

// ---------------------------------------------------------------------------------------
// per-frame evaluation (closed form: a pure function of t)
// ---------------------------------------------------------------------------------------
// shockwave push of a body of `size` at (x,y,z) by a list of bursts at time t: impulse profile (fast kick + slow coast)
function burstPush(bursts, x, y, z, size, t, out) {
  out.x = x; out.y = y; out.z = z; out.spin = 0;
  for (const b of bursts) {
    let dt = t - (b.t0 ?? 0);
    if (dt <= 0) continue;
    if (dt < 0.1) dt = Math.floor(dt * 30) / 30; // hold on twos for the impact frames
    const dx = x - b.x, dy = y - b.y, dz = z - b.z;
    const dist = Math.hypot(dx, dy, dz) + 1e-3;
    const reach = b.radius ?? 16;
    const fall = 1 / (1 + (dist / reach) * (dist / reach));
    const S = b.strength ?? 1;
    const push = S * fall * (0.75 * (1 - Math.exp(-dt * 10)) + 0.25 * Math.min(dt, 1.5)) * 14 / Math.sqrt(Math.max(0.2, size));
    out.x += (dx / dist) * push; out.y += (dy / dist) * push - (b.lift ?? 0.4) * push; out.z += (dz / dist) * push * (b.zK ?? 0.35);
    out.spin += S * fall * (1 - Math.exp(-dt * 6)) * 14 / Math.pow(Math.max(1, size), 1.3);
  }
  return out;
}
function rockPos(field, r, o, t, bursts, out) {
  const { box } = field;
  const H = box.y1 - box.y0;
  const rise = field.ground ? 0 : (o.rise ?? 0.3);
  let x = r.x, y = r.y, z = r.z, ang = r.ph + r.w * t, sc = r.size;
  if (!field.ground) {
    // rise + wrap, with a shrink near the wrap seam
    const yy = y - rise * r.rs * t;
    const k = ((yy - box.y0) % H + H) % H;
    y = box.y0 + k;
    const edge = Math.min(k, H - k) / (H * 0.08);
    sc *= clamp(edge, 0, 1);
    x += Math.sin(t * 0.21 + r.sway) * 0.35 * r.rs;
    z += Math.cos(t * 0.17 + r.sway * 1.3) * 0.25;
  } else {
    y = -r.size * 0.38;
    ang = r.ph;
  }
  if (bursts.length) { burstPush(bursts, x, y, z, r.size, t, out); x = out.x; y = out.y; z = out.z; ang += out.spin * Math.sign(r.w || 1); }
  if (r.bob) y += Math.sin(t * 0.55 + r.ph * 3.1) * r.bob;
  out.x = x; out.y = y; out.z = z; out.ang = ang; out.sc = sc;
  return out;
}
function evalRocks(S, field, o) {
  const t = o.t ?? S.t;
  const cam = S.cam;
  const bursts = o.burst ? (Array.isArray(o.burst) ? o.burst : [o.burst]) : [];
  const live = bursts.filter((b) => t - (b.t0 ?? 0) > 0 && t - (b.t0 ?? 0) < 1.2);
  const zMin = o.zMin ?? -Infinity, zMax = o.zMax ?? Infinity;
  const focus = o.focus ?? (cam.z < 0 ? -cam.z : 14);
  const dof = o.dof ?? 1;
  const scaleRes = S.H / 1080;
  const out = [];
  const R1 = new Float32Array(9), R2 = new Float32Array(9);
  const P = {}, Q = {};
  for (const r of field.rocks) {
    rockPos(field, r, o, t, bursts, P);
    const { x, y, z, ang, sc } = P;
    if (z < zMin || z >= zMax) continue;
    const dzc = z - cam.z;
    if (dzc < 0.3 + sc) continue;
    if (sc < 0.004) continue;
    // cull off-screen
    const p = cam.project(x, y, z);
    if (!p) continue;
    const rad = sc * p.s * 1.2 + 4;
    if (p.x < -rad || p.x > S.W + rad || p.y < -rad || p.y > S.H + rad) continue;
    if (sc * p.s < 0.5) continue;
    // velocity smear while a burst is young: stretch along the screen motion
    let smear = null;
    if (live.length) {
      rockPos(field, r, o, t - 1 / 60, bursts, Q);
      const q = cam.project(Q.x, Q.y, Q.z);
      if (q) {
        const v = Math.hypot(p.x - q.x, p.y - q.y) / scaleRes;
        const k = 1 + clamp(v / 40, 0, 2.5);
        if (k > 1.02) { const dx = x - Q.x, dy = y - Q.y, dz = z - Q.z, l = Math.hypot(dx, dy, dz) || 1; smear = [dx / l, dy / l, dz / l, k]; }
      }
    }
    // depth of field (blur in px at 1080p)
    const coc = dof * (dzc < focus ? 34 * (focus - dzc) / dzc / Math.max(1, focus * 0.25) : 0);
    rotMat(r.ax, ang, R1, 0);
    rotMat(r.ax2, r.ph2, R2, 0);
    const M = new Float32Array(9); mul3(R1, R2, M, 0);
    out.push({ v: r.v, x, y, z, sc, M, tone: r.tone, seed: r.seed, drums: r.drums, coc: coc * scaleRes, smear });
  }
  return out;
}

function drawGroup(G, prog, list) {
  const gl = G.gl, R = G.rock;
  const byV = new Map();
  for (const r of list) { if (!byV.has(r.v)) byV.set(r.v, []); byV.get(r.v).push(r); }
  for (const [v, arr] of byV) {
    const data = new Float32Array(arr.length * STRIDE);
    arr.forEach((r, i) => {
      const o = i * STRIDE;
      data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z; data[o + 3] = r.sc;
      data.set(r.M, o + 4);
      data[o + 13] = r.tone; data[o + 14] = 1; data[o + 15] = r.seed; data[o + 16] = r.drums || 0;
      if (r.smear) data.set(r.smear, o + 17); else { data[o + 17] = 0; data[o + 18] = 1; data[o + 19] = 0; data[o + 20] = 1; }
    });
    const m = R.vaos[v % R.vaos.length];
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.ib);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    // hull (line art) then body
    glSet(G, 'uHull', 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, arr.length);
    glSet(G, 'uHull', 0); gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, arr.length);
  }
  gl.bindVertexArray(G.vao);
}

/**
 * drawDebris(S, field, opts)
 *  t (S.t), rise (0.3 m/s), zMin, zMax,
 *  burst {x,y,z,t0,strength=1,radius=16,lift=0.4,zK=0.35 (depth push factor)} or array: impulse kick (+ held on twos for 0.1 s),
 *        spin kick, and a velocity smear (stretch along the screen motion) for the first frames,
 *  lightA, lightB (default from env), focus (m from camera, default |cam.z|), dof (1 = default blur strength, 0 = off),
 *  fogDensity (0.0022, same curve as the ruins), fill (1), fillRange (8 m), rim (1), rimDist (40 m),
 *  emit (0.8; 0 skips the emit pass), occludeEmit (true), dust (true), dustGlow (1), grit (true), split (0.85), splitWidth (14),
 *  line ([13,15,34]), linePx (1.1, clamped to 2.5 px; rocks under 6 px get no line), shadows (true, ground fields)
 *  Depth-tests against ruins / floor drawn earlier in the frame (shared z-buffer).
 */
export function drawDebris(S, field, opts = {}) {
  const G = worldGL(S.W, S.H);
  const gl = G.gl;
  rockGL(G);
  const cam = S.cam, env = S.env;
  const list = evalRocks(S, field, opts);
  const LA = resolveLight(opts.lightA, env.lightA, env.lightAC);
  const LB = resolveLight(opts.lightB, env.lightB, env.lightBC);
  const prog = glProgram(G, 'rock', VS_ROCK, FS_ROCK);
  const scaleRes = S.H / 1080;
  const groups = [[], [], []];
  for (const r of list) groups[r.coc < 2.2 * scaleRes ? 0 : r.coc < 9 * scaleRes ? 1 : 2].push(r);
  const setU = (mode) => {
    glUse(G, prog);
    glSet(G, 'uRes', [G.W, G.H]); glSet(G, 'uCam', [cam.x, cam.y, cam.z]); glSet(G, 'uFocal', cam.focal);
    glSet(G, 'uPP', [cam.cx, cam.cy]); glSet(G, 'uShake', [cam.shakeX, cam.shakeY, cam.rollTotal]);
    glSet(G, 'uScaleRes', scaleRes);
    glSet(G, 'uHullPx', opts.linePx ?? 1.1);
    envSkyUniforms(G, env);
    glSet(G, 'uMoonDir', env.moonDir || [-0.25, -0.55, 0.8]);
    glSet(G, 'uLA', LA ? [LA.x, LA.y, LA.z, LA.range] : [0, 0, 0, 0]); glSet(G, 'uLAC', LA ? LA.col : [0, 0, 0]);
    glSet(G, 'uLB', LB ? [LB.x, LB.y, LB.z, LB.range] : [0, 0, 0, 0]); glSet(G, 'uLBC', LB ? LB.col : [0, 0, 0]);
    glSet(G, 'uSplit', [((LA ? LA.x : -4) + (LB ? LB.x : 4)) / 2, opts.splitWidth ?? 14, opts.split ?? 0.85, 0]);
    glSet(G, 'uMode', mode); glSet(G, 'uFogD', opts.fogDensity ?? FOG_DENSITY);
    glSet(G, 'uRim', opts.rim ?? 1.0); glSet(G, 'uFill', opts.fill ?? 1.0); glSet(G, 'uFillR', opts.fillRange ?? 8); glSet(G, 'uEmitK', opts.emit ?? 0.8);
    glSet(G, 'uRimDist', opts.rimDist ?? 40);
    glSet(G, 'uDark', lin3([10, 10, 14])); glSet(G, 'uMid', lin3([32, 33, 42])); glSet(G, 'uKey', lin3([74, 76, 96])); glSet(G, 'uLit', lin3([132, 134, 156]));
    glSet(G, 'uLine', lin3(opts.line || [13, 15, 34]));
  };
  const blurP = glProgram(G, 'blur', VS_FULL, FS_BLUR), copyP = glProgram(G, 'copy', VS_FULL, FS_COPY);
  const renderMode = (mode) => {
    glFrame(G, S);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(mode ? gl.LEQUAL : gl.LESS); gl.depthMask(true);
    gl.disable(gl.BLEND);
    setU(mode);
    if (groups[0].length) drawGroup(G, prog, groups[0]);
    // blurred near groups: render low-res, blur, composite over
    for (let gi = 1; gi < 3; gi++) {
      if (!groups[gi].length) continue;
      const div = gi === 1 ? 2 : 4;
      const w = Math.max(8, Math.round(G.W / div)), h = Math.max(8, Math.round(G.H / div));
      const A = fbo(G, `dofA${gi}`, w, h, true), B = fbo(G, `dofB${gi}`, w, h, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb); gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
      setU(mode);
      drawGroup(G, prog, groups[gi]);
      gl.disable(gl.DEPTH_TEST);
      glUse(G, blurP);
      const avg = groups[gi].reduce((s, r) => s + r.coc, 0) / groups[gi].length;
      const rad = clamp(avg / div / 3.2, 0.6, 3.5);
      for (let it = 0; it < 2; it++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb); glTex(G, 'uSrc', 0, A.tex); glSet(G, 'uDir', [rad / w, 0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb); glTex(G, 'uSrc', 0, B.tex); glSet(G, 'uDir', [0, rad / h]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, G.W, G.H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      glUse(G, copyP); glTex(G, 'uSrc', 0, A.tex);
      // the FBO is y-up like the default framebuffer: draw full-screen
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.disable(gl.DEPTH_TEST);
  };
  if (list.length && field.ground && opts.shadows !== false) {
    // soft contact shadows on the floor plane (y = 0) under resting rocks
    const ctx = S.L.scene;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const r of list) {
      const c = cam.project(r.x, 0, r.z), f = cam.project(r.x, 0, r.z + r.sc * 1.3), sd = cam.project(r.x + r.sc * 1.3, 0, r.z);
      if (!c || !f || !sd) continue;
      const rx = Math.max(1, Math.hypot(sd.x - c.x, sd.y - c.y)), ry = Math.max(0.6, Math.abs(f.y - c.y) * 1.2 + 0.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(2,2,6,0.85)'); g.addColorStop(0.55, 'rgba(2,2,6,0.4)'); g.addColorStop(1, 'rgba(2,2,6,0)');
      ctx.setTransform(rx, 0, 0, ry, c.x, c.y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  if (list.length) {
    renderMode(0);
    glBlit(G, S.L.scene);
    if (opts.occludeEmit !== false) glBlit(G, S.L.emit, 'destination-out');
    if ((opts.emit ?? 1) > 0) { renderMode(1); glBlit(G, S.L.emit, 'lighter'); }
  }
  if (opts.grit !== false && field.grit && field.grit.length) drawGrit(S, G, field, opts, LA, LB);
  if (opts.dust !== false && field.dust.length) drawDust(S, G, field, opts, LA, LB);
  gl.depthMask(true);
}

function drawGrit(S, G, field, opts, LA, LB) {
  const gl = G.gl, cam = S.cam, t = opts.t ?? S.t, box = field.box;
  const H = box.y1 - box.y0, rise = (opts.rise ?? 0.3) * 1.15;
  const zMin = opts.zMin ?? -Infinity, zMax = opts.zMax ?? Infinity;
  const bursts = opts.burst ? (Array.isArray(opts.burst) ? opts.burst : [opts.burst]) : [];
  const data = new Float32Array(field.grit.length * 11);
  const P = {};
  const mid = ((LA ? LA.x : -4) + (LB ? LB.x : 4)) / 2;
  let n = 0;
  for (const g of field.grit) {
    const yy = g.y - rise * g.rs * t;
    const k = ((yy - box.y0) % H + H) % H;
    let x = g.x + Math.sin(t * 0.3 + g.sway) * 0.3, y = box.y0 + k, z = g.z;
    if (bursts.length) { burstPush(bursts, x, y, z, Math.max(0.2, g.s * 4), t, P); x = P.x; y = P.y; z = P.z; }
    if (z < zMin || z >= zMax || z - cam.z < 0.5) continue;
    const seam = Math.min(k, H - k) / (H * 0.05);
    if (seam < 0.3) continue;
    // rim tint: nearest energy light on its own side of the split, else moon
    let tint = [0, 0, 0], mix = 0;
    for (const [L, sgn] of [[LA, -1], [LB, 1]]) {
      if (!L) continue;
      const dist = Math.hypot(x - L.x, y - L.y, z - L.z);
      const att = 1 / (1 + (dist / 7) ** 2) * (sgn * (x - mid) > -1.5 ? 1 : 0.1);
      if (att > mix) { mix = att; const m = Math.max(...L.col) || 1; tint = L.col.map((v) => (v / m) * 0.9); }
    }
    const o = n * 11;
    data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = g.s;
    data[o + 4] = g.a + g.w * t; data[o + 5] = g.sh; data[o + 6] = g.tone; data[o + 7] = mix > 0.45 ? mix : 0;
    data[o + 8] = tint[0]; data[o + 9] = tint[1]; data[o + 10] = tint[2];
    n++;
  }
  if (!n) return;
  const prog = glProgram(G, 'grit', VS_GRIT, FS_GRIT);
  glFrame(G, S);
  glUse(G, prog);
  glSet(G, 'uRes', [G.W, G.H]); glSet(G, 'uCam', [cam.x, cam.y, cam.z]); glSet(G, 'uFocal', cam.focal);
  glSet(G, 'uPP', [cam.cx, cam.cy]); glSet(G, 'uShake', [cam.shakeX, cam.shakeY, cam.rollTotal]); glSet(G, 'uScaleRes', S.H / 1080);
  glSet(G, 'uFogD', opts.fogDensity ?? FOG_DENSITY);
  envSkyUniforms(G, S.env);
  glSet(G, 'uDark', lin3([20, 20, 28])); glSet(G, 'uLit', lin3([150, 154, 182]));
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(G.rock.gvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, G.rock.gb);
  gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 11), gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.bindVertexArray(G.vao);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
  glBlit(G, S.L.scene);
}

function drawDust(S, G, field, opts, LA, LB) {
  const gl = G.gl, cam = S.cam, t = opts.t ?? S.t, box = field.box;
  const H = box.y1 - box.y0, rise = (opts.rise ?? 0.3) * 1.4;
  const zMin = opts.zMin ?? -Infinity, zMax = opts.zMax ?? Infinity;
  const data = new Float32Array(field.dust.length * 8);
  let n = 0;
  const gk = opts.dustGlow ?? 1;
  const mid = ((LA ? LA.x : -4) + (LB ? LB.x : 4)) / 2;
  for (const d of field.dust) {
    if (d.z < zMin || d.z >= zMax) continue;
    const yy = d.y - rise * d.rs * t;
    const k = ((yy - box.y0) % H + H) % H;
    const y = box.y0 + k;
    const x = d.x + Math.sin(t * 0.5 + d.ph) * 0.4, z = d.z;
    // colour: nearest light tint, twinkle
    let c = [0.75, 0.8, 1.0], a = 0.16;
    for (const [L, sgn] of [[LA, -1], [LB, 1]]) {
      if (!L) continue;
      const dist = Math.hypot(x - L.x, y - L.y, z - L.z);
      const att = 1 / (1 + (dist / 5.5) ** 2);
      const side = sgn * (x - mid) > -2 ? 1 : 0.15;
      const m = Math.max(L.col[0], L.col[1], L.col[2]) || 1;
      c = c.map((v, i) => v + (L.col[i] / m) * att * 3.0 * side);
      a += att * 1.1 * side;
    }
    const tw = 0.55 + 0.45 * Math.sin(t * d.tw + d.ph * 3);
    const o = n * 8;
    data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = d.s;
    const mx = Math.max(1, c[0], c[1], c[2]);
    data[o + 4] = c[0] / mx; data[o + 5] = c[1] / mx; data[o + 6] = c[2] / mx; data[o + 7] = clamp(a * tw * gk, 0, 1);
    n++;
  }
  if (!n) return;
  const prog = glProgram(G, 'dust', VS_DUST, FS_DUST);
  glFrame(G, S);
  glUse(G, prog);
  glSet(G, 'uRes', [G.W, G.H]); glSet(G, 'uCam', [cam.x, cam.y, cam.z]); glSet(G, 'uFocal', cam.focal);
  glSet(G, 'uPP', [cam.cx, cam.cy]); glSet(G, 'uShake', [cam.shakeX, cam.shakeY, cam.rollTotal]); glSet(G, 'uScaleRes', S.H / 1080);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(G.rock.dvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, G.rock.db);
  gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 8), gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.bindVertexArray(G.vao);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
  glBlit(G, S.L.emit, 'lighter');
}

_registerWorldHook('drawDebris', drawDebris);

/**
 * makeFragments(seed, list) -> field: floating broken column / pier fragments as real 3D meshes (used by ruins.js).
 *  list: [{x, y, z, len (m), r (m), square?, spin?, bob?, tone?}] — tumble slowly, bob, no drift.
 */
export function makeFragments(seed, list) {
  const rng = new RNG(seed);
  meshes();
  const rocks = list.map((f) => {
    const vs = f.square ? PIER_V : PILLAR_V;
    // pick the variant whose thickness ratio best matches r / (len / 2)
    const want = f.r / Math.max(0.1, f.len * 0.5);
    let v = vs[0], best = 1e9;
    for (const c of vs) { const m = MESHES[c]; const d = Math.abs(m.rho / m.halfLen - want) + rng.next() * 0.08; if (d < best) { best = d; v = c; } }
    const m = MESHES[v];
    return { x: f.x, y: f.y, z: f.z, size: (f.len * 0.5) / m.halfLen, v, drums: m.drums,
      ax: norm([rng.range(-0.35, 0.35), 1, rng.range(-0.35, 0.35)]), w: (f.spin ?? rng.range(0.03, 0.09)) * rng.sign(), ph: rng.range(0, TAU),
      tone: f.tone ?? rng.range(0.9, 1.25), sway: rng.range(0, TAU), rs: 0, seed: rng.next(), bob: f.bob ?? rng.range(0.15, 0.6),
      ax2: norm([rng.range(-1, 1), 0, rng.range(-1, 1)]), ph2: f.tilt ?? (rng.next() < 0.2 ? rng.range(-1.4, 1.4) : rng.range(-0.7, 0.7)) };
  });
  return { rocks, dust: [], grit: [], box: { x0: -1e4, x1: 1e4, y0: -1e4, y1: 1e4, z0: -1e4, z1: 1e4 }, ground: false, seed, frags: true };
}
_registerWorldHook('makeFragments', makeFragments);
