// ISSEN 一閃 — Builder C: macro insert close-ups (revision 3).
//   drawHiltCloseup(S, { t, push=0, gleam=0, sparks=0.7, sageo=true, zoom=1 })                 shot 2 (koiguchi wo kiru)
//   drawEyeCloseup(S, { t, open=1 (0..1.12), glow=0 (0..1.3, >1 = overshoot pulse), reflect=0,
//                       look={x,y}, zoom=1 })                                                  shot 3 (eye snaps open, ignites)
//   drawSheathCloseup(S, { t, k=0, click=-1, gleam=0, handBlur=9, handDark=0.45, zoom=1 })     shot 9 (noto, "chin")
//   prepareCloseups(W=1920), closeupGrade(S, 'hilt'|'eye'|'sheath')
// All three are full-frame screen-space compositions authored on a 1920x1080 grid (scaled to S.W),
// drawn through S.cam.toScreen so camera shake / roll still apply. Textures (tsuka-ito wrap, lacquer
// saya, tsuba face, iris, skin, blurred backgrounds) are pre-rendered lazily on first use (or call
// prepareCloseups(W) in setup). Everything is a pure function of the options + t (no randomness).
import { TAU, clamp, lerp, smoothstep, hash1, hash2, hash3, noise2, RNG, rgba, mixColor } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';

const RW = 1920, RH = 1080;
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const C = (c, a = 1) => rgba(typeof c === 'string' ? hex(c) : c, a);
const mixHex = (a, b, t, al = 1) => rgba(mixColor(hex(a), hex(b), clamp(t)), al);

const KAI = { core: '#eafcff', hot: '#7fe8ff', mid: '#2a9cff', deep: '#1840d0', dark: '#0a1a6e' };
const AKA = { core: '#ffe3ec', hot: '#ff6b8f', mid: '#ff1f4f', deep: '#b0002f', body0: '#4a0014', body1: '#c8102e' };
const LINE = '#0d0f22';

// ---------------------------------------------------------------------------------------------
// asset cache (built lazily at the engine resolution)
let ASSETS = null;
function assets(S) {
  const k = S.W / RW;
  if (!ASSETS || ASSETS.k !== k) ASSETS = { k };
  return ASSETS;
}
function need(a, name, fn) { if (!a[name]) a[name] = fn(a.k); return a[name]; }
export function prepareCloseups(W = 1920) {
  const a = assets({ W });
  need(a, 'tsuka', buildTsuka); need(a, 'saya', buildSaya); need(a, 'tsuba', buildTsubaFace);
  need(a, 'bokeh', buildBokeh); need(a, 'star', (k) => buildStar(k, 1)); need(a, 'starThin', (k) => buildStar(k, 0.5)); need(a, 'starMid', (k) => buildStar(k, 0.75));
  need(a, 'hiltBG', buildHiltBG); need(a, 'sheathBG', buildSheathBG);
  need(a, 'irisDark', (k) => buildIris(k, 0)); need(a, 'irisLit', (k) => buildIris(k, 1)); need(a, 'irisEmit', (k) => buildIris(k, 2));
  need(a, 'skin', buildSkin);
  return a;
}

// screen transform + internal "camera" drift (zoom/translate/rotate about frame centre)
function base(S, ctx, cam) {
  S.cam.toScreen(ctx);
  const k = S.W / RW;
  ctx.scale(k, k);
  if (cam) {
    ctx.translate(RW / 2 + (cam.x || 0), RH / 2 + (cam.y || 0));
    ctx.rotate(cam.rot || 0);
    ctx.scale(cam.zoom || 1, cam.zoom || 1);
    ctx.translate(-RW / 2, -RH / 2);
  }
}

// ---------------------------------------------------------------------------------------------
// geometry helpers
function crSample(pts, per = 8) {
  const n = pts.length, out = [];
  const g = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
function pathOf(pts, closed = true) {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  if (closed) p.closePath();
  return p;
}
function ribbonPts(line, wf) {
  const L = [], R = [], n = line.length;
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = wf(i / (n - 1), i) / 2;
    L.push([line[i][0] - dy * w, line[i][1] + dx * w]);
    R.push([line[i][0] + dy * w, line[i][1] - dx * w]);
  }
  return L.concat(R.reverse());
}
// capsule around a Catmull-Rom centre line, widths at control points, rounded caps (flatEnd < 1 squashes the end cap)
function capsule(ctrl, widths, per = 10, capN = 9, flatEnd = 1) {
  const line = crSample(ctrl, per), n = line.length;
  const wAt = (s) => { const x = s * (widths.length - 1), i = Math.min(widths.length - 2, Math.floor(x)); return lerp(widths[i], widths[i + 1], x - i); };
  const L = [], R = [], dirs = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    dirs.push([dx, dy]);
    const w = wAt(i / (n - 1)) / 2;
    L.push([line[i][0] - dy * w, line[i][1] + dx * w]);
    R.push([line[i][0] + dy * w, line[i][1] - dx * w]);
  }
  const cap = (c, d, w, a0, fl) => {
    const out = [];
    for (let j = 1; j < capN; j++) {
      const th = a0 + Math.PI * j / capN, cn = Math.cos(th), sn = Math.sin(th);
      out.push([c[0] + (-d[1]) * w * cn + d[0] * w * sn * fl, c[1] + d[0] * w * cn + d[1] * w * sn * fl]);
    }
    return out;
  };
  const wE = wAt(1) / 2, w0 = wAt(0) / 2;
  return L.concat(cap(line[n - 1], dirs[n - 1], wE, 0, flatEnd), R.reverse(), cap(line[0], dirs[0], w0, Math.PI, 1));
}

// midpoint-displacement lightning polyline (screen space)
function boltPts(a, b, seed, jit = 0.22, depth = 5) {
  const rng = new RNG(seed);
  let pts = [a, b], d = jit;
  for (let it = 0; it < depth; it++) {
    const np = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
      const off = (rng.next() * 2 - 1) * d * L;
      np.push([(p[0] + q[0]) / 2 - dy / L * off, (p[1] + q[1]) / 2 + dx / L * off], q);
    }
    pts = np; d *= 0.58;
  }
  return pts;
}
function strokePts(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
// Tapered, layered electric bolt (filled ribbons, so no overlapping round caps / beads):
// deep-blue wide fringe -> hot cyan -> white core in emit, plus a crisp white core in the scene.
// w = core width at the root (px on the 1920 grid); width tapers by (1 - taper*q) toward the tip.
function zapT(em, sc, pts, w, a, o = {}) {
  if (a <= 0.003 || pts.length < 2) return;
  const { taper = 0.7, deepW = 18 / 3.5, hotW = 8 / 3.5, deep = KAI.deep, hot = KAI.hot, core = '#ffffff', scA = 0.95 } = o;
  const rib = (k) => pathOf(ribbonPts(pts, (q) => w * k * (1 - taper * q)));
  em.save(); em.globalCompositeOperation = 'lighter';
  em.fillStyle = C(deep, Math.min(1, 0.25 * a)); em.fill(rib(deepW));
  em.fillStyle = C(hot, Math.min(1, 0.7 * a)); em.fill(rib(hotW));
  em.fillStyle = C(core, Math.min(1, a)); em.fill(rib(1));
  em.restore();
  if (sc && scA > 0) { sc.save(); sc.fillStyle = C('#f2feff', Math.min(1, scA * a)); sc.fill(rib(0.75)); sc.restore(); }
}

// ---------------------------------------------------------------------------------------------
// shared sprites
function buildBokeh(k) {
  const mk = (col, ring = 0.9) => {
    const s = Math.ceil(160 * k), c = makeCanvas(s, s), g = c.getContext('2d'), r = s / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(col, 0.42)); gr.addColorStop(0.62, rgba(col, 0.5)); gr.addColorStop(ring, rgba(col, 0.95));
    gr.addColorStop(0.96, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
    return c;
  };
  return {
    blue: mk([60, 140, 255]), cyan: mk([127, 232, 255]), white: mk([215, 222, 255]), red: mk([255, 50, 95]),
    pink: mk([255, 120, 160]), violet: mk([150, 110, 255]),
  };
}
// 4-point "kiran" glint. thin < 1 makes the rays finer (crisp anime gleam)
function buildStar(k, thin = 1) {
  const s = Math.ceil(512 * k), c = makeCanvas(s, s), g = c.getContext('2d'), r = s / 2;
  g.translate(r, r);
  g.globalCompositeOperation = 'lighter';
  const ray = (len, wid, a) => {
    const gr = g.createLinearGradient(-len, 0, len, 0);
    gr.addColorStop(0, 'rgba(120,200,255,0)'); gr.addColorStop(0.42, `rgba(170,230,255,${0.5 * a})`);
    gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(0.58, `rgba(170,230,255,${0.5 * a})`); gr.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, TAU); g.fill();
  };
  ray(r * 0.98, r * 0.024 * thin, 1);
  g.save(); g.rotate(Math.PI / 2); ray(r * 0.62, r * 0.02 * thin, 0.9); g.restore();
  g.save(); g.rotate(Math.PI / 4); ray(r * 0.3, r * 0.012 * thin, 0.45 * thin); g.restore();
  g.save(); g.rotate(-Math.PI / 4); ray(r * 0.3, r * 0.012 * thin, 0.45 * thin); g.restore();
  const cr = r * (thin < 1 ? 0.07 : 0.16);
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, cr);
  cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(0.3, 'rgba(200,245,255,0.75)'); cg.addColorStop(1, 'rgba(60,150,255,0)');
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, cr, 0, TAU); g.fill();
  return c;
}
function drawStar(ctx, A, x, y, size, a, rot = 0, spr = null) {
  if (a <= 0.003) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(spr || need(A, 'star', (k) => buildStar(k, 1)), -size / 2, -size / 2, size, size);
  ctx.restore();
}

// soft drifting bokeh field (deterministic), drawn into scene ('lighter') + a little into emit
function bokehField(sc, em, A, o) {
  const { seed = 1, n = 18, t = 0, palette = ['blue', 'cyan', 'white'], rMin = 18, rMax = 120, alpha = 0.35, drift = [12, -8], box = [-100, -100, 2020, 1180], emitK = 0.25 } = o;
  const B = need(A, 'bokeh', buildBokeh);
  for (let i = 0; i < n; i++) {
    const h1 = hash2(seed, i * 1.7), h2 = hash2(seed + 3.3, i * 2.1), h3 = hash2(seed + 7.1, i * 0.9), h4 = hash2(seed + 9.4, i * 3.3);
    const r = lerp(rMin, rMax, h3 * h3);
    const W = box[2] - box[0], H = box[3] - box[1];
    const sp = 0.4 + 0.6 * (r / rMax);
    const x = box[0] + ((h1 * W + drift[0] * sp * t) % W + W) % W;
    const y = box[1] + ((h2 * H + drift[1] * sp * t) % H + H) % H;
    const tw = 0.75 + 0.25 * Math.sin(t * (1.3 + h4 * 2) + h4 * 30);
    const spr = B[palette[Math.floor(h4 * palette.length) % palette.length]];
    const a = alpha * tw * lerp(0.45, 1, 1 - h3);
    sc.save(); sc.globalCompositeOperation = 'lighter'; sc.globalAlpha = a;
    sc.drawImage(spr, x - r, y - r, r * 2, r * 2); sc.restore();
    if (em && emitK > 0) { em.save(); em.globalCompositeOperation = 'lighter'; em.globalAlpha = a * emitK; em.drawImage(spr, x - r, y - r, r * 2, r * 2); em.restore(); }
  }
}

// closed-form spark particles (streaks). origin fn(i, cycle) -> {x,y,dir}
function sparkBurst(em, sc, o) {
  const { n = 30, t = 0, seed = 1, period = 0.45, life = 0.35, speed = 900, g = 1400, spread = 1.2, len = 0.018, w = 2.2, k = 1, origin, once = false } = o;
  if (k <= 0) return;
  em.save(); em.globalCompositeOperation = 'lighter'; em.lineCap = 'round';
  if (sc) { sc.save(); sc.lineCap = 'round'; }
  for (let i = 0; i < n; i++) {
    const ph = once ? 0 : hash2(seed, i * 7.31);
    const tt = t + ph * period;
    const cyc = once ? 0 : Math.floor(tt / period), age = once ? t : tt - cyc * period;
    const lf = life * (0.45 + 0.9 * hash2(i * 1.3 + seed, cyc));
    if (age < 0 || age > lf || hash2(i * 3.7, cyc + seed) > k) continue;
    const og = origin(i, cyc);
    const ang = og.dir + (hash2(i * 5.1 + seed, cyc * 1.7) - 0.5) * spread;
    const sp = speed * (0.35 + 0.9 * hash2(i * 2.9, cyc + seed * 3));
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    const x = og.x + vx * age, y = og.y + vy * age + 0.5 * g * age * age;
    const cvx = vx, cvy = vy + g * age;
    const f = 1 - age / lf;
    const L = len * (0.6 + f);
    const x0 = x - cvx * L, y0 = y - cvy * L;
    const ww = w * (0.5 + 0.8 * hash1(i * 9.7 + seed)) * (0.4 + 0.6 * f);
    em.strokeStyle = C(KAI.mid, 0.45 * f); em.lineWidth = ww * 4;
    em.beginPath(); em.moveTo(x0, y0); em.lineTo(x, y); em.stroke();
    em.strokeStyle = C(KAI.hot, 0.9 * f); em.lineWidth = ww * 1.7; em.stroke();
    em.strokeStyle = C(KAI.core, f); em.lineWidth = ww * 0.7; em.stroke();
    if (sc) { sc.strokeStyle = C('#f2fdff', 0.9 * f); sc.lineWidth = ww * 0.8; sc.beginPath(); sc.moveTo(x0, y0); sc.lineTo(x, y); sc.stroke(); }
  }
  em.restore(); if (sc) sc.restore();
}

// ---------------------------------------------------------------------------------------------
// KATANA MACRO RIG
// local sword coords: u (cm) along the sword axis (+u toward the kashira / hilt end, u=0 at the koiguchi
// plane), v (cm) perpendicular in the picture plane (+v toward the mune/bottom; the edge faces -v).
// The camera sits on the -u side, slightly off-axis: cross-sections show as ellipses with ratio e.
function rig(o) {
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  const R = Object.assign({ ca, sa }, o);
  R.s = (u) => o.s0 / (1 + o.persp * u);
  R.da = (u) => { const s = R.s(u); return s * s / o.s0; };
  R.P = (u, v) => { const s = R.s(u); return [o.ox + (ca * u - sa * v) * s, o.oy + (sa * u + ca * v) * s]; };
  R.path = (uvPts, closed = true) => pathOf(uvPts.map(([u, v]) => R.P(u, v)), closed);
  // local axis-aligned affine at u (units: cm)
  R.atAxis = (ctx, u) => { const p = R.P(u, 0); ctx.translate(p[0], p[1]); ctx.rotate(o.ang); ctx.scale(R.da(u), R.s(u)); };
  // face (disc perpendicular to the axis) at u: x = depth axis (foreshortened by e), y = v
  R.atFace = (ctx, u) => { const p = R.P(u, 0); ctx.translate(p[0], p[1]); ctx.rotate(o.ang); ctx.scale(R.s(u) * o.e, R.s(u)); };
  return R;
}
function faceEllipse(R, u, rv, rx = rv) {
  const p = R.P(u, 0), s = R.s(u), pa = new Path2D();
  pa.ellipse(p[0], p[1], Math.max(0.01, rx * R.e * s), rv * s, R.ang, 0, TAU);
  return pa;
}
// hull of two face ellipses (a short cylinder / disc of thickness u0..u1)
function discHull(R, u0, u1, rv, rx = rv) {
  const p0 = R.P(u0, 0), p1 = R.P(u1, 0), s0 = R.s(u0), s1 = R.s(u1);
  const pa = new Path2D();
  pa.ellipse(p0[0], p0[1], rx * R.e * s0, rv * s0, R.ang, Math.PI / 2, Math.PI * 1.5);
  pa.ellipse(p1[0], p1[1], rx * R.e * s1, rv * s1, R.ang, -Math.PI / 2, Math.PI / 2);
  pa.closePath();
  return pa;
}
// cylinder sprite drawn along the axis in perspective-correct slices
function drawCyl(ctx, R, spr, u0, u1, off = 0, alpha = 1) {
  const n = Math.max(2, Math.ceil((u1 - u0) / 0.3));
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < n; i++) {
    const ua = u0 + (u1 - u0) * i / n, ub = u0 + (u1 - u0) * (i + 1) / n;
    const pa = R.P(ua, 0), pb = R.P(ub, 0);
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const sN = R.s((ua + ub) / 2);
    const sxA = (ua - off - spr.U0) * spr.D;
    const sw = Math.min(spr.c.width - sxA, (ub - ua) * spr.D + 3);
    if (sxA < 0 || sw <= 0) continue;
    ctx.save();
    ctx.translate(pa[0], pa[1]); ctx.rotate(R.ang); ctx.scale(len / (ub - ua), sN);
    ctx.drawImage(spr.c, sxA, 0, sw, spr.c.height, 0, -spr.r, sw / spr.D, 2 * spr.r);
    ctx.restore();
  }
  ctx.restore();
}

