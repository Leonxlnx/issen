// Builder D — collision bursts and manga impact frames (shot 6).
// drawImpactFrame paints a full-frame black / white / red graphic plate and, by default, slides it UNDER whatever is
// already in S.L.scene (destination-over), so characters drawn before it (silhouette=1) stay on top. It switches the
// compositor to posterised impact mode 1: dark -> black (impactA), mid -> red (impactC), bright -> white (impactB).
// The plate red (INK.red) is a real red whose luminance sits in the mode-1 red band, so the plate also reads in raw mode.
import { RNG, TAU, clamp, lerp, rgba, noise2, smoothstep, hash2, E } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';
import { boilStep, boltTree, fillTaper, pal, glowDot, starGlint, sparkSpindle, sparkPoint } from './lightning.js';

// ---------------------------------------------------------------------------------------------
// drawEnergyBurst — contact / collision flash (ref2-ref4 centre): central star flare, dense radial streaks,
// broken prismatic orbit rings (ref6) and flying sparkles. Additive, into S.L.emit.
// o: { x, y (screen px) | world:{x,y,z} (+ rM radius in metres), t=S.t, t0 (burst time), dur=0.9, r=S.H*0.45 (px),
//      color='blue', colorB=null (second palette for a two-colour clash, e.g. 'red'), splitAngle=0 (colorB is on the
//      side this direction points to), squash=1 (streak ellipse y-scale), ringSquash=0.4 (orbit-ring y-scale),
//      ringRot=-0.12, k=1, seed=29, rings=2, streaks=1, sparkles=1, prism=1 (rainbow fringe on the outer ring),
//      ctx=S.L.emit }
// ---------------------------------------------------------------------------------------------
export function drawEnergyBurst(S, o) {
  if (globalThis.__D_OFF?.burst) return;
  const t = o.t ?? S.t, age = t - (o.t0 ?? 0);
  const dur = o.dur ?? 0.9;
  if (age < 0 || age > dur) return;
  let x = o.x, y = o.y, r = o.r ?? S.H * 0.45;
  if (o.world) {
    const p = S.cam.project(o.world.x, o.world.y, o.world.z ?? 0);
    if (!p) return;
    x = p.x; y = p.y; if (o.rM != null) r = o.rM * p.s;
  }
  const px = S.H / 1080;
  const ctx = o.ctx || S.L.emit;
  const PA = pal(o.color), PB = o.colorB ? pal(o.colorB) : null;
  const sa = o.splitAngle ?? 0;
  const pick = (th) => (PB && Math.cos(th - sa) > 0 ? PB : PA);
  const a = age / dur, k = o.k ?? 1, sq = o.squash ?? 1;
  const seed = o.seed ?? 29, step = boilStep(t);
  const P2 = (th, R) => ({ x: x + Math.cos(th) * R, y: y + Math.sin(th) * R * sq });
  ctx.save();
  S.cam.toScreen(ctx);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  // central flash
  const fl = k * smoothstep(0, 0.025, age) * Math.exp(-age / (dur * 0.16));
  if (fl > 0.01) {
    glowDot(ctx, x, y, r * 0.5, PA.mid, 0.4 * fl, sq);
    if (PB) glowDot(ctx, x, y, r * 0.42, PB.mid, 0.3 * fl, sq);
    glowDot(ctx, x, y, r * 0.08, PA.core, fl, sq);
    starGlint(ctx, x, y, r * 0.7 * (0.6 + 0.4 * fl), PA, fl, 0.12);
    starGlint(ctx, x, y, r * 0.35, PB || PA, fl * 0.8, 0.12 + Math.PI / 4);
  }
  // anchored starburst rays (first frames): thin wedges from the centre, shooting out and fading fast
  const nra = Math.round(110 * (o.streaks ?? 1));
  const rr = new RNG(seed * 7 + 3);
  const ra = k * Math.pow(clamp(1 - a * 2.2), 1.5);
  if (ra > 0.01) {
    for (let i = 0; i < nra; i++) {
      const th = (i + rr.next()) / nra * TAU, L = r * lerp(0.25, 1.15, rr.next() ** 1.3) * E.outQuart(clamp(a * 4 + 0.15));
      const w = lerp(0.6, 4.5, rr.next() ** 2.2) * px, al = ra * lerp(0.35, 1, rr.next());
      const P = pick(th);
      const b0 = P2(th, r * 0.05), e1 = P2(th, L);
      const nx = -Math.sin(th) * w, ny = Math.cos(th) * w * sq;
      for (const [wm, col, am] of [[2, P.mid, 0.45], [1, P.hot, 0.75], [0.35, P.core, 1]]) {
        ctx.fillStyle = rgba(col, clamp(al * am, 0, 1));
        ctx.beginPath(); ctx.moveTo(b0.x + nx * wm, b0.y + ny * wm); ctx.lineTo(e1.x, e1.y); ctx.lineTo(b0.x - nx * wm, b0.y - ny * wm); ctx.closePath(); ctx.fill();
      }
    }
  }
  // radial streaks (spindles flying outward)
  const ns = Math.round(220 * (o.streaks ?? 1));
  const rng = new RNG(seed);
  for (let i = 0; i < ns; i++) {
    const th = rng.next() * TAU, spd = lerp(0.35, 1.3, rng.next()), len = lerp(0.06, 0.4, rng.next() ** 1.5) * r;
    const w = lerp(0.6, 3.4, rng.next() ** 2.5) * px, ph = rng.next() * 0.25;
    const aa = clamp((a - ph * 0.3) / (1 - ph * 0.3));
    if (aa <= 0) continue;
    const head = r * (0.05 + spd * E.outCubic(Math.min(1, aa * 1.3)));
    const tail = Math.max(r * 0.02, head - len * (1 - aa * 0.6));
    const al = k * Math.pow(1 - aa, 1.4) * (0.6 + 0.4 * hash2(i, step));
    if (al < 0.01) continue;
    const P = pick(th);
    const h = P2(th, head), tl = P2(th, tail), m = P2(th, lerp(tail, head, 0.7));
    const nx = -Math.sin(th) * w, ny = Math.cos(th) * w * sq;
    for (const [wm, col, am] of [[2.2, P.mid, 0.4], [1, P.hot, 0.8], [0.4, P.core, 1]]) {
      ctx.fillStyle = rgba(col, clamp(al * am, 0, 1));
      ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(m.x + nx * wm, m.y + ny * wm); ctx.lineTo(h.x, h.y); ctx.lineTo(m.x - nx * wm, m.y - ny * wm); ctx.closePath(); ctx.fill();
    }
  }
  // broken orbit rings: 3-5 tapered arc segments each, perspective squash, prism fringe on the outer ring
  const nr = Math.round(o.rings ?? 2);
  const prism = o.prism ?? 1;
  const rsq = o.ringSquash ?? 0.4, rrot = o.ringRot ?? -0.12;
  const cR = Math.cos(rrot), sR = Math.sin(rrot);
  const ringPt = (th, R) => { const lx = Math.cos(th) * R, ly = Math.sin(th) * R * rsq; return [x + lx * cR - ly * sR, y + lx * sR + ly * cR]; };
  for (let i = 0; i < nr; i++) {
    const d0 = i * 0.07;
    const aa = clamp((a - d0) / (1 - d0));
    if (aa <= 0) continue;
    const R = r * (0.15 + E.outQuart(aa) * (0.62 + i * 0.5));
    const al = k * Math.pow(1 - aa, 1.4) * (0.95 - i * 0.15);
    if (al < 0.01) continue;
    const wmax = lerp(12, 3, aa) * (1 - i * 0.2) * px;
    const rg = new RNG(seed * 17 + i * 101);
    const nseg = 3 + Math.floor(rg.next() * 3);
    const gaps = [], lens = [];
    let gsum = 0;
    for (let s = 0; s < nseg; s++) { const g = rg.range(0.3, 0.8); gaps.push(g); gsum += g; lens.push(rg.range(0.6, 1.4)); }
    const lsum = lens.reduce((p, v) => p + v, 0);
    let th0 = rg.next() * TAU + age * (i % 2 ? -0.5 : 0.6);
    const outer = i === nr - 1;
    for (let s = 0; s < nseg; s++) {
      const len = lens[s] / lsum * (TAU - gsum);
      const M = Math.max(12, Math.round(len * R / (8 * px)));
      const ring = (Roff, col, am, wm) => {
        const pts = [];
        for (let j = 0; j <= M; j++) { const [qx, qy] = ringPt(th0 + len * j / M, R + Roff); pts.push(qx, qy); }
        ctx.fillStyle = rgba(col, clamp(al * am, 0, 1));
        fillTaper(ctx, pts, (u) => Math.max(0.4, wmax * wm * Math.pow(Math.sin(Math.PI * u), 0.7)));
      };
      const P = pick(th0 + len * 0.5);
      ring(0, PB ? [170, 110, 255] : P.mid, 0.4, 2.6);
      if (outer && prism > 0) {
        const off = wmax * 1.4 + R * 0.01;
        ring(off, [255, 70, 120], 0.5 * prism, 0.45);
        ring(off * 0.4, [255, 220, 110], 0.35 * prism, 0.4);
        ring(-off * 0.4, [90, 255, 190], 0.4 * prism, 0.4);
        ring(-off, [90, 140, 255], 0.5 * prism, 0.45);
      }
      ring(0, P.hot, 0.75, 1);
      ring(0, P.core, 0.95, 0.4);
      th0 += len + gaps[s];
    }
  }
  // flying sparkles
  const nk = Math.round(80 * (o.sparkles ?? 1));
  const rk = new RNG(seed * 3 + 1);
  for (let i = 0; i < nk; i++) {
    const th = rk.next() * TAU, spd = lerp(0.2, 1.1, rk.next()), life = lerp(0.4, 1, rk.next()), w = lerp(0.8, 2.2, rk.next() ** 2) * px, tw = rk.next(), pointy = rk.next() < 0.35;
    const aa = a / life;
    if (aa >= 1) continue;
    const Rf = (q) => r * (0.04 + spd * (1 - Math.exp(-Math.max(0, q) * 3)) / (1 - Math.exp(-3)));
    const al = k * Math.pow(1 - aa, 1.2);
    const P = pick(th);
    if (pointy) { const p = P2(th, Rf(aa)); sparkPoint(ctx, p.x, p.y, w * 0.8, P, al); continue; }
    const tr = [];
    for (let q = 0; q <= 3; q++) { const p = P2(th, Rf(aa - 0.06 * (1 - q / 3))); tr.push(p.x, p.y); }
    sparkSpindle(ctx, tr, w, P, al);
    if (tw < 0.12) { const p = P2(th, Rf(aa)); starGlint(ctx, p.x, p.y, w * 7, P, al * (0.6 + 0.4 * hash2(i, step))); }
  }
  ctx.restore();
}

