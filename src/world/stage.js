// ISSEN — world: the broken stone bridge / plaza the fighters stand on (builder A).
//
// A top-down flagstone texture (small irregular slabs and setts, deep grout, near-edge lips, bimodal
// wetness: mirror-wet slabs + puddles vs matte stone) is painted once in Canvas2D, plus a separate crack
// texture (coverage + premultiplied reveal order, so mips never drop the lines). Every frame a WebGL2
// floor shader renders it with exact ray/plane perspective: procedural grain / pits / glints that stay
// sharp at the lens, fresnel mirror reflections of the sky and of the already-drawn ruins (sharp in
// puddles, smeared on matte stone), energy light pools, long vertical wet-floor light streaks, glowing
// cracks with dark fissure lips, the shared aerial fog curve, and it writes the shared world z-buffer.
// The broken outline (coarse slab-sized bites, a deep V-break, a missing corner) gets projected rock
// side faces with hanging stalactite drops, so the platform reads as a broken floating bridge.
import { RNG, clamp, lerp, TAU } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';
import {
  worldGL, glProgram, glUse, glSet, glTex, glTexture, glUpload, glFrame, glBlit, glCam, GLSL_COMMON, GLSL_RAY, GLSL_DEPTH,
  envSkyUniforms, resolveLight, lin3, buildRuins, drawRuins, FOG_DENSITY,
} from './ruins.js';
import { makeDebris, drawDebris } from './debris.js';

const R = { x0: -17, x1: 17, z0: -15, z1: 16 };

// ---------------------------------------------------------------------------------------
// geometry: broken outline (+ holes) in world xz
// ---------------------------------------------------------------------------------------
function roughen(rng, ctrl, step, amp, bites, bw = [0.5, 1.4], bd = [0.4, 1.3]) {
  const out = [];
  for (let i = 0; i < ctrl.length; i++) {
    const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    const nx = -dz / L, nz = dx / L; // inward normal (polygon is CCW in the x-z plane, see makeGeometry)
    const m = Math.max(1, Math.round(L / step));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const d = amp * Math.pow(rng.next(), 1.6);
      const px = a.x + dx * t, pz = a.z + dz * t;
      if (k > 0 && rng.next() < bites) {
        // rectangular slab-shaped bite (a broken-off block of the bridge)
        const w = Math.min(rng.range(bw[0], bw[1]), L * (1 - t) * 0.9), dd = rng.range(bd[0], bd[1]);
        const tx = dx / L, tz = dz / L;
        const sk = rng.range(-0.25, 0.25) * dd;
        out.push({ x: px, z: pz });
        out.push({ x: px + nx * dd + tx * sk, z: pz + nz * dd + tz * sk });
        out.push({ x: px + nx * dd * rng.range(0.7, 1.1) + tx * (w + sk), z: pz + nz * dd * rng.range(0.7, 1.1) + tz * (w + sk) });
        out.push({ x: px + tx * w, z: pz + tz * w });
        k += Math.ceil(w / (L / m));
        continue;
      }
      out.push({ x: px + nx * d, z: pz + nz * d });
    }
  }
  return out;
}
function makeGeometry(rng) {
  // control polygon (clockwise as listed; reversed below if needed so the inward normal is (-dz, dx)/L)
  const ctrl = [
    { x: -14.6, z: -12.4 }, { x: -15.4, z: -5 }, { x: -15.0, z: 3.5 }, { x: -14.2, z: 10.5 }, { x: -12.6, z: 13.6 }, { x: -9.4, z: 13.0 },
    { x: -6.2, z: 14.4 }, { x: 2.5, z: 14.6 }, { x: 5.2, z: 13.8 }, { x: 6.3, z: 10.6 }, { x: 8.4, z: 10.2 }, { x: 9.6, z: 13.2 },
    { x: 13.2, z: 12.8 }, { x: 14.6, z: 7.0 }, { x: 15.3, z: -2.0 }, { x: 14.8, z: -8.6 },
    // near edge, right -> left: a missing corner, a ragged lip and one deep V-break into the abyss
    { x: 12.6, z: -11.9 }, { x: 9.8, z: -11.2 }, { x: 7.2, z: -12.9 }, { x: 3.9, z: -12.3 }, { x: 0.9, z: -13.4 },
    { x: -3.1, z: -12.9 }, { x: -4.8, z: -12.4 }, { x: -6.4, z: -9.0 }, { x: -7.7, z: -11.6 }, { x: -10.8, z: -13.0 },
  ];
  let A = 0; for (let i = 0; i < ctrl.length; i++) { const p = ctrl[i], q = ctrl[(i + 1) % ctrl.length]; A += p.x * q.z - q.x * p.z; }
  if (A < 0) ctrl.reverse();
  // coarse pass: slab-sized bites; fine pass: chips
  const coarse = roughen(rng, ctrl, 1.8, 1.3, 0.35, [1, 3], [0.8, 2.2]);
  const outer = roughen(rng, coarse, 0.38, 0.3, 0.07);
  const holes = [];
  const hole = (cx, cz, w, d) => {
    const pts = [];
    const n = 11;
    for (let i = 0; i < n; i++) { const th = (i / n) * TAU; const r = 0.7 + rng.next() * 0.5; pts.push({ x: cx + Math.cos(th) * w * 0.5 * r, z: cz + Math.sin(th) * d * 0.5 * r }); }
    holes.push(pts);
  };
  hole(-8.6, 8.4, 2.6, 1.6);
  hole(11.2, 2.4, 1.5, 1.1);
  // thickness per outline vertex (deeper near the camera side) + hanging rocky drops on ~15 % of vertices
  const thick = outer.map((p) => 1.3 + rng.next() * 0.9 + (p.z < -8 ? 1.5 + rng.next() * 3.5 : 0) + (rng.next() < 0.12 ? rng.range(1, 3) : 0));
  const drops = outer.map(() => (rng.next() < 0.15 ? { len: rng.range(2, 5), w: rng.range(0.7, 1.9), lean: rng.range(-0.3, 0.3), seed: rng.next() } : null));
  const holeThick = holes.map((h) => h.map(() => 0.9 + rng.next() * 0.6));
  return { outer, holes, thick, holeThick, drops };
}