// ---- tsuka (hilt) side texture: silk tsuka-ito hineri-maki over white samegawa -------------
function buildTsuka(k) {
  const D = 110 * k, L = 26, r = 1.55;
  const c = makeCanvas(Math.ceil(L * D), Math.ceil(2 * r * D)), g = c.getContext('2d');
  g.setTransform(D, 0, 0, D, 0, r * D);
  // samegawa (ray skin): ivory with nodules, recessed under the cords
  g.fillStyle = '#c3c7de'; g.fillRect(0, -r, L, 2 * r);
  const rng = new RNG(77);
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * L, y = (rng.next() * 2 - 1) * r, rr = 0.022 + rng.next() * 0.05;
    g.fillStyle = '#7c82ad'; g.beginPath(); g.arc(x + rr * 0.35, y + rr * 0.45, rr, 0, TAU); g.fill();
    g.fillStyle = rng.next() < 0.5 ? '#f3f4ff' : '#dde0f2'; g.beginPath(); g.arc(x, y, rr * 0.8, 0, TAU); g.fill();
  }
  const P = 3.1, hw = 0.47, slope = (2 * r) / P;
  // oyatsubu: one big king-nodule centred in a few windows
  for (let uc = 0.9 + P / 2; uc < L; uc += P * 2) {
    const gr = g.createRadialGradient(uc - 0.08, -0.1, 0.02, uc, 0, 0.32);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#d9dcf0'); gr.addColorStop(1, '#7c82ad');
    g.fillStyle = gr; g.beginPath(); g.arc(uc, 0, 0.3, 0, TAU); g.fill();
  }
  const band = (uc, f, ext = 1.12) => {
    const a = [uc - P / 2 * ext, -f * r * ext], b = [uc + P / 2 * ext, f * r * ext];
    return [[a[0] - hw, a[1]], [a[0] + hw, a[1]], [b[0] + hw, b[1]], [b[0] - hw, b[1]]];
  };
  const crossings = [];
  for (let uc = 0.9; uc < L + P; uc += P) crossings.push(uc);
  const poly = (pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
  // cast shadows of the cords on the samegawa
  for (const uc of crossings) for (const f of [1, -1]) {
    const b = band(uc, f).map(([x, y]) => [x + 0.07, y + 0.09]);
    g.fillStyle = 'rgba(38,42,92,0.55)'; poly(b); g.fill();
  }
  // soft recess shading inside the diamond windows (darker toward the cords)
  for (let i = -1; i < crossings.length; i++) {
    const cx = (crossings[i] ?? crossings[0] - P) + P / 2;
    g.save();
    g.beginPath(); g.moveTo(cx - P / 2 + hw, 0); g.lineTo(cx, -r + hw * slope); g.lineTo(cx + P / 2 - hw, 0); g.lineTo(cx, r - hw * slope); g.closePath();
    g.lineWidth = 0.28; g.strokeStyle = 'rgba(45,50,105,0.35)'; g.stroke();
    g.lineWidth = 0.1; g.strokeStyle = 'rgba(30,34,80,0.5)'; g.stroke();
    g.restore();
  }
  const drawBand = (uc, f, top) => {
    const b = band(uc, f);
    g.save(); poly(b); g.clip();
    const ax = b[0][0] + hw, ay = b[0][1], bx = b[2][0] - hw, by = b[2][1];
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
    const wPerp = hw * Math.abs(ny) * 1.0;
    const gr = g.createLinearGradient(uc - nx * wPerp, -ny * wPerp, uc + nx * wPerp, ny * wPerp);
    gr.addColorStop(0, '#5d6499'); gr.addColorStop(0.18, '#c9cee8'); gr.addColorStop(0.42, '#fbfcff'); gr.addColorStop(0.58, '#f1f3fd'); gr.addColorStop(0.85, '#aab0d6'); gr.addColorStop(1, '#4e5590');
    g.fillStyle = gr; g.fillRect(uc - P, -r * 1.3, 2 * P, 2.6 * r);
    // braid texture: fine twill ticks along the cord
    g.lineWidth = 0.018; g.strokeStyle = 'rgba(80,88,145,0.5)';
    const steps = Math.ceil(l / 0.085);
    for (let s = 0; s <= steps; s++) {
      const q = s / steps, px = ax + dx * q, py = ay + dy * q;
      const side = s % 2 ? 1 : -1;
      g.beginPath();
      g.moveTo(px - nx * wPerp * 0.95, py - ny * wPerp * 0.95);
      g.lineTo(px + dx / l * 0.06 * side, py + dy / l * 0.06 * side);
      g.lineTo(px + nx * wPerp * 0.95, py + ny * wPerp * 0.95);
      g.stroke();
    }
    // twist fold at the crossing for the cord on top (hineri)
    if (top) {
      g.strokeStyle = 'rgba(36,40,92,0.9)'; g.lineWidth = 0.045;
      g.beginPath(); g.moveTo(uc - 0.5, -0.12 * f); g.quadraticCurveTo(uc - 0.05, 0.22 * f, uc + 0.5, 0.12 * f); g.stroke();
      g.fillStyle = 'rgba(40,44,100,0.35)';
      g.beginPath(); g.moveTo(uc - 0.5, -0.12 * f); g.quadraticCurveTo(uc - 0.05, 0.22 * f, uc + 0.5, 0.12 * f); g.lineTo(uc + 0.5, 0.5 * f); g.lineTo(uc - 0.5, 0.5 * f); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.ellipse(uc - 0.12, -0.22, 0.26, 0.06, -0.75 * f, 0, TAU); g.fill();
    }
    g.restore();
    g.strokeStyle = '#262b5c'; g.lineWidth = 0.04;
    g.beginPath(); g.moveTo(b[0][0], b[0][1]); g.lineTo(b[3][0], b[3][1]); g.stroke();
    g.beginPath(); g.moveTo(b[1][0], b[1][1]); g.lineTo(b[2][0], b[2][1]); g.stroke();
  };
  crossings.forEach((uc, i) => {
    const firstTop = i % 2 ? 1 : -1;
    drawBand(uc, -firstTop, false);
    drawBand(uc, firstTop, true);
  });
  // cylinder shading (multiply), anime-style hard terminator in the lower third
  g.save(); g.globalCompositeOperation = 'multiply';
  const sh = g.createLinearGradient(0, -r, 0, r);
  sh.addColorStop(0, '#ffffff'); sh.addColorStop(0.22, '#e6e9fb'); sh.addColorStop(0.5, '#b0b4dc'); sh.addColorStop(0.54, '#666ba6');
  sh.addColorStop(0.85, '#373b76'); sh.addColorStop(1, '#1e214c');
  g.fillStyle = sh; g.fillRect(0, -r, L, 2 * r);
  g.restore();
  // moon rim along the top + thin dark silhouette lines (no constant energy band: the bounce is drawn live near the fuchi)
  g.fillStyle = 'rgba(225,230,255,0.55)'; g.fillRect(0, -r, L, 0.09);
  g.fillStyle = LINE; g.fillRect(0, -r, L, 0.04); g.fillRect(0, r - 0.05, L, 0.05);
  return { c, D, U0: 0, r, L };
}

// ---- saya (scabbard) side texture: black urushi with long, sharp lacquer reflections --------
function buildSaya(k) {
  const D = 90 * k, U0 = -30, U1 = 1.4, r = 1.75;
  const c = makeCanvas(Math.ceil((U1 - U0) * D), Math.ceil(2 * r * D)), g = c.getContext('2d');
  g.setTransform(D, 0, 0, D, -U0 * D, r * D);
  const lg = g.createLinearGradient(0, -r, 0, r);
  lg.addColorStop(0, '#2a2f58'); lg.addColorStop(0.08, '#121429'); lg.addColorStop(0.45, '#07080f'); lg.addColorStop(0.8, '#040509'); lg.addColorStop(1, '#0c0f22');
  g.fillStyle = lg; g.fillRect(U0, -r, U1 - U0, 2 * r);
  // one long crisp reflection streak, broken in a couple of places; ends are skewed parallelograms with
  // short alpha tapers (lacquer, not metal: a single mirror-like line of the sky)
  const streak = (v0, v1, col, a, breaks, gap = 0.55, skew = 0.25, prof = [0.55, 0.95, 1, 1, 0.8, 0.45]) => {
    const segs = []; let ua = U0 - 0.5;
    for (const bu of breaks) { segs.push([ua, bu - gap / 2]); ua = bu + gap / 2; }
    segs.push([ua, U1 + 0.5]);
    const ns = prof.length;
    for (const [s0, s1] of segs) for (let i = 0; i < ns; i++) {
      const va = lerp(v0, v1, i / ns), vb = lerp(v0, v1, (i + 1) / ns);
      const off = skew * (i / (ns - 1) - 0.5);
      const x0 = s0 + off, x1 = s1 + off;
      const tp = Math.min(0.45, 0.4 / Math.max(0.2, x1 - x0));
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(tp, rgba(col, a * prof[i])); gr.addColorStop(1 - tp, rgba(col, a * prof[i])); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(x0, va, x1 - x0, vb - va + 0.004);
    }
  };
  streak(-1.46, -1.17, [220, 226, 255], 0.95, [-8.4, -19.5]);
  // soft coloured environment reflections (blue energy below the midline, Akane's red near the bottom)
  const soft = (vc, hw, col, a) => {
    const gr = g.createLinearGradient(0, vc - hw, 0, vc + hw);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.5, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(U0, vc - hw, U1 - U0, 2 * hw);
  };
  soft(0.62, 0.28, [40, 110, 255], 0.3);
  soft(1.42, 0.2, [190, 10, 55], 0.38);
  // tiny dust/orange-peel speckle so the black reads as a material
  const rng = new RNG(13);
  for (let i = 0; i < 900; i++) {
    const x = U0 + rng.next() * (U1 - U0), y = (rng.next() * 2 - 1) * r * 0.95;
    g.fillStyle = `rgba(150,160,220,${0.03 + rng.next() * 0.05})`; g.fillRect(x, y, 0.02, 0.02);
  }
  // koiguchi fitting (buffalo horn) u in [-1.35, U1]
  g.save();
  g.beginPath(); g.rect(-1.35, -r, U1 + 1.35, 2 * r); g.clip();
  const hg = g.createLinearGradient(0, -r, 0, r);
  hg.addColorStop(0, '#34385e'); hg.addColorStop(0.1, '#17192e'); hg.addColorStop(0.5, '#0a0b17'); hg.addColorStop(1, '#12152b');
  g.fillStyle = hg; g.fillRect(-1.35, -r, U1 + 1.35, 2 * r);
  const kg = g.createLinearGradient(0, -1.5, 0, -1.33);
  kg.addColorStop(0, 'rgba(235,238,255,0)'); kg.addColorStop(0.35, 'rgba(235,238,255,0.95)'); kg.addColorStop(1, 'rgba(235,238,255,0.2)');
  g.fillStyle = kg; g.fillRect(-1.35, -1.5, U1 + 1.35, 0.17);
  soft(0.66, 0.16, [60, 130, 255], 0.4);
  g.restore();
  g.fillStyle = '#05060c'; g.fillRect(-1.42, -r, 0.07, 2 * r);
  g.fillStyle = 'rgba(205,212,245,0.6)'; g.fillRect(-1.49, -r, 0.03, 2 * r);
  // kurigata knob (sageo loop) further down the saya
  const kx = -10.8;
  const kq = g.createLinearGradient(kx, -0.9, kx, 0.4);
  kq.addColorStop(0, '#4a5080'); kq.addColorStop(0.3, '#191b33'); kq.addColorStop(1, '#06070e');
  g.fillStyle = kq; g.beginPath(); g.ellipse(kx, -0.25, 0.95, 0.62, 0, 0, TAU); g.fill();
  g.strokeStyle = LINE; g.lineWidth = 0.05; g.stroke();
  g.fillStyle = 'rgba(220,225,255,0.85)'; g.beginPath(); g.ellipse(kx - 0.15, -0.68, 0.55, 0.07, 0, 0, TAU); g.fill();
  // silhouette lines + a thin moon edge on the very top
  g.fillStyle = 'rgba(150,160,220,0.5)'; g.fillRect(U0, -r + 0.035, U1 - U0, 0.03);
  g.fillStyle = LINE; g.fillRect(U0, -r, U1 - U0, 0.035); g.fillRect(U0, r - 0.05, U1 - U0, 0.05);
  return { c, D, U0, r };
}

// ---- tsuba face: dark iron, silver engraved mimi, inazuma sukashi, silver-inlay lightning ----
// sukashi window (face-local cm, before the e-foreshortening): a narrow three-step lightning slit
const SLIT = [[0.08, -1.56], [0.22, -1.5], [-0.02, -0.56], [0.25, -0.5], [0.0, 0.42], [0.2, 0.47], [-0.13, 1.58],
  [-0.08, 0.34], [-0.3, 0.3], [-0.12, -0.62], [-0.36, -0.68], [-0.07, -1.5]];