// plate tones (pre-posterisation). red: a true red whose display luminance (~0.46) lands in the impactMode-1 red band.
export const INK = { black: [0, 0, 0], red: [240, 64, 80], white: [255, 255, 255] };
// per-variant silhouette / rim colours (call before drawing the characters)
const STYLE = [
  { silColor: [0, 0, 0], rimColor: [255, 255, 255] },
  { silColor: [255, 255, 255], rimColor: [0, 0, 0] },
  { silColor: [0, 0, 0], rimColor: [255, 255, 255] },
  { silColor: [0, 0, 0], rimColor: [255, 255, 255] },
];
export const impactStyle = (variant = 0) => ({ ...STYLE[((variant % 4) + 4) % 4], variant: ((variant % 4) + 4) % 4 });

let _plate = null, _over = null, _out = null;
function plateCtx(c, W, H) {
  if (!c || c.width !== W || c.height !== H) c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
  g.clearRect(0, 0, W, H);
  return [c, g];
}

// ---- drawing primitives for the plates ----
// screentone dots (rotated grid), radius ramps with distance from (cx,cy) inside the ring [rA, rA+band]
function screentone(g, cx, cy, rA, band, pitch, rMin, rMax, col, invert = false) {
  g.fillStyle = rgba(col);
  g.beginPath();
  const R = rA + band, c = Math.SQRT1_2;
  for (let i = -R / pitch - 1; i <= R / pitch + 1; i++) {
    for (let j = -R / pitch - 1; j <= R / pitch + 1; j++) {
      const lx = i * pitch, ly = j * pitch;
      const x = lx * c - ly * c, y = lx * c + ly * c;
      const d = Math.hypot(x, y);
      if (d < rA || d > R) continue;
      let f = (d - rA) / band;
      if (invert) f = 1 - f;
      const rad = lerp(rMin, rMax, f);
      if (rad < 0.2) continue;
      g.moveTo(cx + x + rad, cy + y);
      g.arc(cx + x, cy + y, rad, 0, TAU);
    }
  }
  g.fill();
}
// manga starburst: 9-13 spikes, 2-3 dominant ones along `angle` (r1 x1.6-2.2), the rest r1 x0.4-0.9. Returns spike list.
function starburst(g, rng, cx, cy, r0, r1, angle, n = 0, domR = [1.6, 2.2]) {
  n = n || 9 + Math.floor(rng.next() * 5);
  const rot = angle + (rng.next() - 0.5) * 0.3;
  const th = [], rs = [];
  for (let i = 0; i < n; i++) { th.push(rot + (i + (rng.next() - 0.5) * 0.45) / n * TAU); rs.push(r1 * rng.range(0.4, 0.9)); }
  const nd = 2 + (rng.next() < 0.5 ? 1 : 0);
  const want = [angle, angle + Math.PI, angle + Math.PI * (0.55 + rng.next() * 0.3)].slice(0, nd);
  const dom = [];
  for (const w of want) {
    let best = 0, bd = 9;
    for (let i = 0; i < n; i++) { const d = Math.abs(Math.atan2(Math.sin(th[i] - w), Math.cos(th[i] - w))); if (d < bd && !dom.includes(i)) { bd = d; best = i; } }
    dom.push(best); th[best] = w + (rng.next() - 0.5) * 0.12; rs[best] = r1 * rng.range(domR[0], domR[1]);
  }
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = th[i], an = th[(i + 1) % n] + (i === n - 1 ? TAU : 0);
    const r0a = r0 * rng.range(0.8, 1.1);
    const xa = cx + Math.cos(a) * rs[i], ya = cy + Math.sin(a) * rs[i];
    if (i === 0) g.moveTo(xa, ya); else g.lineTo(xa, ya);
    const am = (a + an) * 0.5;
    g.lineTo(cx + Math.cos(am) * r0a, cy + Math.sin(am) * r0a);
  }
  g.closePath();
  return { th, rs, dom, baseW: 2 * r0 * Math.sin(Math.PI / n) };
}
// dominant spikes as tapered ink strokes with dry-brush tips, extending the polygon spikes to r1 x1.6-2.2
function inkSpikes(g, rng, cx, cy, sb, r0, r1, col, px) {
  for (const i of sb.dom) {
    const a = sb.th[i], L = r1 * rng.range(1.6, 2.2);
    inkStroke(g, rng, cx + Math.cos(a) * r0 * 0.7, cy + Math.sin(a) * r0 * 0.7, cx + Math.cos(a) * L, cy + Math.sin(a) * L, sb.baseW * rng.range(0.9, 1.15), col, px);
  }
}
// tapered ink stroke along a bolt trunk from (ax,ay) to (bx,by), with a dry-brush split tip
function inkStroke(g, rng, ax, ay, bx, by, w0, col, px) {
  // trunk: an almost straight bolt (tiny jitter, no kinks), resampled evenly so the taper is smooth
  const tree = boltTree((rng.next() * 1e9) >>> 0 || 1, { x: ax, y: ay }, { x: bx, y: by }, { jitter: 0.012, kink: 0, branches: 0, depth: 0, minSeg: 40 * px, wiggle: 0.15, bend: (rng.next() - 0.5) * 0.06 });
  if (!tree.length) return;
  const raw = tree[0].pts, rn = raw.length >> 1;
  const pts = [];
  const M = 28;
  for (let i = 0; i <= M; i++) {
    const f = i / M * (rn - 1), i0 = Math.min(rn - 2, Math.floor(f)), fr = f - i0;
    pts.push(lerp(raw[2 * i0], raw[2 * i0 + 2], fr), lerp(raw[2 * i0 + 1], raw[2 * i0 + 3], fr));
  }
  const n = M + 1;
  g.fillStyle = rgba(col);
  const split = 0.6;
  const iS = Math.max(1, Math.floor(split * (n - 1)));
  // wedge: full width at the base, tapering toward the split point
  fillTaper(g, pts, (u) => w0 * Math.min(1, u * 10 + 0.5) * Math.pow(1 - u * 0.75, 1.2), 0, Math.min(n - 1, iS + 1));
  // bristles: 3-5 thin strokes fanning out from the split point to the tip, with gaps
  const nb = 3 + Math.floor(rng.next() * 3);
  for (let b = 0; b < nb; b++) {
    const off = (b - (nb - 1) / 2) / nb;
    const len = rng.range(0.75, 1.05), bw = w0 * 0.55 / nb * rng.range(0.8, 1.6);
    const sub = [];
    for (let i = iS; i < n; i++) {
      const u = (i - iS) / Math.max(1, n - 1 - iS);
      if (u > len) break;
      const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1);
      let dx = pts[2 * c] - pts[2 * a], dy = pts[2 * c + 1] - pts[2 * a + 1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const spread = w0 * 0.42 * off * (1 + u * 1.2);
      sub.push(pts[2 * i] - dy * spread, pts[2 * i + 1] + dx * spread);
    }
    if (sub.length >= 4) fillTaper(g, sub, (u) => Math.max(0.5 * px, bw * 0.75 * (1 - u)));
  }
}
// radial wedges converging on (cx,cy), emitted in clumps (manga focus lines)
function burstLines(g, rng, cx, cy, n, rIn0, rIn1, w0, w1, col, Rout) {
  g.fillStyle = rgba(col);
  let i = 0;
  while (i < n) {
    const th0 = rng.next() * TAU, m = 2 + Math.floor(rng.next() * 4);
    const rInC = lerp(rIn0, rIn1, Math.pow(rng.next(), 1.4));
    for (let j = 0; j < m && i < n; j++, i++) {
      const th = th0 + (j - m / 2) * rng.range(0.006, 0.02);
      const rIn = rInC * rng.range(0.85, 1.25);
      const w = lerp(w0, w1, Math.pow(rng.next(), 2.6));
      const c = Math.cos(th), s = Math.sin(th);
      g.beginPath();
      g.moveTo(cx + c * rIn, cy + s * rIn);
      g.lineTo(cx + c * Rout - s * w, cy + s * Rout + c * w);
      g.lineTo(cx + c * Rout + s * w, cy + s * Rout - c * w);
      g.closePath();
      g.fill();
    }
  }
}