// ---------------------------------------------------------------------------------------
// textures: the flagstone pattern itself is procedural (shader, crisp at the lens); painted here are
// the macro layer (outline alpha, grime / worn patches / edge dirt, puddles) and the crack network.
// ---------------------------------------------------------------------------------------
function paintMacro(rng, geo, ppm) {
  const W = Math.round((R.x1 - R.x0) * ppm), H = Math.round((R.z1 - R.z0) * ppm);
  const ca = makeCanvas(W, H), cm = makeCanvas(W, H);
  const a = ca.getContext('2d', { willReadFrequently: true }), m = cm.getContext('2d', { willReadFrequently: true });
  for (const c of [a, m]) c.setTransform(ppm, 0, 0, ppm, -R.x0 * ppm, -R.z0 * ppm);
  // material: R = puddle wetness (0 = the per-slab bimodal gloss decides), G = dust (matte, lighter), B = unused
  m.fillStyle = 'rgb(0,0,0)'; m.fillRect(R.x0, R.z0, R.x1 - R.x0, R.z1 - R.z0);
  const clip = new Path2D();
  const addPoly = (pts) => { clip.moveTo(pts[0].x, pts[0].z); for (let i = 1; i < pts.length; i++) clip.lineTo(pts[i].x, pts[i].z); clip.closePath(); };
  addPoly(geo.outer); for (const h of geo.holes) addPoly(h);
  a.save(); a.clip(clip, 'evenodd');
  // base stone colour (the shader multiplies it by the procedural per-slab tone)
  a.fillStyle = 'rgb(26,27,35)'; a.fillRect(R.x0, R.z0, R.x1 - R.x0, R.z1 - R.z0);
  // grime and worn patches
  for (let i = 0; i < 160; i++) {
    const ex = rng.range(R.x0, R.x1), ez = rng.range(R.z0, R.z1), er = rng.range(0.3, 2.2);
    const dark = rng.next() < 0.62;
    const rg = a.createRadialGradient(ex, ez, 0, ex, ez, er);
    rg.addColorStop(0, dark ? `rgba(4,4,10,${rng.range(0.25, 0.55)})` : `rgba(70,72,90,${rng.range(0.12, 0.3)})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = rg; a.fillRect(ex - er, ez - er, er * 2, er * 2);
  }
  // darker weathering toward the broken outline
  a.save(); a.strokeStyle = 'rgb(3,3,8)'; a.lineJoin = 'round';
  for (const [w, al] of [[2.4, 0.18], [1.2, 0.25], [0.5, 0.35]]) { a.lineWidth = w; a.globalAlpha = al; a.stroke(clip); }
  a.restore();
  // dust patches (lighter, matte)
  m.save(); m.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const ex = rng.range(R.x0, R.x1), ez = rng.range(R.z0, R.z1), er = rng.range(0.2, 0.8);
    const rg = m.createRadialGradient(ex, ez, 0, ex, ez, er);
    rg.addColorStop(0, 'rgba(0,160,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = rg; m.fillRect(ex - er, ez - er, er * 2, er * 2);
  }
  m.restore();
  // puddles: mirror-wet pools spanning several slabs
  for (let i = 0; i < 26; i++) {
    const ex = rng.range(R.x0 + 1, R.x1 - 1), ez = rng.range(-12, 13.5), er = rng.range(0.4, 1.8);
    const sx = rng.range(1, 2.8), rot = rng.range(-0.3, 0.3);
    m.save(); m.translate(ex, ez); m.rotate(rot); m.scale(sx, 1);
    const rg = m.createRadialGradient(0, 0, 0, 0, 0, er);
    rg.addColorStop(0, 'rgba(255,0,0,1)'); rg.addColorStop(0.7, 'rgba(255,0,0,0.9)'); rg.addColorStop(1, 'rgba(255,0,0,0)');
    m.fillStyle = rg; m.beginPath(); m.arc(0, 0, er, 0, TAU); m.fill(); m.restore();
  }
  a.restore();
  // mottling (two scales) baked into the albedo
  a.setTransform(1, 0, 0, 1, 0, 0);
  const img = a.getImageData(0, 0, W, H), d = img.data;
  const n1 = vgrid(rng, Math.round((R.x1 - R.x0) / 0.6), Math.round((R.z1 - R.z0) / 0.6)), n3 = vgrid(rng, Math.round((R.x1 - R.x0) / 2.4), Math.round((R.z1 - R.z0) / 2.4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = (y * W + x) * 4;
    if (!d[j + 3]) continue;
    const k = 1 + vsamp(n1, x / W, y / H) * 0.5 + vsamp(n3, x / W, y / H) * 0.5;
    d[j] *= k; d[j + 1] *= k; d[j + 2] *= k;
  }
  a.putImageData(img, 0, 0);
  return { ca, cm };
}
function paintCracks(rng, ppm) {
  const W = Math.round((R.x1 - R.x0) * ppm), H = Math.round((R.z1 - R.z0) * ppm);
  const ck = makeCanvas(W, H), k = ck.getContext('2d');
  k.setTransform(ppm, 0, 0, ppm, -R.x0 * ppm, -R.z0 * ppm);
  k.fillStyle = '#000'; k.fillRect(R.x0, R.z0, R.x1 - R.x0, R.z1 - R.z0);
  // R = coverage, G = reveal order * coverage ('lighten' = per-channel max on black)
  k.globalCompositeOperation = 'lighten'; k.lineCap = 'round'; k.lineJoin = 'round';
  const px = 1 / ppm;
  const net = (ox, oz, n, len) => {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rng.range(-0.3, 0.3);
      crackNet(k, rng, ox + Math.cos(ang) * 0.1, oz + Math.sin(ang) * 0.1, ang, len * rng.range(0.6, 1.1), 0, px, 0, 0.075);
    }
  };
  net(-4, 0, 8, 4.5);
  net(4, 0, 8, 4.5);
  crackNet(k, rng, -3.75, 0.05, -0.05, 7.4, 0, px, 0.25, 0.06);
  crackNet(k, rng, 3.75, -0.05, Math.PI + 0.05, 7.4, 0, px, 0.25, 0.06);
  return ck;
}
// crack: gently curving main direction (+-0.3 rad per segment, rare hard kinks) with a fine zigzag between
// segment ends; width tapers from w0 at the origin to 1.5 cm; G = reveal order (1 near the fighters -> 0.06)
function crackNet(k, rng, x, z, ang, len, depth, px, d0, w0) {
  const total = 7.6, minW = px * 3;
  let L = 0;
  while (L < len) {
    const st = rng.range(0.25, 0.6) * (depth ? 0.8 : 1);
    if (rng.next() < 0.15) ang += rng.sign() * rng.range(0.4, 0.7);
    else ang += rng.range(-0.13, 0.13);
    const nx = x + Math.cos(ang) * st, nz = z + Math.sin(ang) * st;
    const f0 = L / len, f1 = Math.min(1, (L + st) / len);
    const wa = Math.max(minW, lerp(w0, 0.015, Math.sqrt(f0))), wb = Math.max(minW, lerp(w0, 0.015, Math.sqrt(f1)));
    const v = clamp(1 - (d0 + L) / total, 0.06, 1);
    k.strokeStyle = `rgb(255,${Math.round(v * 255)},0)`;
    // fine zigzag: 3 sub-points displaced across the segment
    const tx = Math.cos(ang), tz = Math.sin(ang);
    const pts = [[x, z]];
    for (let s = 1; s < 4; s++) { const u = s / 4, o = rng.range(-1, 1) * st * 0.04; pts.push([x + (nx - x) * u - tz * o, z + (nz - z) * u + tx * o]); }
    pts.push([nx, nz]);
    for (let s = 0; s < 4; s++) {
      k.lineWidth = lerp(wa, wb, (s + 0.5) / 4);
      k.beginPath(); k.moveTo(pts[s][0], pts[s][1]); k.lineTo(pts[s + 1][0], pts[s + 1][1]); k.stroke();
    }
    if (depth < 2 && rng.next() < 0.14) crackNet(k, rng, nx, nz, ang + rng.sign() * rng.range(0.5, 1.1), (len - L) * rng.range(0.35, 0.7), depth + 1, px, d0 + L, wb * 0.75);
    x = nx; z = nz; L += st;
  }
}
// bilinear value-noise grid (cheap per-pixel sampling)
function vgrid(rng, gw, gh) { const g = new Float32Array((gw + 1) * (gh + 1)); for (let i = 0; i < g.length; i++) g[i] = rng.next() - 0.5; return { g, gw, gh }; }
function vsamp(G, u, v) {
  const x = u * G.gw, y = v * G.gh, ix = Math.min(G.gw - 1, x | 0), iy = Math.min(G.gh - 1, y | 0), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = G.gw + 1, g = G.g;
  const a = g[iy * w + ix], b = g[iy * w + ix + 1], c = g[(iy + 1) * w + ix], d = g[(iy + 1) * w + ix + 1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------
const cache = {};
/** buildStage(seed=3, {ppm=60 (macro texture), crackPpm=90, props=true, rubble=80}) -> stage. Optional: drawStage builds lazily; call it in setup. */
export function buildStage(seed = 3, opts = {}) {
  const key = `${seed}:${opts.ppm ?? 60}:${opts.props !== false}`;
  if (cache[key]) return cache[key];
  const rng = new RNG(seed);
  const geo = makeGeometry(rng);
  const ppm = opts.ppm ?? 60;
  const { ca, cm } = paintMacro(rng, geo, ppm);
  const ck = paintCracks(rng, opts.crackPpm ?? 90);
  let props = null;
  if (opts.props !== false) props = buildRuins(seed + 101, { layout: propsLayout(rng, geo), quality: 1 });
  // loose rubble lying on the flagstones (kept off the fighters' marks and the centre line)
  const rubble = makeDebris(seed + 7, {
    count: opts.rubble ?? 80, ground: true, dust: 0, sizeMin: 0.05, sizeMax: 0.5, sizePow: 1.9,
    box: { x0: -13.5, x1: 13.5, y0: 0, y1: 0, z0: -11, z1: 12.5 },
    avoid: [{ x0: -6.2, x1: -1.8, z0: -6.5, z1: 1.6 }, { x0: 1.8, x1: 6.2, z0: -6.5, z1: 1.6 }, { x0: -1.4, x1: 1.4, z0: -13, z1: 3 }],
  });
  rubble.rocks = rubble.rocks.filter((r) => inPolyXZ(geo.outer, r.x, r.z) && !geo.holes.some((h) => inPolyXZ(h, r.x, r.z)));
  const st = { geo, ca, cm, ck, ppm, props, rubble, tex: null, seed };
  cache[key] = st;
  return st;
}
function inPolyXZ(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c; } return c; }
function farEdgeZ(geo, x) {
  // max z of the outline near this x (far edge)
  let best = -1e9;
  for (const p of geo.outer) if (Math.abs(p.x - x) < 0.6 && p.z > best) best = p.z;
  return best;
}
function propsLayout(rng, geo) {
  const L = [];
  // balustrade segments along the far edge, broken into pieces with gaps
  const segs = [[-12.2, -7.6], [-6.4, -1.2], [-0.2, 4.2], [9.9, 12.6]];
  for (const [a, b] of segs) {
    const w = b - a, cx = (a + b) / 2;
    const zf = Math.min(farEdgeZ(geo, a + 0.4), farEdgeZ(geo, b - 0.4), farEdgeZ(geo, cx));
    if (zf < 0) continue;
    L.push({ kind: 'balustrade', x: cx, y: 0, z: zf - 0.55, o: { w: w - 0.5, gap: rng.next() < 0.6, missing: 0.14 }, ppmK: 1.6 });
  }
  // broken posts / column stumps along the side edges
  const posts = [[-13.0, 7.5, 'pier', 2.6], [-13.2, 1.0, 'column', 1.6], [-12.6, -5.5, 'pier', 3.4], [12.8, 8.6, 'column', 2.4], [13.0, 0.5, 'pier', 1.5], [12.4, -6.5, 'column', 3.1]];
  for (const [x, z, kind, h] of posts) {
    if (!inPolyXZ(geo.outer, x, z)) continue;
    const o = kind === 'pier' ? { w: 0.9, h, capital: false, brokenTop: true, base: true } : { r: 0.42, h, capital: false, brokenTop: true, base: true };
    L.push({ kind, x, y: 0, z, o, ppmK: 2.2 });
  }
  return L;
}

// ---------------------------------------------------------------------------------------
// GL floor shader
// ---------------------------------------------------------------------------------------
const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FS_FLOOR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uAlb, uMat, uCrk, uScene;
uniform vec4 uRect;
uniform vec4 uLA, uLB; uniform vec3 uLAC, uLBC;
uniform float uWet, uCracks, uGlowCracks, uMode, uTime, uSceneRefl, uFogD, uPool, uStreak, uSplitX, uReflDist, uExposure, uMoonK, uGlint, uSlabRot, uSlabK;
uniform vec3 uGlowA, uGlowB, uMoon;
${GLSL_COMMON}
${GLSL_RAY}
${GLSL_DEPTH}
// ---- procedural random-ashlar flagstones: crisp SDF edges at any distance ----
const float SB = 1.9;
struct Slab { float sd; vec2 id; vec2 c; float lip; };
// random ashlar: rows of big squares (offset per row), each k-d split 2-4 times into slabs of 0.6-1.2 m
Slab slabAt(vec2 p){
  float j = floor(p.y / SB);
  float off = h12(vec2(j, 7.13)) * SB;
  float k = floor((p.x + off) / SB);
  vec2 lo = vec2(k * SB - off, j * SB), hi = lo + SB;
  vec2 id = vec2(k, j);
  for(int l = 0; l < 4; l++){
    vec2 sz = hi - lo;
    float h = h12(id + float(l) * 13.1);
    if(max(sz.x, sz.y) < 0.6 + 0.55 * h) break;
    bool sx = sz.x > sz.y * 1.3 ? true : (sz.y > sz.x * 1.3 ? false : h < 0.5);
    float f = 0.3 + 0.4 * h12(id + float(l) * 7.7 + 3.0);
    if(sx){ float m = mix(lo.x, hi.x, f); if(p.x < m){ hi.x = m; id = id * 1.37 + 0.11; } else { lo.x = m; id = id * 1.37 + 0.73; } }
    else { float m = mix(lo.y, hi.y, f); if(p.y < m){ hi.y = m; id = id * 1.29 + 0.37; } else { lo.y = m; id = id * 1.29 + 0.91; } }
  }
  lo += vec2(h12(id + 13.7), h12(id + 17.3)) * vec2(0.03, 0.06);
  hi -= vec2(h12(id + 27.3), h12(id + 21.9)) * vec2(0.03, 0.06);
  float g = 0.004 + 0.007 * h12(id + 9.1);
  vec2 c = (lo + hi) * 0.5, e = max((hi - lo) * 0.5 - g, vec2(0.02));
  float rc = 0.012 + 0.05 * h12(id + 4.4);
  vec2 qq = abs(p - c) - e + rc;
  Slab s;
  s.sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - rc;
  s.id = id; s.c = c; s.lip = p.y - (c.y - e.y);
  return s;
}
vec3 streak(vec4 L, vec3 C, vec2 px, float gloss){
  if(L.w <= 0.0) return vec3(0.0);
  vec3 F = vec3(L.x, 0.0, L.z), M = vec3(L.x, -L.y, L.z);
  if(F.z - uCam.z < 0.3) return vec3(0.0);
  vec2 sf = projectW(F), sm = projectW(M);
  float ppm = uFocal / max(M.z - uCam.z, 0.3);
  float len = max(sm.y - sf.y, 4.0) * 3.5 + 140.0;
  float dy = (px.y - sf.y) / len;
  float wx = max(5.0, 0.55 * ppm) * (1.0 + max(dy, 0.0) * 1.6);
  float dx = (px.x - sm.x) / wx;
  float rip = 0.45 + 0.55 * vn(vec2(px.x * 0.09, px.y * 0.012 + L.x));
  float core = exp(-dx * dx) * smoothstep(-0.04, 0.03, dy) * exp(-max(dy, 0.0) * 1.7);
  float halo = exp(-dx * dx * 0.08) * smoothstep(-0.1, 0.05, dy) * exp(-max(dy, 0.0) * 2.6) * 0.22;
  return C * (core * rip + halo) * mix(0.2, 1.2, gloss);
}
void main(){
  vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
  vec3 rd = rayDir(px);
  if(rd.y <= 1e-4) discard;
  float t = -uCam.y / rd.y;
  if(t <= 0.0) discard;
  vec3 P = uCam + rd * t;
  vec2 uv = (P.xz - uRect.xy) / (uRect.zw - uRect.xy);
  if(uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 A = texture(uAlb, uv);
  if(A.a < 0.004) discard;
  gl_FragDepth = winDepth(t * rd.z);
  vec4 Mt = texture(uMat, uv);
  vec3 base = toLin(A.rgb / A.a);
  float fw = length(fwidth(P.xz));
  // flagstones (pattern slightly rotated + a gentle settling warp so no grout line is ruler-straight)
  float cr = cos(uSlabRot), sr = sin(uSlabRot);
  vec2 q = vec2(P.x * cr - P.z * sr, P.x * sr + P.z * cr) * uSlabK;
  q.y += 0.1 * sin(q.x * 0.33 + 1.3) + 0.05 * sin(q.x * 0.91 + 0.4);
  Slab s = slabAt(q);
  float chip = (vn(q * 11.0) - 0.5) * 0.024 + (vn(q * 37.0) - 0.5) * 0.01;
  float sd = s.sd + chip;
  float aa = max(fw * 0.7, 1e-4);
  // joints never thinner than ~1 px (no shimmering), physically 1-2 cm wide up close
  float inside = 1.0 - smoothstep(-aa - fw * 0.4, aa - fw * 0.4, sd);
  // worn, rounded slab edges: a soft darkening band just inside the joint (reads as relief up close)
  float bev = smoothstep(-0.05 - fw, -0.004, sd);
  float hs = h12(s.id + 1.7), hw = h12(s.id + 8.8), hr = h12(s.id + 6.6), hp = h12(s.id + 77.7);
  float tone = hs < 0.12 ? 0.6 : hs > 0.85 ? 1.3 + (hs - 0.85) * 2.5 : 0.8 + hs * 0.35;
  vec2 gdir = vec2(cos(hr * 6.283), sin(hr * 6.283));
  tone *= clamp(1.0 + dot(q - s.c, gdir) * 0.4, 0.6, 1.4);
  float missing = step(hp, 0.022);
  vec3 alb = base * tone;
  alb *= 1.0 - bev * 0.45;
  alb = mix(base * 0.08, alb, inside * (1.0 - missing * 0.85));
  float raised = step(0.35, hr) * (1.0 - missing);
  // gloss: bimodal per slab (30 % mirror-wet), puddles from the macro map, dust kills it, grout stays dull
  float gloss = hw > 0.7 ? 0.8 + 0.2 * h12(s.id + 3.1) : 0.05 + 0.12 * h12(s.id + 3.1);
  gloss = max(gloss, Mt.r);
  gloss *= 1.0 - Mt.g * 0.8;
  gloss *= mix(0.25, 1.0, inside) * (1.0 - missing);
  float wetM = smoothstep(0.45, 0.75, gloss);
  float lip = raised * inside * (1.0 - smoothstep(0.0, 0.022 + fw * 1.5, s.lip + chip * 0.5));
  // energy cracks: coverage + premultiplied reveal order -> mip-safe ratio; wider blurred lip from a coarser mip
  float rev = step(0.001, uCracks), th = 1.0 - uCracks;
  vec4 K = texture(uCrk, uv, -1.0);
  vec4 Kb = texture(uCrk, uv, 2.2);
  float core = K.r * smoothstep(th, th + 0.06, K.g / max(K.r, 1e-3)) * rev;
  float clip_ = Kb.r * smoothstep(th, th + 0.06, Kb.g / max(Kb.r, 1e-3)) * rev;
  // procedural grain / pits / flecks (stay sharp right at the lens)
  float g1 = fbmN(P.xz * 3.1) - 0.5, g2 = vn(P.xz * 38.0) - 0.5, g3 = vn(P.xz * 140.0) - 0.5;
  float nearK = 1.0 - smoothstep(0.012, 0.045, fw), nearK2 = 1.0 - smoothstep(0.004, 0.012, fw);
  alb *= 1.0 + g1 * 0.55 + g2 * 0.7 * nearK + g3 * 0.8 * nearK2;
  float pit = step(0.88, vn(P.xz * 55.0 + 3.7)) * nearK, fleck = step(0.93, vn(P.xz * 71.0 - 9.1)) * nearK;
  alb *= 1.0 - pit * 0.6; alb += vec3(0.01, 0.01, 0.014) * fleck * inside;
  alb *= 1.0 - clamp(clip_ * 1.4, 0.0, 0.55);
  alb *= 1.0 - core * 0.9;
  vec3 col = alb;
  vec3 em = vec3(0.0);
  // energy light pools
  float sx = smoothstep(-4.0, 4.0, P.x - uSplitX);
  for(int i = 0; i < 2; i++){
    vec4 L = i == 0 ? uLA : uLB; vec3 C = i == 0 ? uLAC : uLBC;
    if(L.w <= 0.0) continue;
    vec3 d = L.xyz - P; float dist = length(d);
    float att = exp(-dist * dist / (uPool * uPool));   // confined pool: the floor between / away from the fighters stays dark
    float ndl = clamp(-d.y / dist, 0.0, 1.0);
    col += (alb * 3.0 + 0.008 * inside) * C * att * (0.35 + 0.65 * ndl);
    col += C * lip * att * 0.12;
  }
  // reflections: per-slab tilt + wet ripple perturb the mirror direction, so the sky / ruins break up slab by slab
  vec2 tilt = (vec2(h12(s.id + 2.2), h12(s.id + 4.9)) - 0.5) * 0.06 * raised + (vec2(vn(q * 3.0), vn(q * 3.0 + 7.0)) - 0.5) * 0.025;
  vec3 N = normalize(vec3(tilt.x, -1.0, tilt.y));
  vec3 Rr = reflect(rd, N); Rr.y = min(Rr.y, -0.01);
  float cosT = clamp(rd.y, 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  float spec = mix(0.02, 1.3, wetM) * uWet * (1.0 - core) * (1.0 - pit * 0.6) * (0.7 + 0.6 * fbmN(q * vec2(1.2, 3.5) + 11.0));
  vec3 refl = fogSky(Rr) * 0.8;
  if(uSceneRefl > 0.0){
    vec2 sp = projectW(P + Rr * uReflDist);
    vec4 acc = vec4(0.0); float ws = 0.0;
    float rough = mix(10.0, 0.7, gloss * gloss) * uRes.y / 1080.0;
    for(int k = 0; k < 6; k++){
      float fk = float(k);
      vec2 qs = sp + vec2((h12(px + fk) - 0.5) * rough * 0.6, fk * rough);
      vec4 sc = texture(uScene, qs / uRes);
      float w = 1.0 - fk * 0.12;
      acc += sc * w; ws += w;
    }
    acc /= ws;
    vec3 sc = acc.a > 0.001 ? toLin(acc.rgb / acc.a) : vec3(0.0);
    refl = mix(refl, sc * 0.95, acc.a * uSceneRefl);
  }
  col += refl * F * spec;
  // raised near-edge lips catch the sky like a polished bevel
  col += (refl * F * 0.9 * uWet + uMoon * 0.025 * uMoonK) * lip * (1.0 - core);
  // sparse white glints on wet stone
  float nearG = 1.0 - smoothstep(0.012, 0.04, fw);
  float gl1 = step(0.986, vn(P.xz * 42.0)) * nearG * inside;
  col += uMoon * gl1 * (0.3 + F) * 1.6 * gloss * uGlint * uWet;
  vec3 st = streak(uLA, uLAC, px, gloss) + streak(uLB, uLBC, px, gloss);
  col += st * uStreak * uWet * (1.0 - core * 0.5) * mix(0.35, 1.0, inside);
  // glowing cracks: emit only the core, white-hot where it is widest
  vec3 gcol = mix(uGlowA, uGlowB, sx);
  // energy seeping through the joints around each fighter (grows with the crack reveal, broken up per joint piece)
  float dA = uLA.w > 0.0 ? length(P.xz - uLA.xz) : 1e3, dB = uLB.w > 0.0 ? length(P.xz - uLB.xz) : 1e3;
  float dmin = min(dA, dB);
  float seepR = uCracks * 3.2 * (0.75 + 0.5 * vn(P.xz * 0.9 + 3.0));
  float jsel = step(0.45, h12(floor(q * 1.7) + 0.5));
  float seep = (1.0 - inside) * jsel * (1.0 - smoothstep(seepR * 0.6, seepR, dmin)) * rev * (1.0 - missing);
  em += gcol * seep * uGlowCracks * 0.9;
  col += gcol * seep * uGlowCracks * 0.25;
  float flick = 0.7 + 0.3 * vn(P.xz * 2.0 + floor(uTime * 24.0) * 3.1);
  vec3 hot = mix(gcol, vec3(1.0) * max(max(gcol.r, gcol.g), gcol.b), pow(core, 4.0) * 0.6);
  em += hot * core * uGlowCracks * flick * 1.4;
  col += gcol * core * uGlowCracks * 0.45;
  em += st * uStreak * uWet * 0.35 * mix(0.35, 1.0, inside);
  // the shared aerial fog curve
  float f = fogAmt(t, uFogD);
  col = mix(col, fogSky(rd), f);
  em *= 1.0 - f;
  float a = A.a;
  if(uMode < 0.5) o = vec4(toSrgb(col * uExposure) * a, a);
  else o = vec4(toSrgb(em) * a, a);
}`;

function ensureStageTex(G, st) {
  if (st.tex && st.texG === G) return;
  st.tex = {
    alb: glTexture(G, st.ca, { mips: true, aniso: 16 }),
    mat: glTexture(G, st.cm, { mips: true, aniso: 16, premul: false }),
    crk: glTexture(G, st.ck, { mips: true, aniso: 16, premul: false }),
    scene: glTexture(G, makeCanvas(4, 4), { mips: false }),
  };
  st.texG = G;
  st.ca.width = st.ca.height = 1; st.cm.width = st.cm.height = 1; st.ck.width = st.ck.height = 1;
}

// tileable rock texture for the broken edge faces: horizontal strata + grain + pits (multiplied, 1.0 = white)
let EDGE_TEX = null;
function edgeTex() {
  if (EDGE_TEX) return EDGE_TEX;
  const N = 256, c = makeCanvas(N, N), g = c.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  const rng = new RNG(77);
  const mk = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rng.next(); return { a, n }; };
  const sm = (G, u, v) => { const x = u * G.n, y = v * G.n, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const at = (i, j) => G.a[((j % G.n) + G.n) % G.n * G.n + ((i % G.n) + G.n) % G.n]; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return lerp(lerp(at(ix, iy), at(ix + 1, iy), sx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy); };
  const A = mk(8), B = mk(32), Cn = mk(64), St = mk(16);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const strata = sm(St, u * 0.15, v) ;
    let k = 0.55 + 0.3 * sm(A, u, v) + 0.25 * sm(B, u, v) + 0.2 * (sm(Cn, u, v) - 0.5) + 0.35 * (strata - 0.5);
    if (sm(Cn, u * 2, v * 2) > 0.8) k *= 0.45;
    const val = Math.round(clamp(k, 0.15, 1) * 255), j = (y * N + x) * 4;
    d[j] = d[j + 1] = d[j + 2] = val; d[j + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (EDGE_TEX = c);
}
// side faces of the broken edges facing the camera (drawn into scene before the floor top) + hanging drops
function drawEdges(S, st) {
  const { cam } = S;
  const ctx = S.L.scene;
  const geo = st.geo;
  const faces = [];
  const addRing = (pts, th, isHole, drops) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      if (L < 1e-4) continue;
      // outward normal of the CCW outer ring; hole walls face into the hole (= its inward normal)
      let nx = dz / L, nz = -dx / L;
      if (isHole) { nx = -nx; nz = -nz; }
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (nx * (cam.x - mx) + nz * (cam.z - mz) <= 0) continue;
      faces.push({ a, b, ta: th[i], tb: th[(i + 1) % n], z: mz, nx, nz, drop: drops ? drops[i] : null, tx: dx / L, tz: dz / L });
    }
  };
  addRing(geo.outer, geo.thick, false, geo.drops);
  geo.holes.forEach((h, i) => addRing(h, geo.holeThick[i], true, null));
  faces.sort((p, q) => q.z - p.z);
  const pat = ctx.createPattern(edgeTex(), 'repeat');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const f of faces) {
    const p0 = cam.project(f.a.x, 0, f.a.z), p1 = cam.project(f.b.x, 0, f.b.z);
    const p2 = cam.project(f.b.x, f.tb, f.b.z), p3 = cam.project(f.a.x, f.ta, f.a.z);
    if (!p0 || !p1 || !p2 || !p3) continue;
    const minx = Math.min(p0.x, p1.x, p2.x, p3.x), maxx = Math.max(p0.x, p1.x, p2.x, p3.x);
    if (maxx < -200 || minx > S.W + 200) continue;
    // gradient anchored to a fixed world depth (2.5 m) so neighbouring jagged segments shade identically
    const gm = cam.project((f.a.x + f.b.x) / 2, 0, (f.a.z + f.b.z) / 2), gb = cam.project((f.a.x + f.b.x) / 2, 2.5, (f.a.z + f.b.z) / 2);
    const g = ctx.createLinearGradient(0, gm ? gm.y : p0.y, 0, gb ? gb.y : p3.y);
    const lit = f.nx < -0.3 ? 1.25 : f.nx > 0.3 ? 0.75 : 1; // faces turned to the moon side (left) a touch lighter
    g.addColorStop(0, `rgb(${40 * lit | 0},${41 * lit | 0},${54 * lit | 0})`); g.addColorStop(0.1, `rgb(${22 * lit | 0},${23 * lit | 0},${31 * lit | 0})`); g.addColorStop(1, 'rgb(6,6,11)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke(); // hide AA seams between segments
    // rock texture (world-scaled strata / grain), multiplied in
    if (pat) {
      const sc = Math.max(0.02, p0.s * 1.6 / 256);
      pat.setTransform(new DOMMatrix([sc, 0, 0, sc, p0.x, p0.y]));
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pat; ctx.fill(); ctx.restore();
    }
    // strata + vertical fracture lines
    const sw = Math.max(0.8, p0.s * 0.025);
    ctx.strokeStyle = 'rgba(4,4,12,0.6)'; ctx.lineWidth = sw;
    ctx.beginPath();
    for (const k of [0.22, 0.5, 0.78]) {
      const ya = cam.project(f.a.x, f.ta * k, f.a.z), yb = cam.project(f.b.x, f.tb * k, f.b.z);
      if (ya && yb) { ctx.moveTo(ya.x, ya.y); ctx.lineTo(yb.x, yb.y); }
    }
    if (f.ta > 2.5) { const q = cam.project(f.a.x, f.ta * 0.95, f.a.z); if (q) { ctx.moveTo(p0.x, p0.y + (q.y - p0.y) * 0.1); ctx.lineTo(q.x, q.y); } }
    ctx.stroke();
    // moonlit lip
    ctx.strokeStyle = 'rgba(150,156,200,0.55)'; ctx.lineWidth = clamp(p0.s * 0.01, 1, 2.5) * S.H / 1080;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    // hanging rocky drop (tapered stalactite) under this vertex
    if (f.drop) {
      const d = f.drop, base = f.ta;
      const hw = d.w * 0.5;
      const bx0 = f.a.x - f.tx * hw * 0.2, bz0 = f.a.z - f.tz * hw * 0.2;
      const pts = [];
      const nseg = 6;
      const sgn = (i) => (i % 2 ? 1 : -1);
      // left flank down to the tip, right flank back up (jagged)
      for (let i = 0; i <= nseg; i++) {
        const u = i / nseg, wk = hw * (1 - u) * (1 + 0.25 * sgn(i) * (1 - u));
        pts.push([bx0 - f.tx * wk + f.nx * d.lean * u, base + d.len * u * (0.9 + 0.1 * sgn(i)), bz0 - f.tz * wk + f.nz * d.lean * u]);
      }
      for (let i = nseg - 1; i >= 0; i--) {
        const u = i / nseg, wk = hw * (1 - u) * (1 + 0.2 * sgn(i + 1) * (1 - u));
        pts.push([bx0 + f.tx * wk + f.nx * d.lean * u, base + d.len * u * 0.85, bz0 + f.tz * wk + f.nz * d.lean * u]);
      }
      const pp = pts.map((q) => cam.project(q[0], q[1] - 0.3, q[2]));
      if (pp.every(Boolean)) {
        const top = cam.project(bx0, base - 0.3, bz0), tip = cam.project(bx0, base + d.len, bz0);
        const gd = ctx.createLinearGradient(0, top.y, 0, tip.y);
        gd.addColorStop(0, `rgb(${16 * lit | 0},${16 * lit | 0},${24 * lit | 0})`); gd.addColorStop(1, 'rgb(5,5,10)');
        ctx.fillStyle = gd;
        ctx.beginPath(); pp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
        // lit left flank (moon) hairline
        ctx.strokeStyle = 'rgba(120,126,170,0.45)'; ctx.lineWidth = Math.max(0.8, p0.s * 0.015);
        ctx.beginPath(); for (let i = 0; i <= nseg; i++) (i ? ctx.lineTo(pp[i].x, pp[i].y) : ctx.moveTo(pp[i].x, pp[i].y)); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * drawStage(S, opts)
 *  lightA, lightB   {x,y,z,color,k,range} (default: from S.env.lightA/AC, lightB/BC); null = off
 *  cracks 0..1      reveal of the energy crack network (spreads outward from both fighters (+-4, 0) and along the centre line)
 *  glowCracks 0..1+ emission of revealed cracks (blue left / red right, white-hot cores, 24 fps flicker)
 *  wet 0..1         wetness / reflectivity (default 0.85)
 *  streak (1)       strength of the vertical light streak reflections
 *  pool (5)         radius (m) of the coloured light pools
 *  glint (1)        sparse white specular glints on wet stone
 *  slabScale (1), slabRot (0.32 rad)   size / rotation of the procedural flagstone pattern (~0.86 x 0.62 m slabs)
 *  sceneRefl (1)    reflect what is already in S.L.scene (draw ruins first!), reflDist (70 m)
 *  fogDensity       (0.0022) same aerial fog curve as ruins / rocks
 *  props (true)     balustrade + broken posts on the plaza
 *  rubble (true)    loose rocks lying on the flagstones (kept off x=+-4,z=0 and the centre line)
 *  dof, focus       depth of field for the rubble (see drawDebris)
 *  edges (true)     broken edge side faces + hanging rock drops
 *  exposure (1), seed (3), t (S.t)
 *  The floor writes the shared world z-buffer: rocks / ruins drawn afterwards below floor level are hidden.
 */
export function drawStage(S, opts = {}) {
  const st = buildStage(opts.seed ?? 3, { props: opts.props !== false });
  const cam = S.cam, env = S.env;
  const G = worldGL(S.W, S.H);
  const gl = G.gl;
  ensureStageTex(G, st);
  if (opts.edges !== false) drawEdges(S, st);
  const LA = resolveLight(opts.lightA, env.lightA, env.lightAC);
  const LB = resolveLight(opts.lightB, env.lightB, env.lightBC);
  const sceneRefl = opts.sceneRefl ?? 1;
  if (sceneRefl > 0) glUpload(G, st.tex.scene, S.L.scene.canvas);
  const prog = glProgram(G, 'floor', VS_FULL, FS_FLOOR);
  const run = (mode) => {
    glFrame(G, S);
    glUse(G, prog);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(mode === 0);
    glCam(G, cam);
    envSkyUniforms(G, env);
    glTex(G, 'uAlb', 0, st.tex.alb); glTex(G, 'uMat', 1, st.tex.mat); glTex(G, 'uScene', 2, st.tex.scene); glTex(G, 'uCrk', 3, st.tex.crk);
    glSet(G, 'uRect', [R.x0, R.z0, R.x1, R.z1]);
    glSet(G, 'uLA', LA ? [LA.x, LA.y, LA.z, LA.range] : [0, 0, 0, 0]); glSet(G, 'uLAC', LA ? LA.col : [0, 0, 0]);
    glSet(G, 'uLB', LB ? [LB.x, LB.y, LB.z, LB.range] : [0, 0, 0, 0]); glSet(G, 'uLBC', LB ? LB.col : [0, 0, 0]);
    glSet(G, 'uWet', opts.wet ?? 0.85);
    glSet(G, 'uCracks', clamp(opts.cracks ?? 0, 0, 1));
    glSet(G, 'uGlowCracks', opts.glowCracks ?? 0);
    glSet(G, 'uMode', mode);
    glSet(G, 'uTime', opts.t ?? S.t);
    glSet(G, 'uSceneRefl', sceneRefl);
    glSet(G, 'uFogD', opts.fogDensity ?? FOG_DENSITY);
    glSet(G, 'uPool', opts.pool ?? 5);
    glSet(G, 'uStreak', opts.streak ?? 1);
    glSet(G, 'uGlint', opts.glint ?? 1); glSet(G, 'uSlabRot', opts.slabRot ?? 0.32); glSet(G, 'uSlabK', 1 / (opts.slabScale ?? 1));
    glSet(G, 'uSplitX', ((LA ? LA.x : -4) + (LB ? LB.x : 4)) / 2);
    glSet(G, 'uReflDist', opts.reflDist ?? 70);
    glSet(G, 'uExposure', opts.exposure ?? 1);
    glSet(G, 'uMoonK', 1);
    glSet(G, 'uMoon', [0.7, 0.7, 0.95]);
    glSet(G, 'uGlowA', LA ? LA.col.map((v) => v * 1.2) : lin3([80, 180, 255]));
    glSet(G, 'uGlowB', LB ? LB.col.map((v) => v * 1.2) : lin3([255, 60, 100]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
  };
  run(0);
  glBlit(G, S.L.scene);
  glBlit(G, S.L.emit, 'destination-out');
  run(1);
  glBlit(G, S.L.emit, 'lighter');
  if (opts.rubble !== false && st.rubble.rocks.length) drawDebris(S, st.rubble, { lightA: opts.lightA, lightB: opts.lightB, dust: false, dof: opts.dof ?? 0.55, focus: opts.focus });
  if (st.props && opts.props !== false) drawRuins(S, st.props, { lightA: opts.lightA, lightB: opts.lightB, haze: false, fogDensity: opts.fogDensity ?? FOG_DENSITY, split: 0.95, splitWidth: 2.5, fill: 0.8, rim: 0.25, emit: 0.25, rimDist: opts.propRimDist ?? 12 });
}

/** stage outline helpers for other builders: is (x,z) on the floor? */
export function onStage(x, z, seed = 3) {
  const st = buildStage(seed);
  if (!inPolyXZ(st.geo.outer, x, z)) return false;
  for (const h of st.geo.holes) if (inPolyXZ(h, x, z)) return false;
  return true;
}