const SLIT_X = 2.72;
function slitPath(ctx, sx, dx = 0, dy = 0, grow = 0) {
  const m = sx < 0 ? -1 : 1;
  ctx.beginPath();
  SLIT.forEach(([x, y], i) => { const px = sx + m * x * (1 + grow) + dx, py = y * (1 + grow * 0.5) + dy; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
}
function buildTsubaFace(k) {
  const D = 120 * k, Rt = 4.05;
  const size = Math.ceil(2 * Rt * D) + 6;
  const c = makeCanvas(size, size), g = c.getContext('2d');
  g.setTransform(D, 0, 0, D, size / 2, size / 2);
  // iron face
  const fg = g.createRadialGradient(-1.6, -1.9, 0.2, 0, 0, Rt);
  fg.addColorStop(0, '#41466c'); fg.addColorStop(0.45, '#1f2239'); fg.addColorStop(1, '#0c0e1f');
  g.fillStyle = fg; g.beginPath(); g.arc(0, 0, Rt, 0, TAU); g.fill();
  // brushed concentric texture
  const rng = new RNG(31);
  for (let i = 0; i < 260; i++) {
    const rr = 0.3 + rng.next() * 3.3, a0 = rng.next() * TAU, al = 0.4 + rng.next() * 2.4;
    g.strokeStyle = rng.next() < 0.5 ? `rgba(150,160,220,${0.04 + rng.next() * 0.08})` : `rgba(0,0,10,${0.1 + rng.next() * 0.15})`;
    g.lineWidth = 0.01 + rng.next() * 0.02;
    g.beginPath(); g.arc(0, 0, rr, a0, a0 + al); g.stroke();
  }
  // nanako (fish-roe) punched dots in an annulus
  for (let ring = 0; ring < 9; ring++) {
    const rr = 2.35 + ring * 0.105, n = Math.floor(TAU * rr / 0.1);
    for (let j = 0; j < n; j++) {
      const a = (j + (ring % 2) * 0.5) / n * TAU, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      g.fillStyle = 'rgba(0,0,8,0.55)'; g.beginPath(); g.arc(x + 0.01, y + 0.012, 0.03, 0, TAU); g.fill();
      g.fillStyle = 'rgba(170,180,235,0.35)'; g.beginPath(); g.arc(x - 0.008, y - 0.01, 0.017, 0, TAU); g.fill();
    }
  }
  // engraved ring + silver inlay line
  const groove = (rr, w = 0.03) => {
    g.strokeStyle = 'rgba(0,0,8,0.85)'; g.lineWidth = w * 1.6; g.beginPath(); g.arc(0.012, 0.015, rr, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(205,214,245,0.9)'; g.lineWidth = w; g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke();
  };
  groove(3.32, 0.028); groove(2.22, 0.022);
  // a single silver crescent-moon inlay sweeping round the upper left of the annulus (no zigzags: the
  // lightning motif lives in the sukashi windows)
  {
    const pts = []; for (let j = 0; j <= 40; j++) { const q = j / 40, a = -2.95 + 1.55 * q; pts.push([Math.cos(a) * 2.86, Math.sin(a) * 2.86]); }
    const rib = ribbonPts(pts, (q) => 0.012 + 0.07 * Math.pow(Math.sin(Math.PI * q), 1.4));
    g.fillStyle = 'rgba(0,0,8,0.85)'; g.fill(pathOf(rib.map(([x, y]) => [x + 0.018, y + 0.024])));
    g.fillStyle = '#c9d1f2'; g.fill(pathOf(rib));
    g.save(); g.clip(pathOf(rib)); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill(pathOf(rib.map(([x, y]) => [x - 0.012, y - 0.016]))); g.restore();
  }
  // sukashi windows: painted cavities (dark, seen into), bevelled inner wall, thin silver lip
  for (const sx of [-SLIT_X, SLIT_X]) {
    g.save();
    slitPath(g, sx); g.fillStyle = '#2a2d52'; g.fill();
    g.save(); slitPath(g, sx); g.clip();
    slitPath(g, sx, 0.12, 0.05); g.fillStyle = '#05061a'; g.fill();
    g.restore();
    slitPath(g, sx); g.strokeStyle = 'rgba(0,0,8,0.9)'; g.lineWidth = 0.05; g.lineJoin = 'miter'; g.stroke();
    slitPath(g, sx, -0.02, -0.025); g.strokeStyle = 'rgba(200,210,245,0.55)'; g.lineWidth = 0.018; g.stroke();
    g.restore();
  }
  // seppa-dai (smooth centre plate)
  const sd = g.createLinearGradient(0, -2.1, 0, 2.1);
  sd.addColorStop(0, '#4c5279'); sd.addColorStop(0.5, '#21243c'); sd.addColorStop(1, '#0f1123');
  g.fillStyle = sd; g.beginPath(); g.ellipse(0, 0, 1.4, 2.12, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,8,0.8)'; g.lineWidth = 0.035; g.stroke();
  // mimi (raised rim): silver, conic metallic, engraved rope pattern
  g.save();
  g.beginPath(); g.arc(0, 0, Rt, 0, TAU); g.arc(0, 0, 3.55, 0, TAU, true); g.clip();
  const cg = g.createConicGradient(-2.35, 0, 0);
  const st = [[0, '#f6f8ff'], [0.07, '#b9bfe0'], [0.16, '#5c6290'], [0.3, '#cfd4ef'], [0.42, '#3a3e66'], [0.55, '#8d93bf'],
    [0.66, '#2b2f52'], [0.78, '#6f76a6'], [0.9, '#c4cae8'], [1, '#f6f8ff']];
  st.forEach(([o, col]) => cg.addColorStop(o, col));
  g.fillStyle = cg; g.fillRect(-Rt, -Rt, 2 * Rt, 2 * Rt);
  for (let j = 0; j < 220; j++) {
    const a = j / 220 * TAU;
    const x0 = Math.cos(a) * 3.62, y0 = Math.sin(a) * 3.62, x1 = Math.cos(a + 0.035) * 3.84, y1 = Math.sin(a + 0.035) * 3.84;
    g.strokeStyle = 'rgba(10,12,30,0.55)'; g.lineWidth = 0.022; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(x0 - 0.02, y0); g.lineTo(x1 - 0.02, y1); g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(0,0,8,0.9)'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, 3.55, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(220,228,255,0.7)'; g.lineWidth = 0.022; g.beginPath(); g.arc(0, 0, 3.92, 0, TAU); g.stroke();
  g.strokeStyle = LINE; g.lineWidth = 0.06; g.beginPath(); g.arc(0, 0, Rt - 0.03, 0, TAU); g.stroke();
  // face lighting: moon sheen upper-left
  g.save(); g.beginPath(); g.arc(0, 0, 3.55, 0, TAU); g.clip();
  g.globalCompositeOperation = 'lighter';
  const sh = g.createRadialGradient(-2.2, -2.4, 0, -2.2, -2.4, 3.2);
  sh.addColorStop(0, 'rgba(120,128,200,0.3)'); sh.addColorStop(1, 'rgba(120,128,200,0)');
  g.fillStyle = sh; g.fillRect(-Rt, -Rt, 2 * Rt, 2 * Rt);
  g.restore();
  return { c, D, Rt, size };
}

// ---- backgrounds: pre-blurred paintings ------------------------------------------------------
function paintBlurred(k, painter, blurPx, bx = -160, by = -120, bw = 2240, bh = 1320, res = 0.5) {
  const w = Math.ceil(bw * k * res), h = Math.ceil(bh * k * res);
  const a = makeCanvas(w, h), ga = a.getContext('2d');
  ga.setTransform(k * res, 0, 0, k * res, -bx * k * res, -by * k * res);
  painter(ga);
  const b = makeCanvas(w, h), gb = b.getContext('2d');
  gb.filter = `blur(${Math.max(1, blurPx * k * res)}px)`;
  gb.drawImage(a, 0, 0);
  gb.filter = 'none';
  return { c: b, x: bx, y: by, w: bw, h: bh };
}
function drawBG(ctx, bg) { ctx.drawImage(bg.c, bg.x, bg.y, bg.w, bg.h); }
function blobber(g) {
  return (x, y, rx, ry, col, a, rot = 0) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
  };
}

function buildHiltBG(k) {
  return paintBlurred(k, (g) => {
    g.fillStyle = '#04051a'; g.fillRect(-200, -200, 2400, 1500);
    const blob = blobber(g);
    // night sky upper right (nebula hints, Akane's red far right)
    blob(1500, 90, 780, 400, [44, 36, 140], 0.55, -0.3);
    blob(1880, 420, 520, 360, [22, 64, 190], 0.4);
    blob(1960, 60, 380, 260, [170, 24, 90], 0.3);
    blob(1120, -60, 520, 240, [80, 84, 190], 0.22);
    // Kai's white coat, deep in moon shadow, sweeping behind the koiguchi/tsuba: mostly dark, a few moonlit
    // fold ridges (they read as depth once defocused)
    g.save(); g.translate(900, 860); g.rotate(-0.3);
    const cg = g.createLinearGradient(0, -420, 0, 420);
    cg.addColorStop(0, '#2c3068'); cg.addColorStop(0.35, '#1c1f4c'); cg.addColorStop(0.7, '#10122e'); cg.addColorStop(1, '#06071a');
    g.save(); g.beginPath(); g.ellipse(0, 0, 1100, 400, 0, 0, TAU); g.clip();
    g.fillStyle = cg; g.fillRect(-1200, -500, 2400, 1000);
    for (let i = 0; i < 9; i++) {
      const x = -950 + i * 240 + Math.sin(i * 3.1) * 70;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(4,5,20,0.75)'; g.lineWidth = 110;
      g.beginPath(); g.moveTo(x + 60, -440); g.bezierCurveTo(x + 180, -120, x, 160, x + 150, 440); g.stroke();
      g.strokeStyle = `rgba(${130 + i * 6},${136 + i * 4},220,${0.28 + 0.2 * hash1(i)})`; g.lineWidth = 22 + 18 * hash1(i * 3);
      g.beginPath(); g.moveTo(x - 30, -440); g.bezierCurveTo(x + 90, -130, x - 90, 150, x + 60, 440); g.stroke();
    }
    g.restore();
    g.restore();
    // dark trousers / shadow lower right, rimmed by Akane's red
    g.fillStyle = '#05061a';
    g.beginPath(); g.moveTo(1150, 1300); g.lineTo(2100, 560); g.lineTo(2100, 1300); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(200,20,70,0.4)'; g.lineWidth = 20; g.beginPath(); g.moveTo(1150, 1300); g.lineTo(2100, 560); g.stroke();
    // electric bounce light around the koiguchi zone
    blob(560, 640, 520, 420, [30, 100, 255], 0.3);
  }, 34);
}
function buildSheathBG(k) {
  return paintBlurred(k, (g) => {
    const lg = g.createLinearGradient(0, -120, 0, 1200);
    lg.addColorStop(0, '#0b1034'); lg.addColorStop(0.5, '#080b22'); lg.addColorStop(1, '#04050e');
    g.fillStyle = lg; g.fillRect(-200, -200, 2400, 1500);
    const blob = blobber(g);
    blob(1500, 200, 700, 300, [80, 54, 190], 0.45, -0.15);
    blob(300, 150, 600, 300, [36, 74, 200], 0.4, 0.2);
    blob(1700, 900, 600, 380, [170, 10, 50], 0.35);
    blob(960, 1100, 900, 300, [20, 30, 90], 0.6);
    // white scar of the sky cut far behind (soft)
    g.save(); g.translate(960, 380); g.rotate(-0.12);
    const sg = g.createLinearGradient(0, -120, 0, 120);
    sg.addColorStop(0, 'rgba(120,180,255,0)'); sg.addColorStop(0.5, 'rgba(225,240,255,0.5)'); sg.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = sg; g.fillRect(-1400, -120, 2800, 240); g.restore();
  }, 30);
}

// ---------------------------------------------------------------------------------------------
// out-of-focus pass: draw into offscreen copies of the layers (same transform), then composite blurred.
// punch: the blurred silhouette also knocks out the emission behind it (foreground occluder).
function dofPass(A, sc, em, blurPx, fn, punch = false) {
  const W = sc.canvas.width, H = sc.canvas.height, k = W / RW;
  const offS = need(A, 'dofS', () => makeCanvas(W, H)), offE = need(A, 'dofE', () => makeCanvas(W, H));
  const gs = offS.getContext('2d'), ge = offE.getContext('2d');
  for (const g of [gs, ge]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none'; g.clearRect(0, 0, W, H); }
  gs.setTransform(sc.getTransform()); ge.setTransform(em.getTransform());
  fn(gs, ge);
  const f = `blur(${Math.max(0.5, blurPx * k)}px)`;
  sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalCompositeOperation = 'source-over'; sc.filter = f; sc.drawImage(offS, 0, 0); sc.restore();
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0);
  if (punch) { em.globalCompositeOperation = 'destination-out'; em.filter = f; em.drawImage(offS, 0, 0); }
  em.globalCompositeOperation = 'lighter'; em.filter = f; em.drawImage(offE, 0, 0); em.restore();
}

// tsuka with a macro-lens depth-of-field falloff: sharp near the fuchi, soft and darker toward the kashira
function drawTsuka(sc, em, A, R, uA, uEnd, electric, o = {}) {
  const TS = need(A, 'tsuka', buildTsuka);
  const W = sc.canvas.width, H = sc.canvas.height, kk = W / RW;
  const offA = need(A, 'tsuA', () => makeCanvas(W, H)), offB = need(A, 'tsuB', () => makeCanvas(W, H));
  const ga = offA.getContext('2d'), gb = offB.getContext('2d');
  for (const g of [ga, gb]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none'; g.clearRect(0, 0, W, H); }
  ga.setTransform(sc.getTransform());
  const r = TS.r;
  const tpath = R.path([[uA, -r], [uEnd, -r], [uEnd, r], [uA, r]]);
  ga.save(); ga.clip(tpath);
  drawCyl(ga, R, TS, uA, uEnd, uA);
  // fall into the night along the axis (x1.0 at the fuchi -> x0.5 at u=20)
  ga.globalCompositeOperation = 'source-atop';
  const p0 = R.P(uA, 0), p1 = R.P(uA + (o.darkLen ?? 15), 0);
  const dg = ga.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
  dg.addColorStop(0, 'rgba(6,8,28,0.05)'); dg.addColorStop(0.2, 'rgba(6,8,28,0.3)'); dg.addColorStop(1, 'rgba(6,8,28,0.7)');
  ga.fillStyle = dg; ga.fill(tpath);
  // electric bounce: only within ~4 cm of the fuchi, on the lower half facing the gap light
  if (electric > 0) {
    ga.globalCompositeOperation = 'lighter';
    const q1 = R.P(uA + 4, 0);
    const eg = ga.createLinearGradient(p0[0], p0[1], q1[0], q1[1]);
    eg.addColorStop(0, C(KAI.mid, 0.38 * electric)); eg.addColorStop(0.5, C(KAI.deep, 0.12 * electric)); eg.addColorStop(1, C(KAI.deep, 0));
    ga.fillStyle = eg; ga.fill(R.path([[uA, -0.2], [uA + 4.2, -0.2], [uA + 4.2, r], [uA, r]]));
  }
  ga.restore();
  // crisp moon rim on top, fading slower than the body
  {
    const pts = []; for (let j = 0; j <= 24; j++) pts.push(R.P(lerp(uA, uA + 14, j / 24), -r + 0.06));
    ga.save(); ga.lineCap = 'round';
    const a = R.P(uA, -r), b = R.P(uA + 14, -r);
    const rg = ga.createLinearGradient(a[0], a[1], b[0], b[1]);
    rg.addColorStop(0, 'rgba(236,240,255,0.95)'); rg.addColorStop(0.5, 'rgba(200,210,250,0.6)'); rg.addColorStop(1, 'rgba(200,210,250,0)');
    ga.strokeStyle = rg; ga.lineWidth = 2.4; strokePts(ga, pts);
    ga.restore();
  }
  // composite: everything at the far blur, then the in-focus near part fading out along the axis
  const far = o.blur ?? 8, near = o.sharpLen ?? 3.2, fade = o.fadeLen ?? 3.5;
  sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.filter = `blur(${far * kk}px)`; sc.drawImage(offA, 0, 0); sc.restore();
  gb.drawImage(offA, 0, 0);
  gb.setTransform(sc.getTransform()); gb.globalCompositeOperation = 'destination-in';
  const m0 = R.P(uA + near, 0), m1 = R.P(uA + near + fade, 0);
  const mg = gb.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
  mg.addColorStop(0, 'rgba(0,0,0,1)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
  gb.fillStyle = mg; gb.fillRect(-500, -500, RW + 1000, RH + 1000);
  sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.drawImage(offB, 0, 0); sc.restore();
}

// flat blue silk braid hanging from the kurigata
function drawSageo(sc, em, R, st) {
  const sway = Math.sin(st.t * 1.3) * 0.2;
  const cpts = st.sageoPts || [[-10, 2.4], [-4, 3.1 + sway * 0.3], [0.5, 3.5 + sway * 0.5], [5, 3.85 + sway * 0.6], [10, 4.8 + sway * 0.4], [16, 6.6]];
  const line = crSample(cpts, 10).map(([u, v]) => R.P(u, v));
  const ww = R.s(-6) * 0.95;
  const rp = ribbonPts(line, () => ww);
  const pa = pathOf(rp);
  sc.fillStyle = '#0f2264'; sc.fill(pa);
  sc.save(); sc.clip(pa);
  // twill ticks + a moon sheen along the upper edge, shade along the lower edge
  sc.strokeStyle = 'rgba(90,140,240,0.3)'; sc.lineWidth = 2;
  for (let i = 1; i < line.length - 1; i++) {
    const [x, y] = line[i], [x2, y2] = line[i + 1];
    const dx = x2 - x, dy = y2 - y, l = Math.hypot(dx, dy) || 1;
    sc.beginPath(); sc.moveTo(x - dy / l * ww * 0.5, y + dx / l * ww * 0.5); sc.lineTo(x + dx * 0.6 + dy / l * ww * 0.5, y + dy * 0.6 - dx / l * ww * 0.5); sc.stroke();
  }
  sc.fillStyle = 'rgba(8,14,56,0.6)'; sc.fill(pathOf(ribbonPts(line.map(([x, y]) => [x + ww * 0.18, y + ww * 0.22]), () => ww * 0.55)));
  sc.fillStyle = 'rgba(150,180,255,0.35)'; sc.fill(pathOf(ribbonPts(line.map(([x, y]) => [x - ww * 0.12, y - ww * 0.36]), () => ww * 0.1)));
  sc.restore();
  sc.strokeStyle = LINE; sc.lineWidth = 3; sc.stroke(pa);
}

// the koshirae + hand, drawn for the hilt and sheath shots
// st: { b (cm the sword is out), t, sparks, gleam, bladeGlow, hand, thumbPush, thumbMax, handBlur, deferFront, sageo }
function drawKatana(sc, em, A, R, st) {
  const SY = need(A, 'saya', buildSaya), TF = need(A, 'tsuba', buildTsubaFace);
  const b = st.b, hab = 0.95, uB = b - hab;          // habaki spans [uB, b]; exposed blade [0, uB]
  const seppaW = 0.16, tsT = 0.55;
  const uT0 = b + seppaW, uT1 = uT0 + tsT;            // tsuba faces
  const uF0 = uT1 + seppaW, uF1 = uF0 + 1.25;        // fuchi
  const glowK = st.glowK ?? 1;
  const electric = st.sparks * glowK;
  const t = st.t;

  // ---- sageo cord: furthest element, runs from the kurigata behind the fist toward the obi (out of focus) ----
  if (st.sageo) dofPass(A, sc, em, st.sageoBlur ?? 5, (c, e) => drawSageo(c, e, R, st));
  // ---- tsuka (far): depth-of-field falloff + darkening along the axis ----
  drawTsuka(sc, em, A, R, uF1 - 0.1, 34, electric, st.tsuka || {});
  // ---- fuchi (collar) ----
  {
    const pa = discHull(R, uF0, uF1, 1.66, 1.3);
    const p0 = R.P(uF0, -1.66), p1 = R.P(uF0, 1.66);
    const gr = sc.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
    gr.addColorStop(0, '#9aa2d4'); gr.addColorStop(0.12, '#3a3f68'); gr.addColorStop(0.55, '#181a30'); gr.addColorStop(1, '#0b0c1a');
    sc.fillStyle = gr; sc.fill(pa);
    sc.strokeStyle = LINE; sc.lineWidth = 2.6; sc.stroke(pa);
    const band = discHull(R, uF1 - 0.28, uF1 - 0.12, 1.68, 1.32);
    sc.fillStyle = 'rgba(200,208,240,0.85)'; sc.fill(band);
    if (electric > 0) { sc.save(); sc.clip(pa); sc.globalCompositeOperation = 'lighter'; sc.fillStyle = C(KAI.mid, 0.18 * electric); sc.fill(R.path([[uF0 - 1, 0.4], [uF1 + 1, 0.4], [uF1 + 1, 2], [uF0 - 1, 2]])); sc.restore(); }
  }
  // ---- seppa (hilt side): smaller than the window ring so it can never show through ----
  {
    const pa = discHull(R, uT1, uF0, 1.7, 1.2);
    sc.fillStyle = '#7d6c44'; sc.fill(pa); sc.strokeStyle = LINE; sc.lineWidth = 2; sc.stroke(pa);
  }
  // ---- tsuba: rim band (thickness) + face ----
  const Rt = TF.Rt;
  const tsFace = faceEllipse(R, uT0, Rt);
  {
    const hull = discHull(R, uT0, uT1, Rt);
    const band = new Path2D(); band.addPath(hull); band.addPath(tsFace);
    const pT = R.P(uT1, -Rt), pB = R.P(uT1, Rt);
    const gr = sc.createLinearGradient(pT[0], pT[1], pB[0], pB[1]);
    gr.addColorStop(0, '#eef1ff'); gr.addColorStop(0.18, '#9ba1c9'); gr.addColorStop(0.5, '#4a4f7a'); gr.addColorStop(0.8, '#23264a'); gr.addColorStop(1, '#5a5f8c');
    sc.fillStyle = gr; sc.fill(band, 'evenodd');
    sc.save(); sc.clip(band, 'evenodd');
    const mid = faceEllipse(R, (uT0 + uT1) / 2, Rt);
    sc.strokeStyle = 'rgba(10,12,30,0.6)'; sc.lineWidth = 1.6; sc.stroke(mid);
    sc.restore();
    sc.strokeStyle = LINE; sc.lineWidth = 3.2; sc.stroke(hull);
    sc.save(); R.atFace(sc, uT0);
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(TF.c, -TF.size / 2 / TF.D, -TF.size / 2 / TF.D, TF.size / TF.D, TF.size / TF.D);
    sc.restore();
    // electric light on the tsuba face from the gap + the sukashi windows lit from inside
    if (electric > 0) {
      sc.save(); sc.clip(tsFace);
      R.atFace(sc, uT0);
      sc.globalCompositeOperation = 'lighter';
      const lg = sc.createRadialGradient(0, 0, 0.5, 0, 0, 3.8);
      lg.addColorStop(0, C(KAI.mid, 0.36 * electric)); lg.addColorStop(0.55, C(KAI.deep, 0.14 * electric)); lg.addColorStop(1, C(KAI.deep, 0));
      sc.fillStyle = lg; sc.fillRect(-4.2, -4.2, 8.4, 8.4);
      sc.globalCompositeOperation = 'source-over';
      const fl = 0.8 + 0.2 * Math.sin(t * 40);
      for (const sx of [-SLIT_X, SLIT_X]) {
        slitPath(sc, sx); sc.fillStyle = C(KAI.mid, 0.85 * electric * fl); sc.fill();
        sc.save(); slitPath(sc, sx); sc.clip();
        slitPath(sc, sx); sc.strokeStyle = C(KAI.hot, Math.min(1, 1.2 * electric)); sc.lineWidth = 0.16; sc.lineJoin = 'miter'; sc.stroke();
        sc.restore();
      }
      sc.restore();
      em.save(); R.atFace(em, uT0); em.globalCompositeOperation = 'lighter';
      for (const sx of [-SLIT_X, SLIT_X]) {
        slitPath(em, sx); em.fillStyle = C(KAI.mid, 0.6 * electric * fl); em.fill();
        em.save(); slitPath(em, sx); em.clip();
        slitPath(em, sx); em.strokeStyle = C(KAI.hot, 0.8 * electric); em.lineWidth = 0.12; em.stroke();
        em.restore();
      }
      em.restore();
    }
    // moon glint on the rim top-left
    em.save(); em.globalCompositeOperation = 'lighter';
    const rimEl = new Path2D(); { const p = R.P(uT0, 0), s = R.s(uT0); rimEl.ellipse(p[0], p[1], Rt * R.e * s, Rt * s, R.ang, Math.PI * 1.05, Math.PI * 1.42); }
    em.strokeStyle = C('#c8cdf5', 0.45); em.lineWidth = 3; em.lineCap = 'round'; em.stroke(rimEl);
    em.restore();
  }
  // ---- seppa (saya side) visible face ----
  {
    const hull = discHull(R, b, uT0, 1.84, 1.22);
    const face = faceEllipse(R, b, 1.84, 1.22);
    const pT = R.P(b, -1.84), pB = R.P(b, 1.84);
    const gr = sc.createLinearGradient(pT[0], pT[1], pB[0], pB[1]);
    gr.addColorStop(0, '#f4e8c4'); gr.addColorStop(0.16, '#b9a273'); gr.addColorStop(0.5, '#6a5a3c'); gr.addColorStop(1, '#241d14');
    sc.fillStyle = gr; sc.fill(hull); sc.fill(face);
    sc.strokeStyle = LINE; sc.lineWidth = 2.4; sc.stroke(hull);
    sc.strokeStyle = 'rgba(30,24,16,0.8)'; sc.lineWidth = 1.2; sc.stroke(face);
    if (electric > 0) { sc.save(); sc.globalCompositeOperation = 'lighter'; sc.fillStyle = C(KAI.mid, 0.3 * electric); sc.fill(face); sc.restore(); }
  }
  // ---- habaki ----
  if (b > 0.02) {
    const v0 = -1.5, v1 = 1.45;
    const u0 = Math.max(uB, -0.6);
    // trapezoid collar: flares toward the tsuba, tapers onto the blade
    const body = R.path([[u0, v0 + 0.14], [b, v0 - 0.08], [b, v1 + 0.06], [u0, v1 - 0.14]]);
    sc.save(); sc.clip(body); R.atAxis(sc, u0);
    const W2 = b - u0 + 1;
    const gr = sc.createLinearGradient(0, v0, 0, v1);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.07, '#e6ecff'); gr.addColorStop(0.16, '#8f9acb'); gr.addColorStop(0.36, '#3b4374');
    gr.addColorStop(0.5, '#1d2148'); gr.addColorStop(0.6, '#7f89bd'); gr.addColorStop(0.67, '#4d5688'); gr.addColorStop(0.86, '#1e2448'); gr.addColorStop(1, '#5a64a0');
    sc.fillStyle = gr; sc.fillRect(-0.5, v0 - 0.1, W2, v1 - v0 + 0.2);
    // neko-gaki file marks (fine diagonal hatching)
    sc.strokeStyle = 'rgba(10,12,40,0.28)'; sc.lineWidth = 0.02;
    for (let x = -1.5; x < W2 + 1.5; x += 0.075) { sc.beginPath(); sc.moveTo(x, v0); sc.lineTo(x - 0.7, v1); sc.stroke(); }
    sc.fillStyle = 'rgba(8,10,30,0.7)'; sc.fillRect(-0.02, v0, 0.07, v1 - v0);
    sc.fillStyle = 'rgba(230,236,255,0.75)'; sc.fillRect(0.05, v0, 0.04, v1 - v0);
    sc.restore();
    sc.strokeStyle = LINE; sc.lineWidth = 2.6; sc.stroke(body);
    if (electric > 0) {
      sc.save(); sc.clip(body); sc.globalCompositeOperation = 'lighter';
      const pa = R.P(uB, 0), pb2 = R.P(b, 0);
      const lg = sc.createLinearGradient(pa[0], pa[1], pb2[0], pb2[1]);
      lg.addColorStop(0, C(KAI.hot, 0.28 * electric)); lg.addColorStop(1, C(KAI.mid, 0.04 * electric));
      sc.fillStyle = lg; sc.fill(body); sc.restore();
    }
  }
  // ---- blade (exposed part): two flat planes of mirror steel, misty hamon ----
  const bladeShape = (uEnd) => R.path([[-0.5, -1.33], [uEnd, -1.33], [uEnd, 1.22], [-0.5, 1.22]]);
  const hamon = (u) => -0.7 + 0.13 * Math.sin(u * 4.3 + 0.4) + 0.06 * Math.sin(u * 11.3 + 1.1) + 0.025 * Math.sin(u * 29);
  if (uB > 0.01) {
    const shape = bladeShape(uB);
    sc.save(); sc.clip(shape);
    R.atAxis(sc, 0);
    const L = uB + 0.6;
    // hira-ji (edge side of the shinogi): mirror steel reflecting the night — paler toward the edge, dark
    // toward the ridge — crossed by two crisp diagonal sky reflections that stay put while the blade slides
    const jg = sc.createLinearGradient(0, -1.33, 0, 0.46);
    jg.addColorStop(0, '#7f8dc4'); jg.addColorStop(0.3, '#46528c'); jg.addColorStop(0.72, '#20275a'); jg.addColorStop(1, '#161b46');
    sc.fillStyle = jg; sc.fillRect(-0.6, -1.4, L + 0.4, 1.88);
    const refl = (u0, w, a) => { sc.beginPath(); sc.moveTo(u0, -1.4); sc.lineTo(u0 + w, -1.4); sc.lineTo(u0 + w - 0.75, 0.46); sc.lineTo(u0 - 0.75, 0.46); sc.closePath(); sc.fillStyle = `rgba(196,210,255,${a})`; sc.fill(); };
    refl(0.62, 0.34, 0.3); refl(1.08, 0.08, 0.55); refl(1.72, 0.22, 0.25);
    // shinogi-ji: flat and darker, hard break at the ridge
    const sj = sc.createLinearGradient(0, 0.48, 0, 1.22);
    sj.addColorStop(0, '#0a0d2a'); sj.addColorStop(1, '#1c2250');
    sc.fillStyle = sj; sc.fillRect(-0.6, 0.48, L + 0.4, 0.8);
    // hamon: light frosting, crisp 2px nioi line and nie sparkle carry it
    // misty boundary: stacked low-alpha fills fake the soft nioi haze
    const hzone = (off) => { sc.beginPath(); sc.moveTo(-0.6, -1.4); for (let u = -0.6; u <= L + 0.04; u += 0.04) sc.lineTo(u, hamon(u) + off); sc.lineTo(L, -1.4); sc.closePath(); };
    for (const [off, a] of [[0.16, 0.05], [0.1, 0.06], [0.05, 0.08], [0, 0.16]]) { hzone(off); sc.fillStyle = `rgba(214,226,255,${a})`; sc.fill(); }
    sc.beginPath(); for (let u = -0.6; u <= L + 0.04; u += 0.04) { const y = hamon(u); u === -0.6 ? sc.moveTo(u, y) : sc.lineTo(u, y); }
    sc.strokeStyle = 'rgba(210,222,255,0.16)'; sc.lineWidth = 0.08; sc.stroke();
    for (let j = 0; j < 26; j++) {
      const u = hash1(j * 3.3 + 1) * L - 0.3, v = hamon(u) - 0.01 - Math.pow(hash1(j * 7.7), 2) * 0.16;
      sc.fillStyle = `rgba(255,255,255,${0.3 + 0.4 * hash1(j)})`; sc.fillRect(u, v, 0.018, 0.018);
    }
    sc.strokeStyle = 'rgba(150,165,215,0.3)'; sc.lineWidth = 0.022;
    for (let u = -0.4; u < L; u += 0.37) { sc.beginPath(); sc.moveTo(u, hamon(u)); sc.lineTo(u - 0.08, -1.18); sc.stroke(); }
    // shinogi ridge (crisp light line over a dark line), edge line
    sc.fillStyle = 'rgba(244,248,255,0.95)'; sc.fillRect(-0.6, 0.445, L + 0.4, 0.035);
    sc.fillStyle = 'rgba(4,6,20,0.9)'; sc.fillRect(-0.6, 0.48, L + 0.4, 0.04);
    sc.fillStyle = 'rgba(255,255,255,1)'; sc.fillRect(-0.6, -1.33, L + 0.4, 0.04);
    sc.fillStyle = 'rgba(120,130,190,0.8)'; sc.fillRect(-0.6, -1.29, L + 0.4, 0.025);
    if (electric > 0 || st.bladeGlow > 0) {
      const bk = Math.max(electric, st.bladeGlow || 0);
      sc.globalCompositeOperation = 'lighter';
      const eg = sc.createLinearGradient(0, 0, Math.max(0.8, uB), 0);
      eg.addColorStop(0, C(KAI.hot, 0.2 * bk)); eg.addColorStop(0.35, C(KAI.mid, 0.07 * bk)); eg.addColorStop(1, C(KAI.mid, 0));
      sc.fillStyle = eg; sc.fillRect(-0.6, -1.4, L + 0.4, 2.7);
    }
    sc.restore();
    sc.strokeStyle = LINE; sc.lineWidth = 2.4;
    { const a = R.P(0, -1.33), b2 = R.P(uB, -1.33), c2 = R.P(uB, 1.22), d2 = R.P(0, 1.22);
      sc.beginPath(); sc.moveTo(a[0], a[1]); sc.lineTo(b2[0], b2[1]); sc.moveTo(c2[0], c2[1]); sc.lineTo(d2[0], d2[1]); sc.stroke(); }
    // emit: edge line + nie sparkle + blade glow near the mouth
    em.save(); em.globalCompositeOperation = 'lighter';
    em.save(); em.clip(shape); R.atAxis(em, 0);
    const bk = Math.max(electric, st.bladeGlow || 0);
    em.fillStyle = C(KAI.hot, 0.18 + 0.3 * bk); em.fillRect(-0.6, -1.35, L + 0.4, 0.05);
    const eg = em.createLinearGradient(0, 0, Math.max(0.8, uB), 0);
    eg.addColorStop(0, C(KAI.mid, 0.14 * bk)); eg.addColorStop(0.4, C(KAI.deep, 0.03 * bk)); eg.addColorStop(1, C(KAI.deep, 0));
    em.fillStyle = eg; em.fillRect(-0.6, -1.4, L + 0.4, 2.7);
    for (let j = 0; j < 22; j++) {
      const u = hash1(j * 3.3) * L, v = hamon(u) - 0.02 - hash1(j * 7.1) * 0.12;
      const tw = 0.5 + 0.5 * Math.sin(t * (9 + j) + j * 2);
      em.fillStyle = C(KAI.core, 0.45 * tw); em.fillRect(u, v, 0.022, 0.022);
    }
    em.restore(); em.restore();
  }
  // ---- gleam: specular sweep over blade + habaki, one crisp star glint near the habaki/ha corner ----
  if (st.gleam > 0 && st.gleam < 1 && b > 0.05) {
    const gk = Math.sin(Math.PI * st.gleam);
    const ug = lerp(b + 1.2, Math.max(0, uB) * 0.3 + 0.2, st.gleam);
    const shape = new Path2D();
    shape.addPath(bladeShape(Math.max(0, uB)));
    shape.addPath(R.path([[uB, -1.5], [b, -1.5], [b, 1.45], [uB, 1.45]]));
    for (const ctx of [sc, em]) {
      ctx.save(); ctx.clip(shape); R.atAxis(ctx, 0); ctx.globalCompositeOperation = 'lighter';
      const band = (w, a, col) => {
        ctx.beginPath(); ctx.moveTo(ug - w - 0.77, -1.4); ctx.lineTo(ug + w - 0.77, -1.4); ctx.lineTo(ug + w + 0.77, 1.4); ctx.lineTo(ug - w + 0.77, 1.4); ctx.closePath();
        ctx.fillStyle = C(col, a); ctx.fill();
      };
      const ks = ctx === em ? 0.6 : 1;
      band(0.3, 0.1 * gk * ks, KAI.hot); band(0.09, 0.4 * gk * ks, '#ffffff'); band(0.024, 0.95 * gk * ks, '#ffffff');
      ctx.restore();
    }
    // the glint rides the top edge: habaki corner at the peak (gleam 0.5), then down the blade toward the mouth
    const us = clamp(lerp(b + 0.2, 2 * uB - b - 0.2, st.gleam), 0.05, b + 0.3);
    const ge = R.P(us, us > uB ? -1.56 : -1.36);
    // the 'kiran': long thin rays along the edge direction + a small hot core
    drawStar(em, A, ge[0], ge[1], 760 * (0.5 + 0.5 * gk), Math.min(1, 1.2 * Math.pow(gk, 1.5)), R.ang, need(A, 'starMid', (k) => buildStar(k, 0.75)));
    drawStar(em, A, ge[0], ge[1], 300 * (0.6 + 0.4 * gk), 0.8 * gk * gk, R.ang + Math.PI / 4, need(A, 'starThin', (k) => buildStar(k, 0.5)));
  }

  // ---- hand parts behind the saya ----
  if (st.hand !== false) { if (st.handBlur) dofPass(A, sc, em, st.handBlur, (c, e) => drawHandBack(c, e, R, st, b)); else drawHandBack(sc, em, R, st, b); }
  // ---- saya (near) ----
  {
    const r = SY.r, uL = -32;
    const p = R.P(0, 0), s = R.s(0);
    const pa = new Path2D();
    const a = R.P(uL, -r), d = R.P(uL, r);
    pa.moveTo(a[0], a[1]);
    const t0 = R.P(0, -r); pa.lineTo(t0[0], t0[1]);
    pa.ellipse(p[0], p[1], r * R.e * s, r * s, R.ang, -Math.PI / 2, Math.PI / 2);
    pa.lineTo(d[0], d[1]); pa.closePath();
    sc.save(); sc.clip(pa);
    drawCyl(sc, R, SY, uL, r * R.e + 0.2, 0);
    if (electric > 0) {
      sc.globalCompositeOperation = 'lighter';
      const q0 = R.P(-4.5, 0), q1 = R.P(0.5, 0);
      const lg = sc.createLinearGradient(q0[0], q0[1], q1[0], q1[1]);
      lg.addColorStop(0, C(KAI.mid, 0)); lg.addColorStop(0.8, C(KAI.mid, 0.22 * electric)); lg.addColorStop(1, C(KAI.hot, 0.5 * electric));
      sc.fillStyle = lg; sc.fill(pa);
    }
    sc.restore();
    sc.strokeStyle = LINE; sc.lineWidth = 3.2; sc.stroke(pa);
    const lip = new Path2D(); lip.ellipse(p[0], p[1], r * R.e * s, r * s, R.ang, -Math.PI / 2, Math.PI / 2);
    sc.strokeStyle = 'rgba(190,200,245,0.6)'; sc.lineWidth = 1.5; sc.stroke(lip);
    if (electric > 0) {
      em.save(); em.globalCompositeOperation = 'lighter';
      const fl = 0.75 + 0.25 * Math.sin(t * 53) * Math.sin(t * 31 + 1);
      em.strokeStyle = C(KAI.hot, 0.7 * electric * fl); em.lineWidth = 5; em.stroke(lip);
      em.strokeStyle = C(KAI.core, 0.9 * electric * fl); em.lineWidth = 1.8; em.stroke(lip);
      const q = R.P(Math.max(0.15, uB * 0.25), 0);
      em.save(); em.translate(q[0], q[1]); em.rotate(R.ang); em.scale(0.55, 1);
      const gg = em.createRadialGradient(0, 0, 0, 0, 0, 2.6 * s);
      gg.addColorStop(0, C(KAI.hot, 0.22 * electric)); gg.addColorStop(0.35, C(KAI.mid, 0.1 * electric)); gg.addColorStop(1, C(KAI.deep, 0));
      em.fillStyle = gg; em.fillRect(-3 * s, -3 * s, 6 * s, 6 * s);
      em.restore();
      em.restore();
    }
  }

  // ---- hand in front (fingers + thumb); the sheath shot defers it until after its click fx ----
  if (st.hand !== false && !st.deferFront) drawHandFrontPass(A, sc, em, R, st, b);

  // ---- electric arcs leaking from the gap + sparks ----
  if (electric > 0.01) drawGapArcs(sc, em, R, st, b, uB, electric);
}

function drawHandFrontPass(A, sc, em, R, st, b) {
  if (st.handBlur) dofPass(A, sc, em, st.handBlur, (c, e) => drawHandFront(c, e, R, st, b), true);
  else drawHandFront(sc, em, R, st, b);
}

// bold, tapered, angular arcs: few, held on 12 fps steps, one-frame flash when a new shape spawns
function drawGapArcs(sc, em, R, st, b, uB, electric) {
  const t = st.t;
  const t12 = t * 12, tb = Math.floor(t12), fresh = (t12 - tb) < 0.2;
  const fl = fresh ? 1.6 : 1;
  const nArc = Math.round(1 + 2 * electric);
  for (let i = 0; i < nArc; i++) {
    const h = (j) => hash3(i * 13.1 + 1.7, tb * 0.37, j);
    if (i > 0 && h(9) > 0.4 + 0.6 * electric) continue;
    const v0 = lerp(-1.5, 1.5, h(1));
    let end;
    const kind = h(2);
    // weak charge = short arcs that stay in the gap; long escaping arcs only once the charge is up
    const reach = smoothstep(0.1, 0.5, electric);
    if (kind < 0.35 && uB > 0.35) end = [lerp(0.3, uB, h(3)), lerp(-1.3, 1.2, h(4))];
    else if (kind < 0.6 && b > 0.25) end = [b + 0.1, (h(4) < 0.5 ? -1 : 1) * lerp(1.6, lerp(1.9, 3.4, reach), h(5))];
    else end = [lerp(0.2, b + 0.8, h(3)), (h(4) < 0.5 ? -1 : 1) * lerp(1.9, lerp(2.4, 3.9, reach), h(5))];
    const a = R.P(0.06, v0), c2 = R.P(end[0], end[1]);
    const pts = boltPts(a, c2, 1000 + i * 7 + tb * 131, 0.2, 4);
    const amp = (0.7 + 0.3 * h(7)) * Math.min(1, electric * 1.5) * smoothstep(0.06, 0.25, electric) * fl;
    zapT(em, sc, pts, 3.5 * (fresh ? 1.15 : 1), amp);
    // one branch at 40-60% of the length
    const mi = Math.floor((pts.length - 1) * lerp(0.4, 0.6, h(10)));
    const mid = pts[mi];
    const ang = Math.atan2(c2[1] - a[1], c2[0] - a[0]) + (h(11) < 0.5 ? -1 : 1) * lerp(0.45, 0.85, h(12));
    const bl = Math.hypot(c2[0] - a[0], c2[1] - a[1]) * lerp(0.28, 0.45, h(13));
    const bp = boltPts(mid, [mid[0] + Math.cos(ang) * bl, mid[1] + Math.sin(ang) * bl], 2000 + i * 11 + tb * 71, 0.25, 3);
    zapT(em, sc, bp, 2.2, amp * 0.75);
  }
  const s0 = R.s(0);
  sparkBurst(em, sc, {
    n: Math.round(18 * electric), t, seed: 17, period: 0.5, life: 0.4, speed: 26 * s0, g: 22 * s0, spread: 1.0, len: 0.035, w: 2.4, k: 1,
    origin: (i, cyc) => {
      const vv = lerp(-1.7, 1.7, hash2(i * 1.9, cyc));
      const p = R.P(0.05, vv);
      const up = vv < 0;
      return { x: p[0], y: p[1], dir: up ? R.ang - Math.PI / 2 + 0.35 : R.ang + Math.PI / 2 - 0.35 };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// HAND — back-lit in the night. The thumb lies on top in the moonlight (broad lit top plane, crisp moon
// rim, colour-traced lit edges); the fingers wrap the saya below it, in the hand's own shadow (dark,
// low-contrast, thin rims only) so they recede and the eye goes to thumb, gap and tsuba.
const HSKIN = { moon: [226, 210, 232], lit: [156, 138, 172], base: [102, 88, 124], shade: [64, 54, 92], deep: [34, 28, 56], line: [12, 10, 28], crease: [30, 22, 50], nail: [176, 160, 192] };
const FSKIN = { base: [58, 50, 86], shade: [40, 34, 64], deep: [24, 20, 44], rim: [146, 132, 182], nail: [84, 74, 112], crease: [18, 14, 34] };
// st.handDark 0..1 darkens the whole hand (a back-lit foreground occluder in the sheath shot)
function handPal(st) {
  const dk = st.handDark || 0;
  if (!dk) return { H: HSKIN, F: FSKIN };
  const d = (o) => { const r = {}; for (const k in o) r[k] = k === 'line' ? o[k] : mixColor(o[k], [10, 9, 26], dk); return r; };
  return { H: d(HSKIN), F: d(FSKIN) };
}
const HLW = 3.2, HLI = 1.2;     // silhouette / interior line widths (px on the 1920 grid)
// rim crescent: the part of `path` not covered by `path` shifted by (-dx,-dy) — i.e. the edge facing (dx,dy)
function rimCrescent(ctx, path, dx, dy, color, alpha = 1, comp = 'source-over') {
  ctx.save(); ctx.clip(path);
  const p2 = new Path2D(); p2.addPath(path); p2.addPath(path, new DOMMatrix([1, 0, 0, 1, -dx, -dy]));
  ctx.globalCompositeOperation = comp; ctx.globalAlpha = alpha; ctx.fillStyle = typeof color === 'string' ? color : rgba(color);
  ctx.fill(p2, 'evenodd');
  ctx.restore();
}
// colour trace (iro-tore): re-stroke the outline in the rim colour only where the edge faces (dx,dy)
function traceLine(ctx, path, dx, dy, col, w, alpha = 1) {
  ctx.save();
  const m = new Path2D(); m.rect(-6000, -6000, 12000, 12000); m.addPath(path, new DOMMatrix([1, 0, 0, 1, -dx, -dy]));
  ctx.clip(m, 'evenodd');
  ctx.strokeStyle = typeof col === 'string' ? col : rgba(col, alpha); ctx.globalAlpha = typeof col === 'string' ? alpha : 1;
  ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.stroke(path);
  ctx.restore();
}
function curveUV(ctx, R, pts) {
  const s = crSample(pts, 6).map(([u, v]) => R.P(u, v));
  ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); ctx.stroke();
}
// thumb: tip pad on the tsuba face at T. The push comes mostly from the CMC joint far behind the saya, so the
// MCP slides forward with the tsuba while the IP joint straightens from ~30 deg to nearly straight.
function handGeo(st, b) {
  const bt = Math.min(b, st.thumbMax ?? 99);
  const push = st.thumbPush ?? clamp(bt / 2.6);
  const T = [bt + 0.12, -2.62];
  const M = [-5.02 + 0.95 * bt, lerp(-2.92, -2.84, push)];
  const l1 = 2.9, l2 = 2.3;
  const dx = T[0] - M[0], dy = T[1] - M[1], d = Math.hypot(dx, dy) || 1;
  const dd = Math.min(d, l1 + l2 - 1e-3), ux = dx / d, uy = dy / d;
  const aa = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), hh = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
  const J = [M[0] + ux * aa + uy * hh, M[1] + uy * aa - ux * hh];
  const B0 = [M[0] - 2.6, -2.35];  // base runs back into the thenar mass (off-frame / behind the saya top)
  const shift = M[0] + 5.02;
  return { M, T, J, B0, shift, push };
}
function drawHandBack(sc, em, R, st, b) {
  const { H, F } = handPal(st), electric = st.sparks * (st.glowK ?? 1);
  const { shift } = handGeo(st, b);
  const sN = R.s(-3);
  const sh = shift * 0.6;
  // back of the hand / thenar mass rising behind the saya top (mostly in shadow, moonlit top edge)
  const palm = [[-10.5, -1.2], [-10.0, -2.9], [-8.6, -3.9], [-6.9 + sh, -4.25], [-5.2 + sh, -4.05], [-4.0 + sh, -3.2], [-3.4 + sh, -1.4]];
  const pp = R.path(crSample(palm, 6).concat([[-3.4 + sh, 0], [-10.5, 0]]));
  sc.fillStyle = C(H.shade); sc.fill(pp);
  rimCrescent(sc, pp, 0.3 * sN, 0.2 * sN, H.deep, 0.85);
  rimCrescent(sc, pp, -0.1 * sN, -0.42 * sN, H.base, 0.95);
  rimCrescent(sc, pp, -0.08 * sN, -0.12 * sN, H.moon, 0.9);
  sc.strokeStyle = C(H.line); sc.lineWidth = HLW; sc.stroke(pp);
  traceLine(sc, pp, -0.08 * sN, -0.12 * sN, H.moon, HLW, 0.9);
  // tendon hint on the back of the hand
  sc.strokeStyle = C(H.deep, 0.7); sc.lineWidth = HLI; curveUV(sc, R, [[-9.2, -3.3], [-7.6, -3.55], [-6.2 + sh, -3.5]]);
  // fist underside below the saya: proximal phalanges curled under, one bulge per finger (deep shadow)
  const fist = [[0.15, 1.3], [0.35, 3.2], [-0.3, 5.2], [-1.3, 5.75], [-2.05, 5.5], [-2.75, 6.05], [-3.55, 5.75], [-4.2, 6.15], [-5.0, 5.8],
    [-5.65, 6.0], [-6.6, 5.6], [-7.8, 5.0], [-8.9, 3.6], [-9.2, 1.3]];
  const fp = R.path(crSample(fist, 6));
  sc.fillStyle = C(F.deep); sc.fill(fp);
  rimCrescent(sc, fp, -0.12 * sN, -0.05 * sN, F.shade, 0.9);
  if (electric > 0) rimCrescent(sc, fp, 0.14 * sN, -0.02 * sN, KAI.mid, 0.6 * electric);
  sc.strokeStyle = C(H.line); sc.lineWidth = HLW; sc.stroke(fp);
  if (electric > 0) traceLine(sc, fp, 0.14 * sN, -0.02 * sN, KAI.mid, HLW, 0.7 * electric);
  sc.strokeStyle = C(F.crease, 0.9); sc.lineWidth = HLI;
  for (const [u0, v0] of [[-2.05, 5.5], [-3.55, 5.75], [-5.0, 5.8]]) curveUV(sc, R, [[u0 + 0.05, v0 - 0.05], [u0 + 0.1, v0 - 0.9], [u0 + 0.15, v0 - 1.6]]);
}
function drawHandFront(sc, em, R, st, b) {
  const { H, F } = handPal(st), electric = st.sparks * (st.glowK ?? 1);
  const sN = R.s(-2);
  const { M, T, J, B0 } = handGeo(st, b);
  const tuv = capsule([B0, M, J, T], [2.7, 2.2, 2.02, 2.05], 8, 14, 0.55);
  const tp = R.path(tuv);
  // the thumb's soft shadow falls across the saya top and the fingertips
  {
    const sp = R.path(tuv.map(([u, v]) => [u + 0.15, v + 0.75]));
    sc.save(); sc.clip(R.path([[-14, -1.76], [0.0, -1.76], [0.0, 3], [-14, 3]]));
    sc.filter = `blur(${Math.max(1, 6 * sc.getTransform().a)}px)`; sc.fillStyle = 'rgba(2,3,14,0.55)'; sc.fill(sp); sc.filter = 'none';
    sc.restore();
  }
  // fingers wrap from under the saya up its near face (we see their backs: knuckles, nails), drawn far -> near.
  const fingers = [
    { u: -1.25, tip: -0.48, w: 1.68, lean: 0.06, kn: 2.35, el: 1 },
    { u: -2.7, tip: -0.86, w: 1.8, lean: -0.08, kn: 2.55, el: 0.3 },
    { u: -4.15, tip: -0.6, w: 1.68, lean: -0.2, kn: 2.45, el: 0.12 },
    { u: -5.6, tip: -0.05, w: 1.48, lean: -0.34, kn: 2.25, el: 0.05 },
  ];
  const keyRim = st.keyRim;
  const emRims = [];
  const fistClip = R.path([[-12, -6], [3, -6], [3, 4.4], [-12, 4.4]]);
  fingers.forEach((f) => {
    const bend = 0.3;   // PIP lateral offset -> ~12 deg bend
    const B = [f.u - f.lean * 0.35 + 0.05, 4.8], K = [f.u - bend * 0.5 + f.lean * 0.05, f.kn], Mi = [f.u + f.lean * 0.45, lerp(f.kn, f.tip, 0.45)];
    const Dp = [f.u + f.lean * 0.78, lerp(f.kn, f.tip, 0.76)], Tt = [f.u + f.lean, f.tip];
    const uv = capsule([B, K, Mi, Dp, Tt], [f.w * 1.0, f.w * 1.12, f.w * 0.92, f.w * 1.0, f.w * 0.8], 7, 12, 0.8);
    const pa = R.path(uv);
    sc.save(); sc.clip(fistClip);
    sc.fillStyle = C(F.base); sc.fill(pa);
    sc.save(); sc.clip(pa);
    // form terminator as the finger turns down under the saya: curved, staggered per finger
    const tv = f.kn + 0.55 + (f.tip + 0.5) * 0.4;
    sc.fillStyle = C(F.shade, 0.95);
    sc.fill(R.path(crSample([[f.u - 1.4, tv - 0.32], [f.u - 0.5, tv + 0.02], [f.u + 0.3, tv + 0.08], [f.u + 1.2, tv - 0.22]], 6).concat([[f.u + 1.4, 6], [f.u - 1.4, 6]])));
    sc.fillStyle = C(F.deep, 0.9);
    sc.fill(R.path(crSample([[f.u - 1.4, tv + 0.75], [f.u - 0.4, tv + 1.0], [f.u + 1.3, tv + 0.8]], 6).concat([[f.u + 1.4, 6], [f.u - 1.4, 6]])));
    sc.restore();
    // cylindrical side shading away from the moon, thin cool rim on the moon side
    rimCrescent(sc, pa, 0.42 * sN, 0.1 * sN, F.shade, 0.95);
    rimCrescent(sc, pa, 0.16 * sN, 0.04 * sN, F.deep, 0.6);
    rimCrescent(sc, pa, -0.07 * sN, -0.09 * sN, F.rim, 0.75);
    if (keyRim) rimCrescent(sc, pa, keyRim.dx * sN, keyRim.dy * sN, keyRim.col, keyRim.a);
    if (electric > 0 && f.el > 0) rimCrescent(sc, pa, 0.12 * sN, -0.02 * sN, KAI.hot, Math.min(1, 1.15 * electric * f.el));
    // knuckle (PIP) creases + DIP crease
    sc.strokeStyle = C(F.crease, 0.95); sc.lineWidth = HLI; sc.lineCap = 'round';
    curveUV(sc, R, [[K[0] - f.w * 0.3, K[1] + 0.22], [K[0] - 0.05, K[1] + 0.32], [K[0] + f.w * 0.22, K[1] + 0.2]]);
    curveUV(sc, R, [[K[0] - f.w * 0.2, K[1] + 0.42], [K[0] + 0.02, K[1] + 0.5], [K[0] + f.w * 0.16, K[1] + 0.42]]);
    curveUV(sc, R, [[Dp[0] - f.w * 0.26, Dp[1] + 0.3], [Dp[0], Dp[1] + 0.4], [Dp[0] + f.w * 0.22, Dp[1] + 0.3]]);
    // outline: silhouette weight, colour-traced where the moon / gap light hits
    sc.strokeStyle = C(H.line); sc.lineWidth = HLW; sc.lineJoin = 'round'; sc.stroke(pa);
    traceLine(sc, pa, -0.07 * sN, -0.09 * sN, F.rim, HLW, 0.6);
    if (electric > 0 && f.el > 0) traceLine(sc, pa, 0.12 * sN, -0.02 * sN, KAI.hot, HLW, Math.min(1, 1.2 * electric * f.el));
    // nail: small, foreshortened, flat fill, 1px cuticle arc only
    const nw = f.w * 0.25, n0 = f.tip + 0.18, n1 = f.tip + 0.62, nu = f.u + f.lean * 0.92 - 0.1;
    const nail = [[nu - nw, n1], [nu - nw * 1.04, n0 + 0.2], [nu - nw * 0.6, n0 + 0.03], [nu, n0 - 0.02], [nu + nw * 0.6, n0 + 0.03], [nu + nw * 1.04, n0 + 0.2], [nu + nw, n1], [nu, n1 + 0.08]];
    const np = R.path(crSample(nail.concat([nail[0]]), 5));
    sc.fillStyle = C(F.nail); sc.fill(np);
    rimCrescent(sc, np, -0.05 * sN, -0.07 * sN, F.rim, 0.45);
    if (electric > 0 && f.el > 0.5) rimCrescent(sc, np, 0.07 * sN, 0, KAI.core, electric);
    sc.strokeStyle = C(F.crease, 0.9); sc.lineWidth = HLI;
    curveUV(sc, R, [[nu - nw * 0.95, n1 - 0.02], [nu, n1 + 0.12], [nu + nw * 0.95, n1 - 0.02]]);
    sc.restore();
    if (electric > 0 && f.el > 0.5) emRims.push(pa);
  });
  // thumb on the top of the saya, pad pressed flat on the tsuba face; its base emerges from behind the saya
  sc.save();
  const hide = new Path2D(); hide.rect(-400, -400, RW + 800, RH + 800);
  hide.addPath(R.path([[M[0] - 7, -1.74], [M[0] + 0.15, -1.74], [M[0] + 0.15, 6], [M[0] - 7, 6]]));
  sc.clip(hide, 'evenodd');
  sc.fillStyle = C(H.base); sc.fill(tp);
  rimCrescent(sc, tp, 0, 0.62 * sN, H.shade, 0.95);            // underside in shadow
  rimCrescent(sc, tp, 0.04 * sN, 0.24 * sN, H.deep, 0.75);
  rimCrescent(sc, tp, -0.05 * sN, -0.62 * sN, H.lit, 0.95);    // broad moonlit top plane
  rimCrescent(sc, tp, -0.05 * sN, -0.13 * sN, H.moon, 0.95);   // crisp moon rim
  if (st.keyRim) rimCrescent(sc, tp, st.keyRim.dx * sN, st.keyRim.dy * sN, st.keyRim.col, st.keyRim.a);
  if (electric > 0) {
    rimCrescent(sc, tp, 0.03 * sN, 0.1 * sN, KAI.hot, Math.min(1, 0.95 * electric));   // gap light from below
    emRims.push({ pa: tp, clip: hide });
  }
  // IP joint creases on the top of the joint (wrinkle more as it bends)
  const push = handGeo(st, b).push;
  const ddx = T[0] - J[0], ddy = T[1] - J[1], dl = Math.hypot(ddx, ddy) || 1, tx = ddx / dl, ty = ddy / dl;
  let nx = -ty, ny = tx; if (ny > 0) { nx = -nx; ny = -ny; }
  sc.strokeStyle = C(H.crease, 0.9); sc.lineWidth = HLI;
  const nk = push < 0.6 ? 3 : 2;
  for (let j = 0; j < nk; j++) {
    const o = -0.25 + j * 0.22;
    const a0 = [J[0] + tx * o + nx * 0.92, J[1] + ty * o + ny * 0.92], a1 = [J[0] + tx * (o + 0.05) + nx * 0.45, J[1] + ty * (o + 0.05) + ny * 0.45];
    curveUV(sc, R, [a0, [lerp(a0[0], a1[0], 0.5) + tx * 0.06, lerp(a0[1], a1[1], 0.5) + ty * 0.06], a1]);
  }
  sc.strokeStyle = C(H.line); sc.lineWidth = HLW; sc.stroke(tp);
  traceLine(sc, tp, -0.05 * sN, -0.13 * sN, H.moon, HLW, 0.9);
  if (electric > 0) traceLine(sc, tp, 0.03 * sN, 0.1 * sN, KAI.hot, HLW, Math.min(1, 1.1 * electric));
  sc.restore();
  // thumbnail: a narrow lens along the top edge of the distal phalanx, seen almost edge-on
  {
    const half = 0.98;
    const pts = [[0.42, 0.62], [0.6, 0.86], [0.84, 0.9], [0.99, 0.74], [0.97, 0.56], [0.78, 0.5], [0.58, 0.5]];
    const nail = pts.map(([a, o]) => [J[0] + tx * dl * a + nx * o * half, J[1] + ty * dl * a + ny * o * half]);
    const np = R.path(crSample(nail.concat([nail[0]]), 5));
    sc.fillStyle = C(mixColor(H.lit, H.nail, 0.5)); sc.fill(np);
    rimCrescent(sc, np, 0.03 * sN, 0.07 * sN, H.base, 0.6);
    rimCrescent(sc, np, -0.03 * sN, -0.06 * sN, H.moon, 0.9);
    const c0 = [J[0] + tx * dl * 0.44 + nx * 0.5, J[1] + ty * dl * 0.44 + ny * 0.5], c1 = [J[0] + tx * dl * 0.4 + nx * 0.68, J[1] + ty * dl * 0.4 + ny * 0.68], c2 = [J[0] + tx * dl * 0.46 + nx * 0.86, J[1] + ty * dl * 0.46 + ny * 0.86];
    sc.strokeStyle = C(H.crease, 0.9); sc.lineWidth = HLI; curveUV(sc, R, [c0, c1, c2]);
  }
  // emission for the electric rims (so they bloom)
  if (electric > 0) {
    for (const r of emRims) {
      const pa = r.pa || r;
      em.save(); if (r.clip) em.clip(r.clip, 'evenodd');
      rimCrescent(em, pa, 0.06 * sN, 0.06 * sN, KAI.hot, 0.5 * electric, 'lighter');
      em.restore();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// SHOT 2 — HILT CLOSE-UP
export function drawHiltCloseup(S, o = {}) {
  const t = o.t ?? (S.t - (S.shot ? S.shot.start : 0)), push = clamp(o.push ?? 0), gleam = o.gleam ?? 0, sparks = clamp(o.sparks ?? 0.7);
  const A = assets(S);
  const sc = S.L.scene, em = S.L.emit;
  const dr = clamp(t / 1.4);
  const cam = { zoom: (1.0 + 0.05 * dr + 0.012 * push) * (o.zoom ?? 1), x: -18 * dr, y: 8 * dr, rot: -0.012 * dr };
  sc.save(); em.save();
  base(S, sc, cam); base(S, em, cam);
  em.globalCompositeOperation = 'lighter';
  drawBG(sc, need(A, 'hiltBG', buildHiltBG));
  bokehField(sc, em, A, { seed: 3, n: 14, t, palette: ['blue', 'violet', 'white', 'cyan'], rMin: 10, rMax: 70, alpha: 0.22, drift: [10, -14], emitK: 0.3 });
  // Akane's crimson glow far away on the right: out-of-focus crystals / embers
  bokehField(sc, em, A, { seed: 41, n: 9, t, palette: ['red', 'pink', 'red'], rMin: 12, rMax: 64, alpha: 0.32, drift: [-6, -10], box: [1250, -80, 2020, 1000], emitK: 0.45 });
  const R = rig({ ox: 560, oy: 640, ang: -0.2, s0: 112, persp: 0.024, e: 0.36 });
  const b = push * 2.6;
  drawKatana(sc, em, A, R, {
    b, t, sparks: sparks * smoothstep(0, 0.35, push + 0.15), gleam, bladeGlow: 0.35 * push, glowK: 1,
    sageo: o.sageo ?? true, sageoBlur: 5,
  });
  // foreground defocused motes
  bokehField(sc, em, A, { seed: 9, n: 6, t, palette: ['cyan', 'blue', 'white'], rMin: 60, rMax: 190, alpha: 0.14, drift: [-22, -10], emitK: 0.35 });
  sc.restore(); em.restore();
}

// ---------------------------------------------------------------------------------------------
// SHOT 9 — SHEATH CLOSE-UP ("chin")
export function drawSheathCloseup(S, o = {}) {
  const t = o.t ?? (S.t - (S.shot ? S.shot.start : 0)), k = clamp(o.k ?? 0);
  const click = o.click ?? (k >= 1 ? 0.25 : -1);
  const A = assets(S);
  const sc = S.L.scene, em = S.L.emit;
  const b = lerp(4.6, 0, k);
  const settle = click >= 0 ? Math.exp(-click * 9) * Math.sin(click * 70) : 0;
  const dr = clamp(t / 1.2);
  const cam = { zoom: (1.04 + 0.03 * dr) * (o.zoom ?? 1), x: 10 - 14 * dr, y: -4 + settle * 6, rot: 0.01 - 0.008 * dr };
  sc.save(); em.save();
  base(S, sc, cam); base(S, em, cam);
  em.globalCompositeOperation = 'lighter';
  drawBG(sc, need(A, 'sheathBG', buildSheathBG));
  bokehField(sc, em, A, { seed: 21, n: 24, t, palette: ['red', 'pink', 'red', 'violet', 'white', 'blue'], rMin: 8, rMax: 80, alpha: 0.28, drift: [-6, 12], emitK: 0.4 });
  // the camera tracks the hilt a little as it slides home
  const R = rig({ ox: lerp(880, 620, b / 4.6), oy: lerp(500, 480, b / 4.6), ang: 0.13, s0: 128, persp: 0.02, e: 0.3 });
  const resid = (1 - k) * 0.8 + 0.2 * Math.max(0, 1 - Math.max(0, click) * 2);
  const keyRim = { dx: 0.1, dy: -0.07, col: [196, 228, 255], a: 0.9 };
  const st = {
    b, t, sparks: 0.45 * (1 - k) + (click >= 0 ? 0.8 * Math.exp(-click * 7) : 0), gleam: o.gleam ?? 0, bladeGlow: 0.6 * resid, glowK: 1,
    thumbPush: 0.3, thumbMax: 0.3, keyRim, handBlur: o.handBlur ?? 9, deferFront: true, handDark: o.handDark ?? 0.45,
    tsuka: { darkLen: 10, blur: 6, sharpLen: 2.4, fadeLen: 3.2 },
  };
  drawKatana(sc, em, A, R, st);
  // click: a small burst of radial spark streaks squeezed out of the koiguchi seam + flash + star
  if (click >= 0) {
    const q = Math.min(1, click / 0.42);
    const ease = 1 - Math.pow(1 - q, 3);
    const p = R.P(0.05, 0), s = R.s(0);
    const rr = lerp(2.0, 3.6, ease);
    const fade = Math.pow(1 - q, 1.3);
    if (fade > 0.002) {
      em.save(); em.globalCompositeOperation = 'lighter'; em.lineCap = 'round';
      em.translate(p[0], p[1]); em.rotate(R.ang);
      const tb = Math.floor(t * 24 + 0.5);
      const N = 26;
      for (let i = 0; i < N; i++) {
        if (hash2(i, 7) > 0.65) continue;
        const a = (i / N) * TAU + (hash2(i, 3) - 0.5) * 0.22;
        const ca = Math.cos(a) * R.e, sa2 = Math.sin(a);
        const dl = Math.hypot(ca, sa2) || 1, dx = ca / dl, dy = sa2 / dl;
        const r0 = rr * (0.9 + 0.2 * hash2(i, tb));
        const x = ca * r0 * s, y = sa2 * r0 * s;
        const Lc = lerp(0.2, 0.7, hash2(i, 9)) * s * (0.35 + 0.65 * fade);
        const aa = fade * (0.6 + 0.4 * hash2(i, tb + 1));
        em.strokeStyle = C(KAI.mid, 0.5 * aa); em.lineWidth = 7;
        em.beginPath(); em.moveTo(x - dx * Lc, y - dy * Lc); em.lineTo(x, y); em.stroke();
        em.strokeStyle = C(KAI.hot, 0.9 * aa); em.lineWidth = 3; em.stroke();
        em.strokeStyle = C(KAI.core, aa); em.lineWidth = 1.3; em.stroke();
        sc.save(); sc.setTransform(em.getTransform()); sc.strokeStyle = C('#f4feff', 0.85 * aa); sc.lineWidth = 1.2; sc.lineCap = 'round';
        sc.beginPath(); sc.moveTo(x - dx * Lc * 0.8, y - dy * Lc * 0.8); sc.lineTo(x, y); sc.stroke(); sc.restore();
      }
      // two short arc fragments of the ring at most
      for (let j = 0; j < 2; j++) {
        const a0 = hash2(j, 41) * TAU, span = 0.5 + 0.4 * hash2(j, 43);
        const fr = new Path2D(); fr.ellipse(0, 0, rr * 0.92 * R.e * s, rr * 0.92 * s, 0, a0, a0 + span);
        em.strokeStyle = C(KAI.hot, 0.55 * fade); em.lineWidth = 2.5; em.stroke(fr);
      }
      // flash at the junction
      const fl = Math.exp(-click * 14);
      const gg = em.createRadialGradient(0, 0, 0, 0, 0, 2.6 * s);
      gg.addColorStop(0, C(KAI.core, 0.95 * fl)); gg.addColorStop(0.22, C(KAI.hot, 0.55 * fl)); gg.addColorStop(1, C(KAI.deep, 0));
      em.fillStyle = gg; em.fillRect(-3 * s, -3 * s, 6 * s, 6 * s);
      em.restore();
      drawStar(em, A, p[0], p[1] - 0.2 * s, 760 * fl + 160, fl, 0.07);
    }
    // sparks with gravity squeezed out of the seam
    sparkBurst(em, sc, {
      n: 14, t: click, seed: 5, once: true, life: 0.55, speed: 30 * s, g: 40 * s, spread: 0.5, len: 0.03, w: 2.4, k: 1,
      origin: (i) => {
        const vv = lerp(-1.8, 1.8, hash2(i, 2.2));
        const pp = R.P(0.05, vv);
        return { x: pp[0], y: pp[1], dir: vv < 0 ? R.ang - Math.PI / 2 - 0.25 + hash2(i, 5) * 0.5 : R.ang + Math.PI / 2 - 0.25 + hash2(i, 6) * 0.5 };
      },
    });
  }
  // the foreground hand goes last so it occludes the click fx (and knocks them out of emit)
  drawHandFrontPass(A, sc, em, R, st, b);
  bokehField(sc, em, A, { seed: 33, n: 6, t, palette: ['red', 'pink', 'white'], rMin: 70, rMax: 200, alpha: 0.12, drift: [14, 8], emitK: 0.3 });
  sc.restore(); em.restore();
}

// ---------------------------------------------------------------------------------------------
// SHOT 3 — EYE EXTREME CLOSE-UP
// eye-local coordinates (px on the 1920 grid), origin near the iris centre; the subject's left eye seen
// from the front: inner corner (nose side) at image left, outer corner at image right.
const EYE = {
  cx: 950, cy: 590, rot: -0.045,
  IC: [-650, 92], OC: [700, -78],
  upO: [[-650, 92], [-610, -6], [-520, -128], [-360, -222], [-120, -268], [150, -280], [400, -262], [570, -222], [662, -158], [700, -78]],
  upC: [[-650, 92], [-580, 150], [-430, 222], [-225, 262], [10, 272], [250, 258], [450, 214], [590, 140], [664, 40], [700, -78]],
  lo: [[-650, 92], [-560, 178], [-390, 262], [-150, 302], [110, 306], [350, 268], [535, 186], [650, 64], [700, -78]],
  crO: [[-520, -238], [-350, -334], [-110, -380], [160, -388], [400, -364], [575, -310], [680, -226]],
  crC: [[-520, 64], [-350, 116], [-110, 146], [160, 140], [400, 112], [575, 60], [680, -20]],
  iris: { x: 30, y: 18, rx: 296, ry: 336 },
};
function lerpPts(a, b, t) { return a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]); }

function buildIris(k, mode) {
  const rx = EYE.iris.rx, ry = EYE.iris.ry, m = 24;
  const w = Math.ceil((2 * rx + 2 * m) * k), h = Math.ceil((2 * ry + 2 * m) * k);
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, w / 2, h / 2);
  const P = (r, a) => [Math.cos(a) * r * rx, Math.sin(a) * r * ry];
  const ell = (r) => { g.beginPath(); g.ellipse(0, 0, r * rx, r * ry, 0, 0, TAU); };
  const radial = (stops) => {
    g.save(); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
  };
  g.save(); ell(1); g.clip();
  const rng = new RNG(mode === 0 ? 5 : 6);
  if (mode === 0) {
    const lg = g.createLinearGradient(0, -ry, 0, ry);
    lg.addColorStop(0, '#050820'); lg.addColorStop(0.3, '#0c1650'); lg.addColorStop(0.62, '#153c92'); lg.addColorStop(0.86, '#2768c4'); lg.addColorStop(1, '#4c96dc');
    g.fillStyle = lg; g.fillRect(-rx, -ry, 2 * rx, 2 * ry);
    radial([[0, 'rgba(0,0,0,0)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(3,5,26,0.75)']]);
  } else if (mode === 1) {
    radial([[0, '#d2faff'], [0.27, '#9cefff'], [0.4, '#4ed0ff'], [0.55, '#1f9cff'], [0.7, '#1a66e4'], [0.86, '#173ec4'], [1, '#0a1a6e']]);
    const lg = g.createLinearGradient(0, -ry, 0, ry);
    lg.addColorStop(0, 'rgba(6,14,70,0.8)'); lg.addColorStop(0.3, 'rgba(10,20,90,0.15)'); lg.addColorStop(0.55, 'rgba(10,20,90,0)'); lg.addColorStop(1, 'rgba(170,245,255,0.3)');
    g.fillStyle = lg; g.fillRect(-rx, -ry, 2 * rx, 2 * ry);
  } else {
    // emission: dark at the pupil (it stays a black hole after bloom), peaking in a ring just outside it
    g.fillStyle = '#000'; g.fillRect(-rx, -ry, 2 * rx, 2 * ry);
    radial([[0, 'rgba(0,0,0,0)'], [0.28, 'rgba(110,225,255,0)'], [0.35, 'rgba(150,238,255,0.42)'], [0.45, 'rgba(140,235,255,0.44)'],
      [0.6, 'rgba(42,156,255,0.2)'], [0.85, 'rgba(24,64,208,0.08)'], [1, 'rgba(10,26,110,0.0)']]);
    const lg = g.createLinearGradient(0, -ry, 0, ry);
    lg.addColorStop(0, 'rgba(0,0,0,0.85)'); lg.addColorStop(0.35, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(-rx, -ry, 2 * rx, 2 * ry);
  }
  // radial striations (fine fibres, two families)
  for (let i = 0; i < 340; i++) {
    const a = rng.next() * TAU, r0 = 0.3 + rng.next() * 0.16, r1 = 0.62 + rng.next() * 0.36;
    const light = rng.next() < 0.55;
    const wob = (rng.next() - 0.5) * 0.14;
    const p0 = P(r0, a), pm = P((r0 + r1) / 2, a + wob), p1 = P(r1, a + wob * 0.4);
    if (mode === 0) g.strokeStyle = light ? `rgba(100,165,255,${0.1 + rng.next() * 0.2})` : `rgba(2,6,34,${0.18 + rng.next() * 0.28})`;
    else if (mode === 1) g.strokeStyle = light ? `rgba(240,254,255,${0.16 + rng.next() * 0.32})` : `rgba(6,30,130,${0.25 + rng.next() * 0.35})`;
    else g.strokeStyle = light ? `rgba(150,235,255,${0.12 + rng.next() * 0.3})` : 'rgba(0,0,0,0)';
    g.lineWidth = 1 + rng.next() * 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(pm[0], pm[1], p1[0], p1[1]); g.stroke();
  }
  // crypts: small dark lens shapes between fibres (dormant/lit only)
  if (mode !== 2) {
    for (let i = 0; i < 46; i++) {
      const a = rng.next() * TAU, r = 0.55 + rng.next() * 0.3, p = P(r, a);
      g.save(); g.translate(p[0], p[1]); g.rotate(a);
      g.fillStyle = mode === 0 ? 'rgba(3,8,40,0.35)' : 'rgba(10,50,170,0.3)';
      g.beginPath(); g.ellipse(0, 0, 16 + rng.next() * 18, 3 + rng.next() * 4, 0, 0, TAU); g.fill();
      g.restore();
    }
  }
  // collarette (wavy ring around the pupil zone)
  g.beginPath();
  for (let i = 0; i <= 140; i++) {
    const a = i / 140 * TAU, r = 0.46 + 0.035 * Math.sin(a * 9) + 0.02 * Math.sin(a * 23 + 1);
    const p = P(r, a); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
  }
  g.closePath();
  if (mode === 0) { g.fillStyle = 'rgba(50,95,200,0.18)'; g.fill(); }
  g.strokeStyle = mode === 0 ? 'rgba(100,160,250,0.45)' : mode === 1 ? 'rgba(255,255,255,0.8)' : 'rgba(170,245,255,0.6)';
  g.lineWidth = mode === 0 ? 3 : 4; g.stroke();
  // lower crescent light (anime iris bottom glow)
  g.save();
  g.beginPath(); g.ellipse(0, 0.05 * ry, 0.88 * rx, 0.88 * ry, 0, 0, TAU); g.ellipse(0, -0.16 * ry, 0.84 * rx, 0.8 * ry, 0, 0, TAU, true);
  g.clip('evenodd');
  const cg = g.createLinearGradient(0, 0.3 * ry, 0, ry);
  if (mode === 0) { cg.addColorStop(0, 'rgba(100,190,255,0)'); cg.addColorStop(1, 'rgba(140,210,255,0.7)'); }
  else if (mode === 1) { cg.addColorStop(0, 'rgba(180,250,255,0)'); cg.addColorStop(1, 'rgba(234,252,255,0.9)'); }
  else { cg.addColorStop(0, 'rgba(127,232,255,0)'); cg.addColorStop(1, 'rgba(127,232,255,0.55)'); }
  g.fillStyle = cg; g.fillRect(-rx, -ry, 2 * rx, 2 * ry);
  g.restore();
  // speckles
  for (let i = 0; i < 90; i++) {
    const a = rng.next() * TAU, r = 0.5 + rng.next() * 0.45, p = P(r, a);
    g.fillStyle = mode === 0 ? `rgba(160,210,255,${0.1 + rng.next() * 0.26})` : `rgba(255,255,255,${0.25 + rng.next() * 0.5})`;
    g.beginPath(); g.arc(p[0], p[1], 0.8 + rng.next() * 2.2, 0, TAU); g.fill();
  }
  g.restore();
  // limbal ring
  if (mode !== 2) {
    ell(0.975); g.strokeStyle = mode === 0 ? '#040720' : '#0a1a6e'; g.lineWidth = 22; g.stroke();
    ell(1.0); g.strokeStyle = LINE; g.lineWidth = 5; g.stroke();
  } else {
    ell(0.96); g.strokeStyle = 'rgba(42,156,255,0.4)'; g.lineWidth = 10; g.stroke();
  }
  return { c, w, h, rx, ry, k };
}

// cool moonlit skin: the energy must be the brightest thing in frame
const ESKIN = { lit: [158, 150, 204], base: [100, 94, 152], shade: [62, 58, 116], deep: [32, 30, 78], line: [14, 12, 38], crease: [38, 30, 84] };
// eyebrow: one bold tapered mass (anime brows are a shape, not a fur), arched and scowling, with a few
// sharp strand tips breaking the top edge toward the tail and a cool sheen streak along the upper third
function browStrokes(g, center, thick, seed) {
  const line = crSample(center, 12);
  const n = line.length;
  const rng = new RNG(seed);
  const top = [], bot = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const q = i / (n - 1), w = thick(q) / 2;
    top.push([line[i][0] + dy * w, line[i][1] - dx * w, dx, dy, q]);
    bot.push([line[i][0] - dy * w * 0.92, line[i][1] + dx * w * 0.92]);
  }
  // top edge with strand tips (pointing toward the tail, lifted off the edge)
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x, y, dx, dy, q] = top[i];
    out.push([x, y]);
    if (i > 3 && i < n - 4 && i % 5 === 2 && rng.next() < 0.8) {
      const L = lerp(46, 18, q) * (0.7 + 0.6 * rng.next());
      out.push([x + dx * L + dy * L * 0.32, y + dy * L - dx * L * 0.32]);
      const j = i + 1; out.push([top[j][0] - top[j][3] * 5, top[j][1] + top[j][2] * 5]);
      i++;
    }
  }
  const tail = line[n - 1], tdir = [top[n - 1][2], top[n - 1][3]];
  out.push([tail[0] + tdir[0] * 30, tail[1] + tdir[1] * 30 + 6]);
  const path = pathOf(out.concat(bot.slice().reverse()));
  g.fillStyle = '#0d0f2a'; g.fill(path);
  g.save(); g.clip(path);
  // darker core along the lower half + faint strand texture (low contrast)
  g.fillStyle = 'rgba(4,5,16,0.7)'; g.fill(pathOf(ribbonPts(line.map(([x, y], i) => [x - top[i][3] * thick(i / (n - 1)) * 0.2, y + top[i][2] * thick(i / (n - 1)) * 0.2]), (q) => thick(q) * 0.55)));
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const q0 = rng.next() * 0.85, q1 = Math.min(1, q0 + 0.08 + rng.next() * 0.14);
    const i0 = Math.floor(q0 * (n - 1)), i1 = Math.floor(q1 * (n - 1)), off = (rng.next() - 0.5) * 0.7;
    const P = (i) => [line[i][0] + top[i][3] * thick(i / (n - 1)) * off * 0.5, line[i][1] - top[i][2] * thick(i / (n - 1)) * off * 0.5];
    const a = P(i0), b = P(i1);
    g.strokeStyle = rng.next() < 0.5 ? 'rgba(40,46,104,0.55)' : 'rgba(0,0,8,0.6)'; g.lineWidth = 2 + rng.next() * 3;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1] - 4); g.stroke();
  }
  // moon sheen: one long crisp streak + a short one along the upper third
  const sheen = (q0, q1, off, w, col) => {
    const pts = []; for (let i = Math.floor(q0 * (n - 1)); i <= Math.floor(q1 * (n - 1)); i++) pts.push([line[i][0] + top[i][3] * thick(i / (n - 1)) * off, line[i][1] - top[i][2] * thick(i / (n - 1)) * off]);
    if (pts.length > 2) { g.fillStyle = col; g.fill(pathOf(ribbonPts(pts, (q) => w * Math.sin(Math.PI * q)))); }
  };
  sheen(0.12, 0.62, -0.1, 7, 'rgba(70,88,180,0.4)');
  g.restore();
}

// static skin around the eye (socket, lid region, under-eye, cheek, brow)
function buildSkin(k) {
  const bx = -140, by = -120, bw = 2200, bh = 1320;
  const w = Math.ceil(bw * k), h = Math.ceil(bh * k);
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, -bx * k, -by * k);
  g.translate(EYE.cx, EYE.cy); g.rotate(EYE.rot);
  const S2 = ESKIN;
  g.fillStyle = C(S2.base); g.fillRect(-1400, -1000, 2800, 2000);
  // broad moonlight from the upper left, falling off to the lower right
  const lg = g.createLinearGradient(-1000, -800, 700, 500);
  lg.addColorStop(0, C(S2.lit, 0.4)); lg.addColorStop(0.42, C(S2.lit, 0));
  g.fillStyle = lg; g.fillRect(-1400, -1000, 2800, 2000);
  const dg = g.createLinearGradient(-100, -100, 1100, 900);
  dg.addColorStop(0, C(S2.deep, 0)); dg.addColorStop(1, C(S2.deep, 0.7));
  g.fillStyle = dg; g.fillRect(-1400, -1000, 2800, 2000);
  // orbital socket shadow: ONE hard edge that follows the orbit (dips toward the inner canthus, rises to the temple)
  const edge = crSample([[-1250, 300], [-1020, 40], [-800, -190], [-600, -292], [-380, -392], [-120, -445], [180, -458], [460, -440], [700, -400], [900, -390], [1150, -440], [1400, -520]], 10);
  g.fillStyle = C(S2.shade, 0.88);
  g.fill(pathOf(edge.concat([[1400, -1000], [-1400, -1000], [-1400, 300]])));
  // soft core deepening right under the brow ridge (no edge)
  const bg = g.createLinearGradient(0, -560, 0, -380);
  bg.addColorStop(0, C(S2.deep, 0.35)); bg.addColorStop(1, C(S2.deep, 0));
  g.fillStyle = bg; g.fillRect(-1400, -1000, 2800, 620);
  // nose-side: the socket deepens softly toward the bridge, fading out below the eye
  g.save();
  const ng = g.createLinearGradient(0, -700, 0, 420);
  ng.addColorStop(0, C(S2.deep, 0.55)); ng.addColorStop(0.55, C(S2.deep, 0.3)); ng.addColorStop(1, C(S2.deep, 0));
  g.beginPath(); g.moveTo(-1400, -900); g.lineTo(-850, -900); g.bezierCurveTo(-700, -420, -640, -160, -760, 300); g.lineTo(-900, 600); g.lineTo(-1400, 600); g.closePath();
  g.fillStyle = ng; g.fill();
  g.restore();
  // under-eye: crisp lower-lid fold shadow + soft falloff, cheek plane
  g.fillStyle = C(S2.shade, 0.8);
  g.beginPath(); g.moveTo(-600, 200); g.bezierCurveTo(-400, 330, -120, 372, 140, 368); g.bezierCurveTo(360, 360, 520, 290, 640, 150);
  g.bezierCurveTo(520, 250, 360, 316, 120, 330); g.bezierCurveTo(-120, 334, -380, 300, -600, 200); g.closePath(); g.fill();
  g.save(); g.translate(40, 380); g.scale(1, 0.24);
  const ug = g.createRadialGradient(0, 0, 0, 0, 0, 760);
  ug.addColorStop(0, C(S2.shade, 0.35)); ug.addColorStop(1, C(S2.shade, 0));
  g.fillStyle = ug; g.beginPath(); g.arc(0, 0, 760, 0, TAU); g.fill(); g.restore();
  // cheekbone catching the moon (soft lit plane), then the cheek turning away
  g.save(); g.translate(-260, 640); g.rotate(-0.25); g.scale(1, 0.4);
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, 560);
  cg.addColorStop(0, C(S2.lit, 0.22)); cg.addColorStop(1, C(S2.lit, 0));
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 560, 0, TAU); g.fill(); g.restore();
  g.fillStyle = C(S2.deep, 0.45);
  g.beginPath(); g.moveTo(-460, 1100); g.bezierCurveTo(-220, 760, 520, 650, 1300, 560); g.lineTo(1300, 1100); g.closePath(); g.fill();
  // red rim of Akane's light on the far cheek / temple (hard-edged band + soft spill)
  const rg = g.createLinearGradient(700, 0, 1180, 0);
  rg.addColorStop(0, 'rgba(255,40,90,0)'); rg.addColorStop(1, 'rgba(255,40,90,0.3)');
  g.fillStyle = rg; g.fillRect(700, -900, 800, 2000);
  g.fillStyle = 'rgba(255,50,100,0.35)';
  g.beginPath(); g.moveTo(1500, -900); g.lineTo(1080, -900); g.bezierCurveTo(1010, -300, 1000, 300, 1060, 1100); g.lineTo(1500, 1100); g.closePath(); g.fill();
  // brow head furrows (scowl)
  g.strokeStyle = C(S2.crease, 0.85); g.lineWidth = 4; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const x = -930 + i * 38;
    g.beginPath(); g.moveTo(x, -420 + i * 14); g.quadraticCurveTo(x + 18, -330 + i * 10, x + 2, -250 + i * 8); g.stroke();
  }
  // brow: arched, the head pulled down toward the eye (scowl), tapered tail
  // soft cast shadow of the brow ridge just under the brow
  g.save(); g.filter = 'blur(22px)';
  g.strokeStyle = C(S2.deep, 0.6); g.lineWidth = 90; g.lineCap = 'round';
  strokePts(g, crSample([[-900, -250], [-560, -345], [-150, -405], [300, -420], [760, -372]], 8));
  g.restore();
  // at this magnification the brow is a huge mass: only its lower edge enters the top of the frame
  browStrokes(g, [[-940, -420], [-560, -486], [-150, -526], [300, -524], [780, -462], [1000, -400]],
    (q) => lerp(230, 64, Math.pow(q, 1.1)) * (q < 0.05 ? 0.6 + q * 8 : 1), 91);
  return { c, x: bx, y: by, w: bw, h: bh };
}