// drawImpactFrame(S, o) -> { silColor, rimColor, variant }
// o: { variant=0..3, t=S.t, cx=W*0.5, cy=H*0.45 (focus), angle=-0.45 (direction of the slash / dominant spikes),
//      split={x,y} (variant 2: point the diagonal split passes through, e.g. the midpoint between the characters;
//        default = chars midpoint if o.chars=[{x,y},{x,y}] else the focus), seed=21, k=1,
//      post=true (sets S.post impact params, impactMode 1), ctx=S.L.scene, boil=true,
//      under=true (composite the plate BEHIND what is already in ctx — characters drawn before stay on top),
//      outline=4 (px at 1080p: contrasting ink outline (rimColor) around the kept silhouettes; 0 disables),
//      key=true (keep only flat silhouette pixels already in ctx, erase other world art), flatten=true (recolour kept
//        silhouettes with the variant's silColor), clearEmit=true (blank S.L.emit/S.L.back drawn before the card),
//      edgeLines=1 (with under: extra burst lines drawn ON TOP near the frame edges, outside clearR, to frame the card
//        over any world art left in the scene), clearR=0.46 (fraction of H, radius around the focus kept clear) }
//  variant 0: white field, red starburst with a screentone ring, black ink spikes and heavy black burst lines (black sils)
//  variant 1: black field, white burst lines, large red starburst behind the figures, white core (white sils)
//  variant 2: diagonal split — red / white halves with a black jagged slash band and parallel lines (black sils)
//  variant 3: white field, black shatter-crack network from the focus, red broken rings (black sils)
// Use impactMode 1 (set here). impactMode 0 inverts the plate (white->red, black and red->white).
export function drawImpactFrame(S, o = {}) {
  const variant = ((o.variant ?? 0) % 4 + 4) % 4;
  const t = o.t ?? S.t;
  const ctx = o.ctx || S.L.scene;
  const { W, H } = S;
  const px = H / 1080;
  const cx = o.cx ?? W * 0.5, cy = o.cy ?? H * 0.45;
  const step = (o.boil ?? true) ? boilStep(t, 24) : 0;
  const rng = new RNG(((o.seed ?? 21) * 7919 + variant * 131 + step * 104729) >>> 0);
  const Rout = Math.hypot(W, H);
  const ang = o.angle ?? -0.45;
  const { black, red, white } = INK;
  if (o.post ?? true) {
    const p = S.post;
    p.impact = o.k ?? 1; p.impactMode = 1; p.vignette = 0; p.bloomStr = 0; p.grain = 0.02; p.ca = 0; p.flash = 0;
    p.exposure = 1; p.sat = 1; p.contrast = 1;
  }
  const under = o.under ?? true;
  let g;
  [_plate, g] = plateCtx(_plate, W, H);
  S.cam.toScreen(g);
  const fill = (c) => { g.fillStyle = rgba(c); g.fillRect(-W, -H, W * 3, H * 3); };
  const st = impactStyle(variant);
  let edgeCol = black;

  if (variant === 0) {
    fill(white);
    g.fillStyle = rgba(red);
    const sb = starburst(g, rng, cx, cy, H * 0.15, H * 0.34, ang, 0, [0.85, 1.0]);
    g.fill();
    g.save(); g.clip();
    screentone(g, cx, cy, H * 0.17, H * 0.15, 5 * px, 0.4 * px, 2.2 * px, black);
    g.restore();
    inkSpikes(g, rng, cx, cy, sb, H * 0.15, H * 0.34, red, px);
    g.fillStyle = rgba(white);
    starburst(g, rng, cx, cy, H * 0.06, H * 0.13, ang + 0.3, 10, [1.2, 1.5]);
    g.fill();
    burstLines(g, rng, cx, cy, 80, H * 0.48, H * 0.8, 1.2 * px, 30 * px, black, Rout);
    burstLines(g, rng, cx, cy, 70, H * 0.55, H * 0.9, 0.5 * px, 5 * px, black, Rout);
    burstLines(g, rng, cx, cy, 20, H * 0.22, H * 0.42, 0.5 * px, 3 * px, red, Rout);
  } else if (variant === 1) {
    fill(black);
    g.fillStyle = rgba(red);
    const sb = starburst(g, rng, cx, cy, H * 0.22, H * 0.46, ang, 0, [0.85, 1.0]);
    g.fill();
    inkSpikes(g, rng, cx, cy, sb, H * 0.22, H * 0.46, red, px);
    burstLines(g, rng, cx, cy, 120, H * 0.45, H * 0.75, 0.5 * px, 8 * px, white, Rout);
    g.fillStyle = rgba(white);
    starburst(g, rng, cx, cy, H * 0.08, H * 0.16, ang + 0.25, 11, [1.2, 1.5]);
    g.fill();
    burstLines(g, rng, cx, cy, 40, H * 0.6, H * 0.95, 1 * px, 20 * px, black, Rout);
    edgeCol = white;
  } else if (variant === 2) {
    const sp = o.split || (o.chars && o.chars.length >= 2 ? { x: (o.chars[0].x + o.chars[1].x) / 2, y: (o.chars[0].y + o.chars[1].y) / 2 } : { x: cx, y: cy });
    const a = ang, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const sx = sp.x, sy = sp.y;
    fill(white);
    // red half (side +n)
    g.fillStyle = rgba(red);
    g.beginPath();
    g.moveTo(sx - dx * Rout, sy - dy * Rout);
    g.lineTo(sx + dx * Rout, sy + dy * Rout);
    g.lineTo(sx + dx * Rout + nx * Rout, sy + dy * Rout + ny * Rout);
    g.lineTo(sx - dx * Rout + nx * Rout, sy - dy * Rout + ny * Rout);
    g.closePath(); g.fill();
    // parallel speed lines: black on the red half, red + black on the white half
    for (let i = 0; i < 110; i++) {
      const side = i % 2 ? 1 : -1;
      const off = side * (H * 0.05 + Math.pow(rng.next(), 0.8) * H * 0.95);
      const len = W * lerp(0.15, 0.9, rng.next());
      const along = lerp(-W * 0.8, W * 0.8, rng.next());
      const w = lerp(0.8, 9, Math.pow(rng.next(), 2.4)) * px;
      g.fillStyle = rgba(side > 0 ? black : (rng.next() < 0.6 ? red : black));
      const qx = sx + nx * off + dx * along, qy = sy + ny * off + dy * along;
      g.beginPath();
      g.moveTo(qx - dx * len * 0.5, qy - dy * len * 0.5);
      g.lineTo(qx + dx * len * 0.2 + nx * w, qy + dy * len * 0.2 + ny * w);
      g.lineTo(qx + dx * len * 0.5, qy + dy * len * 0.5);
      g.lineTo(qx + dx * len * 0.2 - nx * w, qy + dy * len * 0.2 - ny * w);
      g.closePath(); g.fill();
    }
    // black jagged slash band along the split, white cut line inside
    const M = 110, top = [], bot = [], mid = [];
    for (let i = 0; i <= M; i++) {
      const u = i / M, s = lerp(-Rout * 0.6, Rout * 0.6, u);
      const env = Math.pow(Math.sin(Math.PI * clamp(u * 1.1 - 0.05)), 0.6);
      const hw = H * 0.05 * env * (0.7 + 0.6 * Math.abs(noise2(u * 14, step * 0.7 + 1)));
      const j = (rng.next() - 0.5) * H * 0.012;
      top.push([sx + dx * s + nx * (hw + j), sy + dy * s + ny * (hw + j)]);
      bot.push([sx + dx * s - nx * (hw * 0.7 - j), sy + dy * s - ny * (hw * 0.7 - j)]);
      mid.push(sx + dx * s + nx * hw * 0.12, sy + dy * s + ny * hw * 0.12);
    }
    g.fillStyle = rgba(black);
    g.beginPath();
    top.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
    g.closePath(); g.fill();
    g.fillStyle = rgba(white);
    fillTaper(g, mid, (u) => H * 0.012 * Math.pow(Math.sin(Math.PI * u), 0.8));
    // shards flung off the cut
    for (let i = 0; i < 30; i++) {
      const s = lerp(-W * 0.5, W * 0.5, rng.next()), off = (rng.next() - 0.4) * H * 0.4, sz = lerp(4, 20, rng.next()) * px;
      const qx = sx + dx * s + nx * off, qy = sy + dy * s + ny * off, r = rng.next() * TAU;
      g.fillStyle = rgba(off > 0 ? (rng.next() < 0.5 ? white : black) : (rng.next() < 0.5 ? black : red));
      g.beginPath();
      g.moveTo(qx + Math.cos(r) * sz, qy + Math.sin(r) * sz);
      g.lineTo(qx + Math.cos(r + 2.5) * sz * 0.4, qy + Math.sin(r + 2.5) * sz * 0.4);
      g.lineTo(qx + Math.cos(r + 3.6) * sz * 0.5, qy + Math.sin(r + 3.6) * sz * 0.5);
      g.closePath(); g.fill();
    }
  } else {
    fill(white);
    // broken red rings
    g.lineCap = 'butt';
    for (let ring = 0; ring < 4; ring++) {
      const R = H * (0.16 + ring * 0.17) * lerp(0.95, 1.05, rng.next());
      g.strokeStyle = rgba(red);
      g.lineWidth = H * lerp(0.012, 0.045, rng.next()) * (1 - ring * 0.15);
      let a = rng.next() * TAU;
      while (a < TAU * 2) {
        const len = lerp(0.2, 1.1, rng.next());
        g.beginPath(); g.ellipse(cx, cy, R, R * 0.92, 0, a, a + len); g.stroke();
        a += len + lerp(0.08, 0.5, rng.next());
      }
    }
    // shatter cracks: black crack trees from the focus (long straight runs, angular kinks)
    g.fillStyle = rgba(black);
    const nc = 13;
    for (let i = 0; i < nc; i++) {
      const th = (i + rng.next() * 0.8) / nc * TAU;
      const L = Rout * lerp(0.45, 0.75, rng.next());
      const r0 = H * 0.05;
      const tree = boltTree((rng.next() * 1e9) >>> 0 || 1, { x: cx + Math.cos(th) * r0, y: cy + Math.sin(th) * r0 }, { x: cx + Math.cos(th) * L, y: cy + Math.sin(th) * L },
        { jitter: 0.16, branches: 0.9, depth: 2, minSeg: 14 * px, wiggle: 0.4 });
      for (const p of tree) {
        const w0 = (p.depth === 0 ? lerp(7, 16, rng.next()) : p.depth === 1 ? 5 : 2.5) * px;
        fillTaper(g, p.pts, (u) => Math.max(0.8 * px, w0 * (p.depth === 0 ? lerp(0.5, 1.4, u) : (1 - u))));
      }
    }
    g.fillStyle = rgba(white);
    starburst(g, rng, cx, cy, H * 0.05, H * 0.11, ang, 11);
    g.fill();
    burstLines(g, rng, cx, cy, 50, H * 0.55, H * 0.95, 1 * px, 10 * px, black, Rout);
  }
  // ---- composite the plate into the scene layer ----
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.filter = 'none';
  // key: keep only flat silhouette pixels already in the scene (characters drawn with silhouette=1) and erase the
  // rest (world art), then recolour the kept pixels with the card's ink (flatten) — so the card works even when the
  // shot drew ruins/stage before it, and silhouettes always contrast with the plate whatever silColor they used.
  const key = under ? (o.key ?? true) : false;
  const flat = under ? (o.flatten ?? true) : false;
  const ink = flat === true ? st.silColor : flat;
  if (key) {
    const keys = Array.isArray(key) ? (Array.isArray(key[0]) ? key : [key]) : [[8, 8, 12], [0, 0, 0], [255, 255, 255], ...(o.silColor ? [o.silColor] : [])];
    const tol = o.keyTol ?? 14;
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      let hit = false;
      for (const kc of keys) if (Math.abs(r - kc[0]) <= tol && Math.abs(gg - kc[1]) <= tol && Math.abs(b - kc[2]) <= tol) { hit = true; break; }
      if (!hit) d[i + 3] = 0;
      else if (ink) { d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]; }
    }
    ctx.putImageData(img, 0, 0);
  } else if (flat) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(ink);
    ctx.fillRect(0, 0, W, H);
  }
  // contrasting ink outline around the kept silhouettes (white sils on a white burst core / black sils on black
  // crack lines would otherwise merge into the plate): dilate a recoloured copy UNDER them
  const ow = under ? (o.outline ?? 4) * px : 0;
  if (ow > 0.3) {
    let g3;
    [_out, g3] = plateCtx(_out, W, H);
    g3.drawImage(ctx.canvas, 0, 0);
    g3.globalCompositeOperation = 'source-in';
    g3.fillStyle = rgba(st.rimColor); g3.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-over';
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.drawImage(_out, Math.cos(a) * ow, Math.sin(a) * ow); }
  }
  ctx.globalCompositeOperation = under ? 'destination-over' : 'source-over';
  ctx.drawImage(_plate, 0, 0);
  ctx.restore();
  // stray emission drawn before the card (rim lights, reflections, auras) would posterise into random white blobs
  if (o.clearEmit ?? true) {
    for (const L of [S.L.emit, S.L.back]) {
      if (!L) continue;
      L.save(); L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'source-over';
      L.fillStyle = '#000'; L.fillRect(0, 0, W, H); L.restore();
    }
  }
  // ---- framing burst lines on top near the edges (only meaningful when the plate went under existing art) ----
  const el = under ? (o.edgeLines ?? 1) : 0;
  if (el > 0 && variant !== 2) {
    let g2;
    [_over, g2] = plateCtx(_over, W, H);
    S.cam.toScreen(g2);
    const cr = H * (o.clearR ?? 0.46);
    burstLines(g2, rng, cx, cy, Math.round(70 * el), cr, cr * 1.5, 1 * px, 22 * px, edgeCol, Rout);
    g2.globalCompositeOperation = 'destination-out';
    const gr = g2.createRadialGradient(cx, cy, cr * 0.85, cx, cy, cr * 1.05);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = gr;
    g2.beginPath(); g2.arc(cx, cy, cr * 1.05, 0, TAU); g2.fill();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(_over, 0, 0);
    ctx.restore();
  }
  return { silColor: st.silColor, rimColor: st.rimColor, variant };
}