function eyePaths(open) {
  const up = lerpPts(EYE.upC, EYE.upO, open);
  const upS = crSample(up, 10), loS = crSample(EYE.lo, 10);
  const ap = upS.concat(loS.slice(1, -1).reverse());
  const cr = crSample(lerpPts(EYE.crC, EYE.crO, open), 8);
  return { up, upS, loS, aperture: pathOf(ap), cr };
}
// thick upper lash line with an outer wing (returns its path + the lifted centre line)
function lashGeo(E2, op = 1) {
  const up = E2.upS, n = up.length;
  const wf = (q) => lerp(12, 66, smoothstep(0.0, 0.55, q)) * (q > 0.95 ? lerp(1, 0.75, (q - 0.95) / 0.05) : 1);
  const lifted = up.map(([x, y], i) => [x, y - wf(i / (n - 1)) * 0.42]);
  const oc = up[n - 1], pr2 = up[n - 4];
  // the wing follows the lid's last segment when open; when shut it flattens out to the right and shortens
  const wl0 = Math.hypot(oc[0] - pr2[0], oc[1] - pr2[1]) || 1;
  let wdx = lerp(0.97, (oc[0] - pr2[0]) / wl0, op), wdy = lerp(0.24, (oc[1] - pr2[1]) / wl0, op);
  const wl = Math.hypot(wdx, wdy) || 1, wk = lerp(0.55, 1, op);
  const wing = [[oc[0] + wdx / wl * 40 * wk, oc[1] + wdy / wl * 40 * wk - 12 * wk], [oc[0] + (wdx / wl * 110 + 20) * wk, oc[1] + (wdy / wl * 110 + 6) * wk]];
  const lineAll = lifted.concat(wing);
  const rp = ribbonPts(lineAll, (q) => q < 0.94 ? wf(q / 0.94) : lerp(wf(1), 0, (q - 0.94) / 0.06));
  return { lp: pathOf(rp), lifted, wf, wing, n };
}

export function drawEyeCloseup(S, o = {}) {
  const t = o.t ?? (S.t - (S.shot ? S.shot.start : 0));
  const open = clamp(o.open ?? 1, 0, 1.12), glowIn = clamp(o.glow ?? 0, 0, 1.3), reflect = clamp(o.reflect ?? 0);
  const glow = Math.min(1, glowIn), over = Math.max(0, glowIn - 1), boost = 1 + 3 * over;
  const A = assets(S);
  const sc = S.L.scene, em = S.L.emit, ui = S.L.ui;
  const SK = need(A, 'skin', buildSkin), ID = need(A, 'irisDark', (k) => buildIris(k, 0)), IL = need(A, 'irisLit', (k) => buildIris(k, 1)), IE = need(A, 'irisEmit', (k) => buildIris(k, 2));
  const dr = clamp(t / 1.0);
  const cam = { zoom: (1.0 + 0.04 * dr + 0.025 * glow) * (o.zoom ?? 1), x: 6 * dr, y: -4 * dr, rot: 0.004 * dr };
  const tb = Math.floor(t * 24 + 0.5);
  sc.save(); em.save();
  base(S, sc, cam); base(S, em, cam);
  em.globalCompositeOperation = 'lighter';
  sc.drawImage(SK.c, SK.x, SK.y, SK.w, SK.h);
  sc.translate(EYE.cx, EYE.cy); sc.rotate(EYE.rot);
  em.translate(EYE.cx, EYE.cy); em.rotate(EYE.rot);
  const E2 = eyePaths(open);
  const LG = lashGeo(E2, Math.min(1, open));
  const I = EYE.iris;
  const op = Math.min(1, open);
  const look = o.look || { x: 0, y: 0 };
  const ix = I.x + (look.x || 0), iy = I.y + (look.y || 0);
  // ignition light falling on the skin around the eye (strong, cyan)
  if (glow > 0) {
    sc.save(); sc.globalCompositeOperation = 'lighter';
    const gg = sc.createRadialGradient(ix, iy + 30, 140, ix, iy + 30, 620);
    gg.addColorStop(0, C(KAI.hot, Math.min(1, 0.38 * glow * boost))); gg.addColorStop(0.45, C(KAI.mid, 0.16 * glow * boost)); gg.addColorStop(1, C(KAI.deep, 0));
    sc.fillStyle = gg; sc.fillRect(-1300, -900, 2600, 1800);
    sc.restore();
    em.save();
    const eg = em.createRadialGradient(ix, iy + 30, 200, ix, iy + 30, 700);
    eg.addColorStop(0, C(KAI.mid, 0.12 * glow * boost)); eg.addColorStop(1, C(KAI.deep, 0));
    em.fillStyle = eg; em.fillRect(-1300, -900, 2600, 1800);
    em.restore();
  }
  // eyelid crease (double lid) + lid plane shading
  {
    // the lid surface: soft, darker toward the lash line (lash shadow) — no extra hard edges
    const lidShade = E2.cr.concat(E2.upS.slice().reverse());
    const lsg = sc.createLinearGradient(0, -400, 0, -200);
    lsg.addColorStop(0, C(ESKIN.shade, 0.0)); lsg.addColorStop(0.55, C(ESKIN.shade, 0.25)); lsg.addColorStop(1, C(ESKIN.deep, 0.45 + 0.3 * (1 - op)));
    sc.fillStyle = lsg; sc.fill(pathOf(lidShade));
    // double-lid crease: one tapered line that does not reach the corners
    const cr = E2.cr, nc = cr.length;
    const crSeg = cr.slice(Math.floor(nc * 0.1), Math.floor(nc * 0.93));
    const crP = ribbonPts(crSeg, (q) => 1 + 8 * Math.pow(Math.sin(Math.PI * q), 0.8) * (0.7 + 0.3 * q));
    sc.fillStyle = C(ESKIN.crease, 0.95); sc.fill(pathOf(crP));
  }
  // ---- eyeball (clipped to the aperture) ----
  let pr = lerp(0.36, 0.26, smoothstep(0, 0.7, glow));
  if (open > 0.03) {
    sc.save(); sc.clip(E2.aperture);
    const sg = sc.createLinearGradient(0, -300, 0, 320);
    sg.addColorStop(0, mixHex('#2c3266', '#223e76', glow * 0.7)); sg.addColorStop(0.32, mixHex('#5e669c', '#46689e', glow * 0.7));
    sg.addColorStop(0.75, mixHex('#7c82b6', '#5c8cc0', glow * 0.8)); sg.addColorStop(1, mixHex('#585e98', '#5486bc', glow * 0.85));
    sc.fillStyle = sg; sc.fillRect(-720, -420, 1440, 840);
    for (const cx of [-660, 690]) {
      const cg = sc.createRadialGradient(cx, 20, 0, cx, 20, 320);
      cg.addColorStop(0, 'rgba(60,50,120,0.6)'); cg.addColorStop(1, 'rgba(60,50,120,0)');
      sc.fillStyle = cg; sc.fillRect(cx - 340, -340, 680, 680);
    }
    if (glow > 0) {
      sc.save(); sc.globalCompositeOperation = 'lighter';
      const bg = sc.createRadialGradient(ix, iy, I.rx * 0.9, ix, iy, I.rx * 1.7);
      bg.addColorStop(0, C(KAI.mid, 0.22 * glow)); bg.addColorStop(1, C(KAI.mid, 0));
      sc.fillStyle = bg; sc.fillRect(-720, -420, 1440, 840); sc.restore();
    }
    const iw = ID.w / ID.k, ih = ID.h / ID.k;
    sc.drawImage(ID.c, ix - iw / 2, iy - ih / 2, iw, ih);
    // the ignition front is born at the pupil edge and runs outward
    const rr = lerp(pr, 1.18, glow);
    if (glow > 0.001) {
      const off = need(A, 'irisOff', () => makeCanvas(ID.w, ID.h)), og = off.getContext('2d');
      const maskDraw = (spr) => {
        og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'source-over'; og.clearRect(0, 0, off.width, off.height);
        og.drawImage(spr.c, 0, 0);
        og.globalCompositeOperation = 'destination-in';
        og.setTransform(ID.k, 0, 0, ID.k * I.ry / I.rx, off.width / 2, off.height / 2);
        const gr = og.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, rr * I.rx));
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(Math.max(0.01, 1 - 0.14 / Math.max(rr, 0.2)), 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        og.fillStyle = gr; og.fillRect(-I.rx * 1.3, -I.rx * 1.3, I.rx * 2.6, I.rx * 2.6);
        og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'source-over';
      };
      maskDraw(IL);
      sc.drawImage(off, ix - iw / 2, iy - ih / 2, iw, ih);
      maskDraw(IE);
      em.save(); em.clip(E2.aperture); em.globalAlpha = Math.min(1, 0.8 * (0.6 + 0.4 * glow) * boost); em.drawImage(off, ix - iw / 2, iy - ih / 2, iw, ih); em.restore();
    }
    // red limbal crescent on the right: Akane's light caught on the cornea's edge
    if (reflect > 0.01) {
      // crescent = iris disc minus the same disc shifted left (clipped to the iris so only the right sliver remains)
      const irisEl = new Path2D(); irisEl.ellipse(ix, iy, I.rx * 0.985, I.ry * 0.985, 0, 0, TAU);
      const cres = new Path2D(); cres.ellipse(ix, iy, I.rx * 0.985, I.ry * 0.985, 0, 0, TAU); cres.ellipse(ix - 20, iy - 8, I.rx * 0.975, I.ry * 0.99, 0, 0, TAU);
      for (const [ctx, a] of [[sc, 0.55], [em, 0.3]]) {
        ctx.save(); ctx.clip(E2.aperture); ctx.clip(irisEl);
        if (ctx === em) { em.globalCompositeOperation = 'destination-out'; em.fillStyle = `rgba(0,0,0,${0.85 * reflect})`; em.fill(cres, 'evenodd'); em.globalCompositeOperation = 'lighter'; }
        ctx.fillStyle = C(AKA.mid, a * reflect); ctx.fill(cres, 'evenodd'); ctx.restore();
      }
    }
    // pupil (contracts as it ignites)
    sc.fillStyle = '#03051a'; sc.beginPath(); sc.ellipse(ix, iy + 4, pr * I.rx, pr * I.ry * 1.02, 0, 0, TAU); sc.fill();
    sc.strokeStyle = C(KAI.dark, 0.9); sc.lineWidth = 3; sc.stroke();
    em.save(); em.globalCompositeOperation = 'source-over'; em.fillStyle = '#000';
    em.beginPath(); em.ellipse(ix, iy + 4, pr * I.rx * 0.97, pr * I.ry * 0.99, 0, 0, TAU); em.fill(); em.restore();
    if (glow > 0.02) {
      const ring = new Path2D(); ring.ellipse(ix, iy + 4, pr * I.rx * 1.06, pr * I.ry * 1.08, 0, 0, TAU);
      em.save(); em.clip(E2.aperture);
      em.strokeStyle = C(KAI.hot, 0.5 * glow); em.lineWidth = 5; em.stroke(ring);
      em.strokeStyle = C(KAI.core, 0.8 * glow); em.lineWidth = 2; em.stroke(ring);
      em.restore();
      sc.strokeStyle = C(KAI.core, 0.95 * glow); sc.lineWidth = 2.5; sc.stroke(ring);
    }
    // ignition front: jagged electric ring travelling outward
    if (glow > 0.01 && glow < 0.995) {
      const front = [];
      for (let i = 0; i <= 120; i++) {
        const a = i / 120 * TAU;
        const jag = 0.06 * noise2(Math.cos(a) * 2.2 + tb * 0.37, Math.sin(a) * 2.2) + 0.03 * (hash3(i, tb, 3) - 0.5);
        const r = rr * (1 + jag);
        front.push([ix + Math.cos(a) * r * I.rx, iy + Math.sin(a) * r * I.ry]);
      }
      em.save(); em.clip(E2.aperture); em.globalCompositeOperation = 'lighter'; em.lineJoin = 'miter';
      const fk = Math.sin(Math.PI * glow);
      em.strokeStyle = C(KAI.mid, 0.35 * fk); em.lineWidth = 16; strokePts(em, front);
      em.strokeStyle = C(KAI.hot, 0.6 * fk); em.lineWidth = 6; strokePts(em, front);
      em.strokeStyle = C(KAI.core, 0.95 * fk); em.lineWidth = 2.2; strokePts(em, front);
      em.restore();
      sc.save(); sc.clip(E2.aperture); sc.strokeStyle = C('#f2feff', 0.85 * fk); sc.lineWidth = 1.6; sc.lineJoin = 'miter'; strokePts(sc, front); sc.restore();
    }
    // lightning veins: bold tapered roots, mostly inside the iris
    if (glow > 0.05) {
      const nV = 10;
      sc.save(); sc.clip(E2.aperture); em.save(); em.clip(E2.aperture);
      for (let i = 0; i < nV; i++) {
        const a = (i + 0.5) / nV * TAU + (hash2(i, 4.4) - 0.5) * 0.45 + (hash3(i, tb, 1) - 0.5) * 0.12;
        const reach = lerp(0.78, 1.15, hash2(i, 7.7)) * Math.min(1, glow * 1.25);
        const rEnd = Math.min(rr, reach);
        if (rEnd < pr + 0.1) continue;
        const pA = [ix + Math.cos(a) * (pr + 0.03) * I.rx, iy + Math.sin(a) * (pr + 0.03) * I.ry];
        const da = (hash3(i, tb, 2) - 0.5) * 0.28;
        const pB = [ix + Math.cos(a + da) * rEnd * I.rx, iy + Math.sin(a + da) * rEnd * I.ry];
        const pts = boltPts(pA, pB, 400 + i * 31 + tb * 7, 0.2, 4);
        const aV = (0.6 + 0.4 * hash3(i, tb, 3)) * smoothstep(0.05, 0.4, glow) * Math.min(1.3, boost);
        zapT(em, sc, pts, 4, aV, { taper: 0.75, deepW: 3.2, hotW: 1.9 });
        if (hash2(i, 9.1) < 0.5) {
          const mid = pts[Math.floor(pts.length * 0.55)];
          const ba = a + (hash3(i, tb, 5) < 0.5 ? -0.6 : 0.6);
          const pC = [mid[0] + Math.cos(ba) * 64, mid[1] + Math.sin(ba) * 72];
          zapT(em, sc, boltPts(mid, pC, 900 + i * 17 + tb * 3, 0.24, 3), 2.2, aV * 0.8, { taper: 0.7, deepW: 3, hotW: 1.8 });
        }
      }
      sc.restore(); em.restore();
    }
    // upper lid cast shadow on the eyeball (hard edged, anime style)
    const shadowBand = (d0, d1) => E2.upS.map(([x, y]) => [x, y - 4]).concat(E2.upS.slice().reverse().map(([x, y], i, arr) => {
      const q = 1 - i / (arr.length - 1);
      return [x, y + d0 + d1 * Math.sin(Math.PI * q)];
    }));
    sc.fillStyle = 'rgba(16,18,70,0.42)'; sc.fill(pathOf(shadowBand(28, 78)));
    sc.fillStyle = 'rgba(8,9,40,0.45)'; sc.fill(pathOf(shadowBand(12, 26)));
    // crystal reflections: the barrage mirrored on the cornea, clustered lower right, curved with the cornea
    if (reflect > 0.01) {
      const shards = [];
      // [angle, radius (iris units), half-length px]: an arc hugging the lower-right limbus plus a few inner
      // ones, leaving the fill highlight (angle ~0.72, r ~0.59) clear
      const LAY = [[-0.3, 0.84, 38], [0.02, 0.77, 66], [0.3, 0.87, 44], [0.47, 0.71, 76], [1.0, 0.8, 54], [1.24, 0.66, 68], [1.5, 0.84, 36], [1.13, 0.44, 32], [0.18, 0.5, 38]];
      LAY.forEach(([a, r, sz], i) => shards.push({ a, r, sz, rot: (hash2(i, 8.1) - 0.5) * 0.7, i }));
      shards.sort((p, q) => p.sz - q.sz);
      for (const sh of shards) {
        const { a, r, sz, rot, i } = sh;
        const sk = smoothstep(i * 0.05, i * 0.05 + 0.5, reflect);
        if (sk <= 0) continue;
        const x = ix + Math.cos(a) * r * I.rx + Math.sin(t * 0.8 + i) * 3, y = iy + Math.sin(a) * r * I.ry + Math.cos(t * 0.7 + i * 2) * 3;
        const s = sz * (0.6 + 0.4 * sk) * (1 + 0.06 * t);
        // elongated bipyramid seen side-on; the cornea squeezes it along the radius (fake curvature)
        // crystal bipyramid: tip, right shoulder, bottom tip, left shoulder
        const PR = [0.4, -0.12], PB = [0.06, 0.92], PL = [-0.34, 0.16];
        const shape = (ctx, g = 1) => { ctx.beginPath(); ctx.moveTo(0, -s * g); ctx.lineTo(s * PR[0] * g, s * PR[1] * g); ctx.lineTo(s * PB[0] * g, s * PB[1] * g); ctx.lineTo(s * PL[0] * g, s * PL[1] * g); ctx.closePath(); };
        const xf = (ctx) => { ctx.translate(x, y); ctx.rotate(a); ctx.scale(1 - 0.3 * r * r, 1); ctx.rotate(rot * 1.6); };
        // knock the cyan emission out under the shard so it stays crimson (no pink wash)
        em.save(); xf(em); em.globalCompositeOperation = 'destination-out'; em.globalAlpha = 0.97 * sk; shape(em, 1.12); em.fillStyle = '#000'; em.fill(); em.restore();
        sc.save(); xf(sc); sc.globalAlpha = 0.97 * sk;
        shape(sc, 1.1); sc.fillStyle = C(LINE, 0.85); sc.fill();
        shape(sc);
        const bg2 = sc.createLinearGradient(-s * 0.3, -s, s * 0.2, s);
        bg2.addColorStop(0, '#9a0a28'); bg2.addColorStop(0.55, '#5c0018'); bg2.addColorStop(1, '#2a000c');
        sc.fillStyle = bg2; sc.fill();
        // lit facet: a narrow plane along the right shoulder, hot sliver at the top, inner refraction streak
        sc.fillStyle = C(AKA.body1); sc.beginPath(); sc.moveTo(0, -s); sc.lineTo(s * PR[0], s * PR[1]); sc.lineTo(s * PB[0], s * PB[1]); sc.lineTo(s * 0.12, s * 0.05); sc.closePath(); sc.fill();
        sc.fillStyle = C(AKA.mid); sc.beginPath(); sc.moveTo(0, -s); sc.lineTo(s * PR[0], s * PR[1]); sc.lineTo(s * 0.16, -s * 0.2); sc.closePath(); sc.fill();
        sc.fillStyle = C(AKA.hot, 0.9); sc.beginPath(); sc.moveTo(-s * 0.12, s * 0.1); sc.lineTo(-s * 0.06, -s * 0.12); sc.lineTo(-s * 0.01, s * 0.5); sc.closePath(); sc.fill();
        sc.strokeStyle = C(AKA.core); sc.lineWidth = 1.5; sc.lineJoin = 'miter';
        sc.beginPath(); sc.moveTo(s * PL[0], s * PL[1]); sc.lineTo(0, -s); sc.lineTo(s * PR[0], s * PR[1]); sc.stroke();
        sc.restore();
        em.save(); xf(em); em.globalAlpha = sk;
        shape(em); em.fillStyle = C(AKA.deep, 0.35); em.fill();
        em.strokeStyle = C(AKA.hot, 0.8); em.lineWidth = 2; em.beginPath(); em.moveTo(s * PL[0], s * PL[1]); em.lineTo(0, -s); em.lineTo(s * PR[0], s * PR[1]); em.stroke();
        em.restore();
        if (hash2(i, 3) < 0.5) drawStar(em, A, x + s * 0.1, y - s * 0.55, s * 2.2, sk * (0.35 + 0.65 * Math.max(0, Math.sin(t * 7 + i * 2))), 0.3, need(A, 'starThin', (k) => buildStar(k, 0.5)));
      }
    }
    // specular highlights (key window + small fill + pin)
    sc.fillStyle = '#ffffff';
    sc.save(); sc.translate(ix - 0.4 * I.rx, iy - 0.36 * I.ry); sc.rotate(-0.45);
    sc.beginPath(); sc.ellipse(0, 0, 78, 52, 0, 0, TAU); sc.fill(); sc.restore();
    sc.beginPath(); sc.ellipse(ix + 0.47 * I.rx, iy + 0.36 * I.ry, 22, 18, 0.3, 0, TAU); sc.fill();
    sc.beginPath(); sc.arc(ix + 0.16 * I.rx, iy - 0.56 * I.ry, 10, 0, TAU); sc.fill();
    em.save(); em.clip(E2.aperture);
    { const nl = new Path2D(); nl.rect(-3000, -3000, 6000, 6000); nl.addPath(LG.lp); em.clip(nl, 'evenodd'); }
    em.fillStyle = 'rgba(255,255,255,0.18)';
    em.translate(ix - 0.4 * I.rx, iy - 0.36 * I.ry); em.rotate(-0.45); em.beginPath(); em.ellipse(0, 0, 78, 52, 0, 0, TAU); em.fill(); em.restore();
    sc.restore();
  }
  // ---- lower lid (fades into the closed lash line when the eye is shut) ----
  {
    const lo = E2.loS, n = lo.length;
    sc.save(); sc.globalAlpha = smoothstep(0.08, 0.45, open);
    const seg = lo.slice(Math.floor(n * 0.3));
    // hard-edged cyan pool on the lower lid (light from the iris), under the lash line
    if (glow > 0) {
      const pool = ribbonPts(lo.slice(Math.floor(n * 0.12), Math.floor(n * 0.92)).map(([x, y]) => [x, y + 26]), (q) => 44 * Math.sin(Math.PI * q));
      sc.save(); sc.globalCompositeOperation = 'lighter'; sc.fillStyle = C(KAI.hot, 0.32 * glow * Math.min(1.3, boost)); sc.fill(pathOf(pool)); sc.restore();
      em.save(); em.fillStyle = C(KAI.mid, 0.2 * glow); em.fill(pathOf(pool)); em.restore();
    }
    const rp = ribbonPts(seg.map(([x, y]) => [x, y + 3]), (q) => 2 + 10 * Math.sin(Math.PI * Math.min(1, q * 1.08)) * (0.45 + 0.55 * q));
    sc.fillStyle = C(ESKIN.line, 0.95); sc.fill(pathOf(rp));
    sc.strokeStyle = C(ESKIN.crease, 0.8); sc.lineWidth = 3; sc.lineCap = 'round'; strokePts(sc, lo.slice(Math.floor(n * 0.06), Math.floor(n * 0.3)));
    sc.strokeStyle = glow > 0 ? mixHex('#c4bedc', KAI.hot, glow, 0.8) : 'rgba(196,190,220,0.6)'; sc.lineWidth = 3;
    strokePts(sc, lo.slice(Math.floor(n * 0.15), Math.floor(n * 0.85)).map(([x, y]) => [x, y + 14]));
    if (glow > 0) {
      em.save(); em.lineCap = 'round';
      em.strokeStyle = C(KAI.hot, 0.3 * glow); em.lineWidth = 5; strokePts(em, seg.map(([x, y]) => [x, y + 10]));
      em.restore();
    }
    sc.restore();
  }
  // inner corner (caruncle)
  sc.fillStyle = C([150, 104, 150], 0.95);
  sc.beginPath(); sc.ellipse(EYE.IC[0] + 44, EYE.IC[1] + 4, 36, 24 * Math.max(0.3, op), 0.35, 0, TAU); sc.fill();
  sc.fillStyle = 'rgba(220,220,245,0.7)'; sc.beginPath(); sc.ellipse(EYE.IC[0] + 36, EYE.IC[1] - 4, 9, 5, 0.3, 0, TAU); sc.fill();
  // ---- upper lash line (thick, with a sharp outer wing and flicks) ----
  {
    const up = E2.upS, n = up.length, { lp, lifted, wf } = LG;
    sc.fillStyle = C(LINE); sc.fill(lp);
    sc.save(); sc.clip(lp);
    sc.strokeStyle = 'rgba(52,70,160,0.7)'; sc.lineWidth = 5; strokePts(sc, up.slice(Math.floor(n * 0.25)).map(([x, y]) => [x, y - 5]));
    // the underside of the lashes catches the iris light (hard-edged cyan band)
    if (glow > 0 && open > 0.3) {
      sc.fillStyle = C(KAI.hot, 0.55 * glow); sc.fill(pathOf(ribbonPts(up.slice(Math.floor(n * 0.22), Math.floor(n * 0.9)).map(([x, y]) => [x, y + 4]), (q) => 9 * Math.sin(Math.PI * q))));
    }
    sc.restore();
    const flick = (i0, len, ang, w, bend = 0.25) => {
      const p = lifted[Math.min(n - 1, i0)];
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const nx = -dy, ny = dx;
      sc.beginPath(); sc.moveTo(p[0] - nx * w, p[1] - ny * w);
      sc.quadraticCurveTo(p[0] + dx * len * 0.55 - nx * w * 0.3 + nx * len * bend, p[1] + dy * len * 0.55 - ny * w * 0.3 + ny * len * bend, p[0] + dx * len, p[1] + dy * len);
      sc.quadraticCurveTo(p[0] + dx * len * 0.5 + nx * w * 0.4 + nx * len * bend * 0.6, p[1] + dy * len * 0.5 + ny * w * 0.4 + ny * len * bend * 0.6, p[0] + nx * w, p[1] + ny * w);
      sc.closePath(); sc.fill();
    };
    sc.fillStyle = C(LINE);
    const lift = lerp(1.25, 0, op);
    flick(n - 2, 130, 0.12 + lift * 0.5, 15, 0.12);
    flick(n - 6, 140, -0.3 + lift * 0.7, 14, 0.15);
    flick(n - 12, 118, -0.68 + lift * 1.0, 12, 0.18);
    flick(n - 19, 86, -0.98 + lift * 1.2, 10, 0.2);
    flick(n - 27, 58, -1.2 + lift * 1.35, 8, 0.2);
    if (glow > 0) {
      em.save();
      em.strokeStyle = C(KAI.hot, 0.25 * glow); em.lineWidth = 4; strokePts(em, up.slice(Math.floor(n * 0.3)).map(([x, y]) => [x, y + 5]));
      em.restore();
    }
  }
  // glowing eye-light trail (tapered comet head under the lash wing) + small arcs at the outer corner
  if (glow > 0.35) {
    const gk = smoothstep(0.35, 1, glow) * Math.min(1.4, boost);
    const ox = EYE.OC[0] - 30, oy = EYE.OC[1] + 26;
    const trail = [];
    for (let i = 0; i <= 40; i++) { const q = i / 40; trail.push([ox + q * 760, oy - q * 300 - Math.sin(q * 3 + t * 2.2) * 30 * q]); }
    const wf = (W) => (q) => W * Math.sin(Math.PI / 2 * Math.min(1, q * 5)) * Math.pow(1 - q, 1.6) * gk;
    em.save();
    em.fillStyle = C(KAI.deep, 0.35); em.fill(pathOf(ribbonPts(trail, wf(110))));
    em.fillStyle = C(KAI.mid, 0.5); em.fill(pathOf(ribbonPts(trail, wf(52))));
    em.fillStyle = C(KAI.core, 0.9); em.fill(pathOf(ribbonPts(trail, wf(14))));
    em.restore();
    sc.save(); sc.globalCompositeOperation = 'lighter'; sc.fillStyle = C(KAI.hot, 0.35); sc.fill(pathOf(ribbonPts(trail, wf(30)))); sc.restore();
    for (let i = 0; i < 3; i++) {
      const tb12 = Math.floor(t * 12 + 0.5);
      if (hash3(i, tb12, 1) > 0.6) continue;
      const a = [ox + 30 + hash3(i, tb12, 2) * 80, oy - 40 + hash3(i, tb12, 3) * 90];
      const b2 = [a[0] + 110 + hash3(i, tb12, 4) * 180, a[1] - 90 + hash3(i, tb12, 5) * 150];
      zapT(em, sc, boltPts(a, b2, 77 + i + tb12 * 13, 0.2, 4), 3, 0.8 * gk, { taper: 0.8 });
    }
  }
  sc.restore(); em.restore();
  // the pupil stays a black hole after bloom: re-stamp it (and the crisp highlights) post-tonemap
  if (open > 0.03) {
    ui.save(); base(S, ui, cam); ui.translate(EYE.cx, EYE.cy); ui.rotate(EYE.rot); ui.clip(E2.aperture);
    // never over the lash line (matters while the lid is half open)
    const notLash = new Path2D(); notLash.rect(-3000, -3000, 6000, 6000); notLash.addPath(LG.lp); ui.clip(notLash, 'evenodd');
    ui.fillStyle = 'rgba(4,6,26,0.8)'; ui.beginPath(); ui.ellipse(ix, iy + 4, pr * I.rx * 0.95, pr * I.ry * 0.97, 0, 0, TAU); ui.fill();
    ui.fillStyle = '#ffffff';
    ui.beginPath(); ui.arc(ix + 0.16 * I.rx, iy - 0.56 * I.ry, 9, 0, TAU); ui.fill();
    ui.save(); ui.translate(ix - 0.4 * I.rx, iy - 0.36 * I.ry); ui.rotate(-0.45); ui.globalAlpha = 0.85; ui.beginPath(); ui.ellipse(0, 0, 74, 48, 0, 0, TAU); ui.fill(); ui.restore();
    ui.restore();
  }
  drawEyeHair(S, sc, em, t, glow, cam, { E2, LG, ix, iy, I, glow, reflect });
}

// anime hair clump: S-curved spine, belly then a long sharp taper, optional forked secondary tip,
// two-tone fill with a crisp highlight streak
function clumpOutline(x, y, ang, L, W, s1, s2) {
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  const spine = [];
  for (let i = 0; i <= 24; i++) {
    const q = i / 24, off = (s1 * Math.sin(Math.PI * q) + s2 * Math.sin(2 * Math.PI * q)) * L;
    spine.push([x + dx * L * q + nx * off, y + dy * L * q + ny * off]);
  }
  const wf = (q) => W * Math.pow(1 - q, 0.72) * (0.8 + 0.35 * Math.sin(Math.PI * Math.min(1, q * 1.6)));
  return { spine, rp: ribbonPts(spine, wf), wf };
}
function clumpPath(x, y, ang, L, W, s1, s2, fork, seed) {
  const main = clumpOutline(x, y, ang, L, W, s1, s2);
  const pa = new Path2D(); pa.addPath(pathOf(main.rp));
  if (fork > 0) {
    const i0 = Math.floor(main.spine.length * fork), p = main.spine[i0];
    pa.addPath(pathOf(clumpOutline(p[0], p[1], ang + (seed % 2 ? 0.28 : -0.28), L * (1 - fork) * 0.85, main.wf(fork) * 0.62, -s1 * 0.6, 0).rp));
  }
  return pa;
}
function hairClump2(sc, em, x, y, ang, L, W, s1, s2, fork, glow, seed, redRim = 0, sheen = null) {
  const main = clumpOutline(x, y, ang, L, W, s1, s2);
  const shapes = [main];
  if (fork > 0) {
    const i0 = Math.floor(main.spine.length * fork), p = main.spine[i0];
    shapes.push(clumpOutline(p[0], p[1], ang + (seed % 2 ? 0.28 : -0.28), L * (1 - fork) * 0.85, main.wf(fork) * 0.62, -s1 * 0.6, 0));
  }
  const pa = new Path2D();
  shapes.forEach((s) => pa.addPath(pathOf(s.rp)));
  sc.save();
  sc.fillStyle = '#141734'; sc.fill(pa, 'nonzero');
  sc.save(); sc.clip(pa, 'nonzero');
  for (const s of shapes) {
    const sh = ribbonPts(s.spine.map(([px, py]) => [px + Math.cos(ang + Math.PI / 2) * -s.wf(0) * 0.28, py + Math.sin(ang + Math.PI / 2) * -s.wf(0) * 0.28]), (q) => s.wf(q) * 0.75);
    sc.fillStyle = 'rgba(5,6,18,0.92)'; sc.fill(pathOf(sh));
  }
  const sp = main.spine, n = sp.length;
  // sheen: by default 12-42% along the spine; with `sheen = [y0, y1]` it sits at a fixed screen height so the
  // highlights of neighbouring clumps line up into one jagged "angel ring" band
  let i0 = Math.floor(n * 0.12), i1 = Math.floor(n * 0.42);
  if (sheen) { i0 = sp.findIndex((p) => p[1] >= sheen[0]); i1 = sp.findIndex((p) => p[1] >= sheen[1]); if (i0 < 0) i0 = n; if (i1 < 0) i1 = n - 1; }
  if (i1 - i0 >= 3) {
    const off = (k) => ([px, py]) => [px + Math.cos(ang + Math.PI / 2) * W * k, py + Math.sin(ang + Math.PI / 2) * W * k];
    const seg = sp.slice(i0, i1).map(off(0.14));
    sc.fillStyle = 'rgba(86,104,200,0.9)'; sc.fill(pathOf(ribbonPts(seg, (q) => main.wf(lerp(i0, i1, q) / (n - 1)) * 0.36 * Math.sin(Math.PI * q))));
    const j0 = i0 + Math.floor((i1 - i0) * 0.2), j1 = i0 + Math.floor((i1 - i0) * 0.7);
    if (j1 - j0 >= 2) { sc.fillStyle = 'rgba(190,206,255,0.9)'; sc.fill(pathOf(ribbonPts(sp.slice(j0, j1).map(off(0.2)), (q) => main.wf(lerp(j0, j1, q) / (n - 1)) * 0.1 * Math.sin(Math.PI * q)))); }
  }
  if (redRim > 0) rimCrescent(sc, pa, 10, 2, [255, 40, 90], 0.75 * redRim);
  sc.restore();
  sc.strokeStyle = LINE; sc.lineWidth = 2.6; sc.lineJoin = 'round';
  shapes.forEach((s) => sc.stroke(pathOf(s.rp)));
  sc.restore();
  if (glow > 0 && em) {
    em.strokeStyle = C(KAI.hot, 0.28 * glow); em.lineWidth = 2.5; em.lineCap = 'round';
    strokePts(em, main.rp.slice(main.spine.length));
  }
  return pa;
}

function drawEyeHair(S, sc, em, t, glow, cam, see) {
  const A = assets(S);
  sc.save(); em.save();
  const hcam = { zoom: cam.zoom * 1.02, x: cam.x * 1.6, y: cam.y * 1.6, rot: cam.rot };
  base(S, sc, hcam); base(S, em, hcam);
  em.globalCompositeOperation = 'lighter';
  // heavy bangs over the brow: big black clumps hanging from above the frame, sharp tips at varied heights,
  // one aligned sheen band across them; red rim on the right (Akane's side)
  const bangs = [
    { x: -160, y: -240, ang: 1.2, L: 700, W: 260, s1: 0.06, s2: -0.02, fork: 0.55 },
    { x: 150, y: -250, ang: 1.4, L: 560, W: 240, s1: -0.05, s2: 0.02, fork: 0 },
    { x: 430, y: -230, ang: 1.5, L: 470, W: 220, s1: 0.06, s2: 0, fork: 0.6 },
    { x: 720, y: -250, ang: 1.64, L: 430, W: 200, s1: -0.06, s2: 0.02, fork: 0 },
    { x: 980, y: -230, ang: 1.52, L: 520, W: 240, s1: 0.05, s2: -0.03, fork: 0.5 },
    { x: 1320, y: -250, ang: 1.36, L: 500, W: 220, s1: -0.04, s2: 0.02, fork: 0, red: 0.3 },
    { x: 1630, y: -230, ang: 1.45, L: 600, W: 250, s1: 0.06, s2: 0, fork: 0.55, red: 0.7 },
    { x: 1960, y: -240, ang: 1.62, L: 660, W: 280, s1: -0.05, s2: 0.02, fork: 0, red: 1 },
  ];
  const clumps = [
    { x: 1270, y: -150, ang: 1.17, L: 800, W: 140, s1: 0.08, s2: -0.04, fork: 0, see: true },
    { x: 1720, y: -150, ang: 1.38, L: 1000, W: 200, s1: -0.05, s2: 0.03, fork: 0.55, red: 1 },
    { x: 1540, y: -170, ang: 1.3, L: 520, W: 130, s1: 0.07, s2: 0.0, fork: 0, red: 0.6 },
    { x: 60, y: -150, ang: 1.36, L: 640, W: 190, s1: 0.07, s2: -0.03, fork: 0.5 },
    { x: 330, y: -160, ang: 1.12, L: 420, W: 130, s1: -0.08, s2: 0.03, fork: 0 },
  ];
  // hard-edged hair shadows cast down-right onto skin, lid and eyeball (drawn under the hair)
  {
    const sh = new Path2D();
    bangs.forEach((c, i) => sh.addPath(clumpPath(c.x, c.y, c.ang + Math.sin(t * 1.1 + i * 2.3) * 0.012, c.L, c.W, c.s1, c.s2, c.fork, 10 + i)));
    clumps.forEach((c, i) => sh.addPath(clumpPath(c.x, c.y, c.ang + Math.sin(t * 1.3 + i * 1.9) * 0.02, c.L, c.W, c.s1, c.s2, c.fork, i)));
    sc.save(); sc.translate(24, 62); sc.fillStyle = C(ESKIN.deep, 0.5); sc.fill(sh, 'nonzero'); sc.restore();
  }
  bangs.forEach((c, i) => {
    const sw = Math.sin(t * 1.1 + i * 2.3) * 0.012;
    hairClump2(sc, em, c.x, c.y, c.ang + sw, c.L, c.W, c.s1, c.s2, c.fork, 0, 10 + i, c.red || 0, [-40, 40]);
  });
  // fringe clumps falling from the forehead (S-curved, forked tips). The one crossing the eye is opaque;
  // the lash line and limbus are re-drawn over it at 60% (anime see-through convention).
  clumps.forEach((c, i) => {
    const sw = Math.sin(t * 1.3 + i * 1.9) * 0.02;
    const pa = hairClump2(sc, em, c.x, c.y, c.ang + sw, c.L, c.W, c.s1, c.s2, c.fork, glow, i, c.red || 0);
    if (c.see && see) {
      sc.save(); sc.clip(pa);
      // switch to the eye's own transform (the clip stays in device space)
      base(S, sc, cam); sc.translate(EYE.cx, EYE.cy); sc.rotate(EYE.rot);
      sc.globalAlpha = 0.6;
      sc.fillStyle = '#05061a'; sc.fill(see.LG.lp);
      if (see.glow > 0) { sc.strokeStyle = C(KAI.hot, 0.9 * see.glow); sc.lineWidth = 3; sc.stroke(see.LG.lp); }
      const lim = new Path2D(); lim.ellipse(see.ix, see.iy, see.I.rx, see.I.ry, 0, 0, TAU);
      sc.save(); sc.clip(see.E2.aperture); sc.strokeStyle = see.glow > 0.3 ? C(KAI.hot) : '#2a3c90'; sc.lineWidth = 6; sc.stroke(lim); sc.restore();
      sc.restore();
    }
  });
  sc.restore(); em.restore();
  // big out-of-focus foreground strands (blurred)
  const off = need(A, 'hairOff', (k) => makeCanvas(Math.ceil(RW * k / 3), Math.ceil(RH * k / 3)));
  const g = off.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, off.width, off.height);
  const kk = off.width / RW;
  g.setTransform(kk, 0, 0, kk, 0, 0);
  const fg = [
    { p: [[-80, 400], [180, 600], [400, 900], [540, 1180]], w: 160 },
    { p: [[1720, -120], [1830, 240], [1910, 600], [2010, 900]], w: 180 },
  ];
  fg.forEach((s, i) => {
    const pts = s.p.map(([x, y], j) => [x + Math.sin(t * 1.1 + i * 2 + j) * 14 + cam.x * 3, y + cam.y * 3]);
    const line = crSample(pts, 8);
    g.fillStyle = 'rgba(5,6,16,0.95)'; g.fill(pathOf(ribbonPts(line, (q) => s.w * (1 - q * 0.7))));
    g.fillStyle = i ? 'rgba(150,30,70,0.35)' : 'rgba(46,64,150,0.35)'; g.fill(pathOf(ribbonPts(line.map(([x, y]) => [x + (i ? s.w * 0.15 : -s.w * 0.15), y]), (q) => s.w * 0.25 * (1 - q))));
  });
  sc.save();
  S.cam.toScreen(sc);
  const k = S.W / RW; sc.scale(k, k);
  sc.filter = `blur(${Math.max(1, 9 * S.W / 1920)}px)`;
  sc.drawImage(off, 0, 0, RW, RH);
  sc.filter = 'none';
  sc.restore();
}

// optional grade helper for the director: recommended env/post for the close-ups
export function closeupGrade(S, kind = 'hilt') {
  S.env.cloudOn = 0; S.env.nebula = 0; S.env.stars = 0; S.env.galaxy = 0; S.env.planet = 0;
  const p = S.post;
  if (kind === 'eye') { p.vignette = 0.6; p.bloomStr = 1.0; p.ca = 0.002; }
  else if (kind === 'sheath') { p.vignette = 0.55; p.bloomStr = 0.95; }
  else { p.vignette = 0.5; p.bloomStr = 1.0; p.ca = 0.002; }
}
