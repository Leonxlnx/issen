// Builder D — sword-slash energy: crescent slash arcs, the colossal world slash wave, the sky cut.
// All three share one "blade" renderer: a razor-bright edge curve with colour bands
// (white core -> hot -> mid -> deep) extending to one side, broken into streak lanes at the fringe.
// Saturation comes from a scene-layer underlay (bladeShadow: navy fringe + feathered opaque colour body)
// under the additive light; only the core goes white-hot.
import { RNG, TAU, clamp, lerp, smoothstep, hash1, hash2, hash3, noise2, rgba, E } from '../core/math.js';
import { PAL, pal, mixc, boilStep, seedMix, starGlint, glowDot, fillTaper, boltTree, renderTree, sparkSpindle, sparkPoint, drawEnergyWeb } from './lightning.js';

// ---------------------------------------------------------------------------------------------
// blade renderer
// geo: { edge(u)->{x,y}, nrm(u)->{x,y} unit toward the body side, th(u)->thickness (current units) }
// o:   { P, k, u0, u1, n, stops:[f1,f2,f3,f4], alphas:[core,hot,mid,deep], lanes, laneF0, laneF1, laneW,
//        laneBias, laneSpread, laneSlide (u offset applied to lane centres), streaks, ragFreq (cycles over u0..u1),
//        ragAmp:[core,hot,mid,deep] | [mid,deep], seed, step, minCore, halo }
// Lanes are seeded by `seed` only (they hold their layout and slide), their brightness boils with `step`.
// ---------------------------------------------------------------------------------------------
export function drawBlade(ctx, geo, o) {
  const { P } = o;
  const k = o.k ?? 1;
  if (k <= 0.002) return null;
  const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1;
  if (u1 - u0 <= 1e-4) return null;
  const N = o.n ?? 120;
  const step = o.step ?? 0, seed = o.seed ?? 1;
  const ex = new Float32Array(N + 1), ey = new Float32Array(N + 1), nx = new Float32Array(N + 1), ny = new Float32Array(N + 1), th = new Float32Array(N + 1), us = new Float32Array(N + 1);
  let maxTh = 0;
  for (let i = 0; i <= N; i++) {
    const u = lerp(u0, u1, i / N);
    const e = geo.edge(u), m = geo.nrm(u);
    ex[i] = e.x; ey[i] = e.y; nx[i] = m.x; ny[i] = m.y; th[i] = Math.max(0, geo.th(u)); us[i] = u;
    if (th[i] > maxTh) maxTh = th[i];
  }
  if (maxTh <= 0.05) return null;
  const minCore = o.minCore ?? 1.1;
  const stops = o.stops || [0.08, 0.26, 0.5, 0.72];
  const alphas = o.alphas || [1, 0.78, 0.66, 0.6];
  const ragF = (o.ragFreq ?? 24) / Math.max(1e-4, u1 - u0);
  let ragA = o.ragAmp || [0, 0.02, 0.06, 0.16];
  if (ragA.length === 2) ragA = [0, 0, ragA[0], ragA[1]];
  const keys = ['core', 'hot', 'mid', 'deep'];
  const F = (b, i) => {
    let f = stops[b];
    const a = ragA[b];
    if (a > 0) {
      const nn = noise2(us[i] * ragF * (1 + b * 0.35) + seed * 3.1, step * 0.61 + b * 7.7);
      f *= 1 + a * (nn + 0.35 * noise2(us[i] * ragF * 4.3 - seed, step * 0.9 + b));
    }
    if (b === 0) f = Math.max(f, Math.min(1, minCore / Math.max(th[i], 1e-3)));
    if (b === 1) f = Math.max(f, Math.min(1, (minCore * 2.0) / Math.max(th[i], 1e-3)));
    return f;
  };
  const poly = (fa, fb) => {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const f = fa(i), x = ex[i] + nx[i] * th[i] * f, y = ey[i] + ny[i] * th[i] * f;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const f = fb(i);
      ctx.lineTo(ex[i] + nx[i] * th[i] * f, ey[i] + ny[i] * th[i] * f);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = o.halo ?? 0.08;
  if (halo > 0) {
    ctx.fillStyle = rgba(P.deep, clamp(halo * k, 0, 1));
    poly(() => -0.04, (i) => 1.25 + 0.2 * noise2(us[i] * ragF * 0.4 + seed, step * 0.3));
  }
  for (let b = 3; b >= 0; b--) {
    const a = alphas[b] * k;
    if (a <= 0.003) continue;
    ctx.fillStyle = rgba(P[keys[b]], clamp(a, 0, 1));
    poly(b === 0 ? () => 0 : (i) => F(b - 1, i), (i) => F(b, i));
  }
  // streak lanes along the blade
  const rng = new RNG((seed * 7919 + 17) >>> 0);
  const M = 24;
  const xs = new Float32Array((M + 1) * 4);
  const laneDraw = (fc, hw, ua, ub, col, al) => {
    if (ub - ua < 1e-3 || al <= 0.003) return;
    ctx.fillStyle = rgba(col, clamp(al, 0, 1));
    ctx.beginPath();
    for (let j = 0; j <= M; j++) {
      const w = j / M;
      const u = lerp(ua, ub, w);
      const fi = clamp((u - u0) / (u1 - u0), 0, 1) * N;
      const i0 = Math.min(N, Math.floor(fi)), i1 = Math.min(N, i0 + 1), fr = fi - i0;
      const X = lerp(ex[i0], ex[i1], fr), Y = lerp(ey[i0], ey[i1], fr);
      const NX = lerp(nx[i0], nx[i1], fr), NY = lerp(ny[i0], ny[i1], fr), T = lerp(th[i0], th[i1], fr);
      const tp = Math.pow(Math.sin(Math.PI * w), 0.5);
      const hwp = (T > 0.6 ? Math.max(0.35, hw * T) : hw * T) * tp;
      const c = T * fc;
      xs[j * 4] = X + NX * (c - hwp); xs[j * 4 + 1] = Y + NY * (c - hwp);
      xs[j * 4 + 2] = X + NX * (c + hwp); xs[j * 4 + 3] = Y + NY * (c + hwp);
    }
    ctx.moveTo(xs[0], xs[1]);
    for (let j = 1; j <= M; j++) ctx.lineTo(xs[j * 4], xs[j * 4 + 1]);
    for (let j = M; j >= 0; j--) ctx.lineTo(xs[j * 4 + 2], xs[j * 4 + 3]);
    ctx.closePath();
    ctx.fill();
  };
  const nl = Math.round(o.lanes ?? 28);
  const lf0 = o.laneF0 ?? 0.5, lf1 = o.laneF1 ?? 1.6;
  const span = u1 - u0;
  const bias = o.laneBias ?? 0.62, spread = o.laneSpread ?? 0.8;
  const lw = o.laneW ?? 1;
  const slide = o.laneSlide ?? 0;
  for (let j = 0; j < nl; j++) {
    const fr = (j + rng.next()) / nl;
    const fc = lerp(lf0, lf1, fr);
    const len = span * lerp(0.12, 0.8, rng.next()) * (1 - fr * 0.6);
    const c = u0 + span * clamp(bias + (rng.next() - 0.5) * spread, 0.04, 0.96) + slide * lerp(0.6, 1.4, rng.next());
    const ua = Math.max(u0, c - len * 0.5), ub = Math.min(u1, c + len * 0.5);
    const r = rng.next();
    const col = fr < 0.3 ? (r < 0.5 ? P.mid : P.hot) : fr < 0.7 ? (r < 0.6 ? P.deep : P.mid) : (r < 0.7 ? P.deep : P.dark);
    const al = k * lerp(0.75, 0.35, fr) * lerp(0.55, 1, rng.next()) * (0.78 + 0.22 * hash2(j + seed, step));
    laneDraw(fc, lw * lerp(0.008, 0.035, rng.next() ** 1.5), ua, ub, col, al);
  }
  const ns = Math.round(o.streaks ?? 10);
  for (let j = 0; j < ns; j++) {
    const fc = lerp(0.1, 0.8, rng.next());
    const len = span * lerp(0.1, 0.55, rng.next());
    const c = u0 + span * lerp(0.25, 0.92, rng.next()) + slide;
    laneDraw(fc, lerp(0.005, 0.012, rng.next()), Math.max(u0, c - len / 2), Math.min(u1, c + len / 2), fc < 0.3 ? P.core : P.hot, k * lerp(0.3, 0.7, rng.next()) * (0.75 + 0.25 * hash2(j * 3 + seed, step)));
  }
  ctx.restore();
  return { ex, ey, nx, ny, th, us, N };
}

// underlay into the normal scene layer: dark navy fringe (alpha) + optional feathered opaque colour body
// (paint, needs o.P) so energy reads saturated over bright backgrounds such as the cloud sea.
// o: { u0, u1, n, alpha (navy), layers:[[f0,f1,a],...], color (navy), P, paint, seed, step, ragFreq, rag }
export function bladeShadow(ctx, geo, o) {
  const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1, N = o.n ?? 80;
  const a = o.alpha ?? 0.4, paint = o.P ? (o.paint ?? 0) : 0;
  if ((a <= 0.003 && paint <= 0.003) || u1 - u0 < 1e-4) return;
  const seed = o.seed ?? 1, step = o.step ?? 0;
  const ragF = (o.ragFreq ?? 18) / Math.max(1e-4, u1 - u0);
  const rag = o.rag ?? 0.12;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const layers = a > 0.003 ? (o.layers || [[-0.25, 1.5, 0.28], [-0.1, 1.15, 0.45], [0, 0.9, 0.6]]).map((l) => [l[0], l[1], a * l[2], o.color || [6, 8, 26], 0]) : [];
  if (paint > 0.003) {
    layers.push([-0.03, 1.15, 0.35 * paint, o.P.deep, rag]);
    layers.push([-0.02, 0.85, 0.5 * paint, o.P.deep, rag * 0.8]);
    layers.push([-0.02, 0.55, 0.7 * paint, o.P.mid, rag * 0.6]);
  }
  const E0 = [], NM = [], TH = [], US = [];
  for (let i = 0; i <= N; i++) { const u = lerp(u0, u1, i / N); E0.push(geo.edge(u)); NM.push(geo.nrm(u)); TH.push(geo.th(u)); US.push(u); }
  for (const [f0, f1, al, col, rg] of layers) {
    ctx.fillStyle = rgba(col, clamp(al, 0, 1));
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const e = E0[i], m = NM[i], T = TH[i];
      const x = e.x + m.x * T * f0, y = e.y + m.y * T * f0;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const e = E0[i], m = NM[i], T = TH[i];
      const f = rg > 0 ? f1 * (1 + rg * (noise2(US[i] * ragF + seed * 1.7, step * 0.5 + f1 * 3) + 0.4 * noise2(US[i] * ragF * 3.7 - seed, step * 0.8))) : f1;
      ctx.lineTo(e.x + m.x * T * f, e.y + m.y * T * f);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}


// arc geometry through an arbitrary local->screen map (handles ellipse squash / rotation / perspective-ish
// skew while keeping thickness in screen px). Local arc: centre (0,0), radius R, angles a0 -> a1 over u in 0..1.
// squashK: how much of the map's radial squash is applied to the thickness (0 = none, 1 = full perspective).
// uwarp(u) (optional): extra offset added to u before the angle mapping (fragment drift along the tangent).
export function arcGeo(map, R, a0, a1, thFn, squashK = 0.4, uwarp = null) {
  const ang = uwarp ? (u) => a0 + (a1 - a0) * (u + uwarp(u)) : (u) => a0 + (a1 - a0) * u;
  const c = map(0, 0);
  const edge = (u) => { const a = ang(u); return map(Math.cos(a) * R, Math.sin(a) * R); };
  const nrm = (u) => {
    const a = ang(u), e = 0.002;
    const p = map(Math.cos(a - e) * R, Math.sin(a - e) * R), q = map(Math.cos(a + e) * R, Math.sin(a + e) * R);
    let tx = q.x - p.x, ty = q.y - p.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    let nx = -ty, ny = tx;
    const m = edge(u);
    if ((c.x - m.x) * nx + (c.y - m.y) * ny < 0) { nx = -nx; ny = -ny; }
    return { x: nx, y: ny };
  };
  const rf = (u) => {
    const a = ang(u), ca = Math.cos(a), sa = Math.sin(a);
    const p = map(ca * R, sa * R), q = map(ca * (R - 1), sa * (R - 1));
    return Math.hypot(q.x - p.x, q.y - p.y);
  };
  const th = (u) => thFn(u) * lerp(1, rf(u), squashK);
  return { edge, nrm, th, ang, map };
}

// spark trails with a drag model, shared by the slash fx: pos(tt) closed form; draws spindles (65%) or points (35%)
function sparkTrail(ctx, pos, tau, w, P, al, pointy, trailT) {
  if (al <= 0.004) return;
  if (pointy) { const p = pos(tau); sparkPoint(ctx, p.x, p.y, w * 0.8, P, al); return; }
  const tr = [];
  for (let q = 0; q <= 4; q++) { const p = pos(Math.max(0, tau - trailT * (1 - q / 4))); tr.push(p.x, p.y); }
  sparkSpindle(ctx, tr, w, P, al);
}

// ---------------------------------------------------------------------------------------------
// drawSlashArc — anime crescent sword slash
// o: { cx, cy, r, a0=-2.4, a1=0.5 (radians, y-down screen angles; the blade sweeps a0 -> a1), thickness=r*0.12,
//      progress=0..1 (head position along the arc), fade=0..1 (decay), color='blue', t=S.t,
//      screen=true (cx,cy,r in px, camera shake/roll applied) | false (cx,cy,cz world metres, r & thickness in metres),
//      tilt=0 (ellipse squash 0..0.95, 3D tilt of the slash plane), rot=0 (ellipse rotation), thickSquash=0.35,
//      seed=1, k=1, trail=1 (max visible fraction of the arc during the sweep), sweepDur=0.12, fadeDur=0.55
//      (seconds — only used to time sparks; use the real fade duration), dark=0.6 (navy underlay into the scene layer),
//      paint=0.55 (feathered opaque colour body into the scene layer), cool=0.15 (fade value by which the white-hot
//      first frames have cooled to cyan/blue), breakup=1 (the crescent shatters into 8-15 fragments while fading),
//      drift=1 (fragments drift outward / along the arc), sparks=1, debris=0.6, lanes=34, streaks=12, echo=1, glint=1,
//      ctx=S.L.emit, sceneCtx=S.L.scene }
// Draw it AFTER the characters it should cover (the dark/paint underlay goes into S.L.scene in call order).
// Timing recipe (fast attack, long elegant decay):
//   character slash: progress = prog(t, T, T+0.07..0.11, E.outQuart); fade = prog(t, T+0.10, T+0.55..0.7)   (fadeDur 0.45-0.6)
//   colossal slash:  progress = prog(t, T, T+0.08..0.12, E.outQuart); fade = prog(t, T+0.12, T+0.9..1.0)    (fadeDur ~0.8)
// ---------------------------------------------------------------------------------------------
export function drawSlashArc(S, o) {
  if (globalThis.__D_OFF?.slash) return;
  let { cx, cy, r } = o;
  const progress = clamp(o.progress ?? 1), fade = clamp(o.fade ?? 0);
  if (progress <= 0.001 || fade >= 0.999) return;
  let thickness = o.thickness;
  const em = o.ctx || S.L.emit, sc = o.sceneCtx || S.L.scene;
  const t = o.t ?? S.t;
  const step = boilStep(t, o.fps ?? 24);
  const seed = o.seed ?? 1;
  const P = pal(o.color);
  const screen = o.screen ?? true;
  if (!screen) {
    const p = S.cam.project(cx, cy, o.cz ?? o.z ?? 0);
    if (!p) return;
    cx = p.x; cy = p.y; r *= p.s; if (thickness != null) thickness *= p.s;
  }
  thickness = thickness ?? r * 0.12;
  const a0 = o.a0 ?? -2.4, a1 = o.a1 ?? 0.5;
  const dirS = Math.sign(a1 - a0) || 1;
  const tilt = clamp(o.tilt ?? 0, 0, 0.95), rot = o.rot ?? 0;
  const k = (o.k ?? 1) * (1 - smoothstep(0.62, 1, fade));
  const heat = 1 - smoothstep(0, o.cool ?? 0.15, fade);
  // visible window [us, ue] in arc parameter u
  const uh = progress;
  const ut0 = Math.max(0, uh - (o.trail ?? 1));
  const fe = Math.pow(fade, 1.3);
  const us = lerp(ut0, uh, fe * 0.85);
  const ue = uh - fe * 0.03;
  const drift = o.drift ?? 1;
  const rr = r * (1 + 0.12 * drift * E.outCubic(fade));
  const thick = thickness * (1 - 0.35 * fade) * (progress < 1 ? lerp(1.2, 1, progress) : 1);
  const tl = lerp(0.6, 0.85, fade), hl = 0.16;
  // shatter mask: the crescent splits into fragments that thin out and vanish as it fades
  // (wide transition band -> each fragment tapers to sharp points at both ends, thins out as the threshold rises)
  const brk = o.breakup ?? 1;
  const thB = lerp(-1.1, 0.7, smoothstep(0.08, 0.7, fade));
  const mask = (u) => {
    if (brk <= 0) return 1;
    const nn = noise2(u * 11 + seed * 1.37, fade * 0.9 + seed * 0.53) + 0.25 * noise2(u * 31 - seed, fade * 1.7);
    return lerp(1, smoothstep(thB - 0.3, thB + 0.22, nn), brk);
  };
  const prof = (u) => {
    const w = (u - us) / Math.max(1e-4, ue - us);
    if (w <= 0 || w >= 1) return 0;
    return Math.pow(smoothstep(0, tl, w), 1.15) * Math.pow(clamp((1 - w) / hl), 0.85) * mask(u);
  };
  const cR = Math.cos(rot), sR = Math.sin(rot), sq = 1 - tilt;
  const map = (lx, ly) => { const yy = ly * sq; return { x: cx + lx * cR - yy * sR, y: cy + lx * sR + yy * cR }; };
  const uwarp = drift > 0 && fade > 0 ? (u) => 0.03 * drift * fade * noise2(u * 6 + seed * 2.1, 7.3) : null;
  const geo = arcGeo(map, rr, a0, a1, (u) => thick * prof(u), o.thickSquash ?? 0.35, uwarp);
  const setT = (ctx) => { if (screen) S.cam.toScreen(ctx); else ctx.setTransform(1, 0, 0, 1, 0, 0); };
  const arcLenPx = Math.abs(a1 - a0) * rr * Math.max(0.05, ue - us);
  const N = Math.round(clamp(arcLenPx / 3, 64, 360));
  // the underlay retreats faster than the light once the crescent shatters (fragments stay light, not glassy)
  const dark = (o.dark ?? 0.6) * k * lerp(0.6, 1, heat) * (1 - 0.75 * smoothstep(0.12, 0.45, fade));
  const paint = (o.paint ?? 0.55) * k * lerp(0.5, 1, heat) * (1 - 0.85 * smoothstep(0.1, 0.4, fade));
  if ((dark > 0.003 || paint > 0.003) && sc) {
    sc.save(); setT(sc);
    bladeShadow(sc, geo, { u0: us, u1: ue, n: Math.round(N / 2), alpha: dark, paint, P, seed, step, ragFreq: 22 * Math.max(0.2, ue - us) });
    sc.restore();
  }
  em.save(); setT(em);
  const h = heat;
  drawBlade(em, geo, {
    P, k, u0: us, u1: ue, n: N, seed, step,
    stops: [0.05 + 0.07 * h, 0.13 + 0.17 * h, 0.32 + 0.2 * h, 0.6 + 0.12 * h],
    alphas: [lerp(0.65, 1, h), lerp(0.6, 0.72, h), 0.64, 0.6],
    lanes: o.lanes ?? 34, laneF0: 0.45 + 0.8 * fade, laneF1: 1.5 + 1.5 * fade, laneW: 1, streaks: o.streaks ?? 12, laneBias: 0.6, laneSpread: 0.9,
    laneSlide: 0.05 * fade * dirS, halo: 0.06, ragFreq: 26 * Math.max(0.2, ue - us), ragAmp: [0, 0.03, 0.06, 0.18], minCore: 1.0 + 0.7 * h,
  });
  em.globalCompositeOperation = 'lighter';
  // echo line just outside the edge (double-line anime slash)
  const echo = (o.echo ?? 1) * k * h;
  if (echo > 0.01) {
    const eu0 = lerp(us, ue, 0.3), eu1 = lerp(us, ue, 0.94);
    const M = 64, pts = [], ms = [];
    for (let i = 0; i <= M; i++) {
      const u = lerp(eu0, eu1, i / M), e = geo.edge(u), m = geo.nrm(u), off = thick * 0.1 + 3;
      pts.push(e.x - m.x * off, e.y - m.y * off); ms.push(mask(u));
    }
    em.fillStyle = rgba(P.hot, clamp(0.6 * echo, 0, 1));
    fillTaper(em, pts, (u, i) => Math.max(0.5, thick * 0.03 * Math.sin(Math.PI * u)) * ms[i]);
  }
  // leading razor-tip glint
  if ((o.glint ?? 1) > 0) {
    const g = (o.glint ?? 1) * k * (progress < 1 ? 1 : h * h);
    if (g > 0.01) {
      const e = geo.edge(ue), m = geo.nrm(ue);
      glowDot(em, e.x, e.y, thick * 1.1, P.mid, 0.3 * g);
      starGlint(em, e.x, e.y, thick * 0.95, P, g, Math.atan2(m.x, -m.y));
    }
  }
  // sparks thrown off the arc: closed-form, time in seconds = (progress-u)*sweepDur + fade*fadeDur
  const sweepDur = o.sweepDur ?? 0.12, fadeDur = o.fadeDur ?? 0.55;
  const nsp = Math.round(110 * (o.sparks ?? 1));
  const rngS = new RNG(seed * 31 + 7);
  const sp = rr * 1.4;
  const kS = (o.k ?? 1) * (1 - smoothstep(0.85, 1, fade));
  for (let j = 0; j < nsp; j++) {
    const uj = rngS.next(), f0 = rngS.next(), life = lerp(0.25, 1.1, rngS.next() ** 1.4);
    const vt = lerp(0.1, 0.9, rngS.next()), vr = lerp(-0.6, 0.9, rngS.next()), wj = lerp(0.7, 2.0, rngS.next() ** 2);
    const tw = rngS.next(), g = rngS.range(0.2, 1), pointy = rngS.next() < 0.35, trT = lerp(0.05, 0.09, rngS.next());
    if (uj > progress) continue;
    const tau = (progress - uj) * sweepDur + fade * fadeDur;
    if (tau > life) continue;
    const a = geo.ang(uj), ca = Math.cos(a), sa = Math.sin(a);
    const R0 = rr - thickness * 0.8 * f0;
    const vx = (-sa * dirS) * sp * vt + ca * sp * vr * 0.5, vy = (ca * dirS) * sp * vt + sa * sp * vr * 0.5;
    const drag = 3.2;
    const pos = (tt) => { const d = (1 - Math.exp(-tt * drag)) / drag; const p = map(ca * R0 + vx * d, sa * R0 + vy * d); p.y += rr * 0.25 * g * tt * tt; return p; };
    const al = kS * Math.pow(1 - tau / life, 1.1) * (0.7 + 0.3 * hash2(j, step));
    sparkTrail(em, pos, tau, wj, P, al, pointy, trT);
    if (tw < 0.05 && !pointy) { const p = pos(tau); starGlint(em, p.x, p.y, wj * 6, P, al); }
  }
  em.restore();
  // dark debris flecks into the scene layer
  const nd = Math.round(16 * (o.debris ?? 0.6));
  if (nd > 0 && sc) {
    sc.save(); setT(sc);
    const rngD = new RNG(seed * 53 + 3);
    for (let j = 0; j < nd; j++) {
      const uj = rngD.next(), life = lerp(0.6, 1.8, rngD.next()), vt = lerp(0.05, 0.5, rngD.next()), vr = lerp(-0.5, 0.5, rngD.next());
      const sz = lerp(1, 3, rngD.next() ** 2) * clamp(thickness / 50, 0.6, 2), spin = rngD.range(-9, 9);
      if (uj > progress) continue;
      const tau = (progress - uj) * sweepDur + fade * fadeDur;
      if (tau > life) continue;
      const a = geo.ang(uj), ca = Math.cos(a), sa = Math.sin(a), spd = rr * 0.8;
      const d = (1 - Math.exp(-tau * 2.5)) / 2.5;
      const p = map(ca * (rr - thickness * 0.6) + ((-sa * dirS) * vt + ca * vr) * spd * d, sa * (rr - thickness * 0.6) + ((ca * dirS) * vt + sa * vr) * spd * d);
      p.y += rr * 0.15 * tau * tau;
      const al = k * Math.pow(1 - tau / life, 0.7) * 0.9;
      sc.save(); sc.translate(p.x, p.y); sc.rotate(spin * tau + j);
      sc.fillStyle = rgba([13, 15, 34], clamp(al, 0, 1));
      sc.beginPath(); sc.moveTo(-sz, -sz * 0.4); sc.lineTo(sz * 0.8, -sz * 0.6); sc.lineTo(sz * 0.3, sz * 0.7); sc.closePath(); sc.fill();
      sc.restore();
    }
    sc.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// drawWorldSlash — colossal standing crescent wave ("fin") racing from p0 (near) toward p1 (horizon), cleaving
// the cloud sea along a glowing trail that blooms open behind it (shot 7). Perspective: pos = p1 + (p0-p1)/(1+K*travel).
// o: { p0:{x,y[,s]}, p1:{x,y} (screen px; pass cam.project() results so p0.s is known), t0=0, t=S.t, dur=1.4,
//      travel=0..1 (overrides (t-t0)/dur). Drive it LINEARLY — the perspective map already decelerates it.
//        If you pre-ease travel (e.g. E.outCubic), pass eased:true and K defaults to 6 instead of 14.
//      widthM (crescent size in metres at p0, converted with p0.s) | width (px, default S.W*0.9; a value < 150 together
//        with p0.s is treated as metres + console.warn), K=14|6, tilt=0.3, span=2.2 (rad), thick=0.16 (thickness/height),
//      side=1 (which way the fin bulges), height=0.5 (fin height / width), trailW=width*0.025 (trail half-width at p0, px),
//      open=1 (how far the trail blooms open with age), fade=0..1, color='blue', k=1, seed=5, spray=1 (cloud puffs, scene),
//      sparks=1, cracks=1, dark=0.45 (navy scene underlay), paint=0.7 (opaque colour body in the scene layer),
//      bright=1-paint (0 = bright background: colour comes from the painted body, light adds only core/hot; 1 = dark
//      background: full additive bands), puffTop=[214,218,246], puffShade=[118,124,190] (cel colours of the cloud spray) }
// Pair with the env cloud split: env.split = [x, z, angle (xz direction of travel), strength 0..1], env.splitW, env.splitGlow.
// Tested near-crescent companion (shot 7): drawSlashArc({ cx: W*0.52, cy: H*1.25, r: W*0.62, a0: -2.75, a1: -0.35,
//   thickness: H*0.13, tilt: 0.35, rot: 0.05, paint: 0.7 }).
// returns { head:{x,y}, scale } (screen head position and perspective scale) or undefined.
// ---------------------------------------------------------------------------------------------
let _warnedWidth = false;
export function drawWorldSlash(S, o) {
  const p0 = o.p0, p1 = o.p1;
  if (!p0 || !p1) return;
  const t = o.t ?? S.t;
  const dur = o.dur ?? 1.4;
  const travel = o.travel != null ? clamp(o.travel) : clamp((t - (o.t0 ?? 0)) / dur);
  const fade = clamp(o.fade ?? 0);
  if (fade >= 0.999 || travel <= 0) return;
  const P = pal(o.color);
  const k = (o.k ?? 1) * (1 - smoothstep(0.5, 1, fade));
  let width = o.width ?? S.W * 0.9;
  if (o.widthM != null && p0.s) width = o.widthM * p0.s;
  else if (o.width != null && o.width < 150 && p0.s) {
    if (!_warnedWidth) { console.warn(`[slash] drawWorldSlash: width=${o.width} looks like metres; converting with p0.s (use widthM)`); _warnedWidth = true; }
    width = o.width * p0.s;
  }
  const px = S.H / 1080;
  const K = o.K ?? (o.eased ? 6 : 14);
  const step = boilStep(t);
  const seed = o.seed ?? 5;
  const darkA = o.dark ?? 0.45, paintA = o.paint ?? 0.7;
  // bright=0: background is bright (cloud sea) -> colour comes from the painted scene body, light only adds core/hot.
  // bright=1: dark background -> classic additive bands. Default follows paint.
  const bright = clamp(o.bright ?? (1 - paintA));
  const em = o.ctx || S.L.emit, sc = o.sceneCtx || S.L.scene;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dl = Math.hypot(dx, dy) || 1;
  const d = { x: dx / dl, y: dy / dl }, n = { x: -d.y, y: d.x };
  const q = (tau) => 1 / (1 + K * tau);
  const at = (tau) => { const qq = q(tau); return { x: p1.x + (p0.x - p1.x) * qq, y: p1.y + (p0.y - p1.y) * qq }; };
  const head = at(travel), qh = q(travel);

  // ---- trail: two-sided blade along the path, opening with age ----
  const trailW = o.trailW ?? width * 0.025;
  const openK = o.open ?? 1;
  const ageAt = (tau) => (travel - tau) * dur + fade * 1.2;
  const thF = (u) => {
    const tau = travel * u;
    const age = ageAt(tau);
    const op = 0.45 + openK * (1.0 * smoothstep(0, 0.6, age) + 0.5 * fade);
    const tip = smoothstep(0, 0.03, 1 - u);
    return trailW * q(tau) * op * tip * (1 + 0.3 * noise2(tau * 30 + seed, step * 0.5));
  };
  const edge = (u) => at(travel * u);
  for (const side of [-1, 1]) {
    const geo = { edge, nrm: () => ({ x: n.x * side, y: n.y * side }), th: thF };
    if (sc && (darkA > 0 || paintA > 0)) {
      sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0);
      bladeShadow(sc, geo, { n: 90, alpha: darkA * k * 0.8, layers: [[-0.2, 3.0, 0.25], [-0.1, 2.0, 0.45], [0, 1.2, 0.6]], paint: paintA * k * (1 - fade), P, seed: seed + side, step, ragFreq: 40, rag: 0.3 });
      sc.restore();
    }
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0);
    drawBlade(em, geo, {
      P, k: k * (1 - 0.4 * fade), u0: 0, u1: 1, n: 240, seed: seed + (side > 0 ? 11 : 0), step,
      stops: [0.08, 0.22, 0.5, 0.8], alphas: [1, lerp(0.42, 0.6, bright), lerp(0.24, 0.55, bright), lerp(0.18, 0.5, bright)], lanes: 26, laneF0: 0.55, laneF1: 1.8, streaks: 8,
      laneBias: 0.3, laneSpread: 0.6, halo: 0.08, ragFreq: 50, ragAmp: [0.04, 0.1, 0.25, 0.5], minCore: 1.3,
    });
    em.restore();
  }
  // ---- electric cracks along the trail edges ----
  const ncr = Math.round(8 * (o.cracks ?? 1) * Math.min(1, travel * 3));
  for (let i = 0; i < ncr; i++) {
    const per = 3, cyc = Math.floor((step + i) / per);
    const hc = (qq) => hash3(seed + i * 7, cyc, qq);
    const u = hc(1) * 0.92;
    const tau = travel * u;
    const base = at(tau), qq = q(tau);
    const side = hc(2) < 0.5 ? -1 : 1;
    const L = width * qq * lerp(0.04, 0.13, hc(3));
    const ang = Math.atan2(n.y * side, n.x * side) + (hc(4) - 0.5) * 1.4;
    const off = thF(u) * 0.7;
    const a = { x: base.x + n.x * side * off, y: base.y + n.y * side * off };
    const tree = boltTree(((seed * 977 + i * 131 + cyc * 7) >>> 0) || 1, a, { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }, { jitter: 0.32, branches: 0.8, depth: 2, minSeg: 7 * px });
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
    renderTree(em, tree, P, Math.max(0.8, 2.6 * Math.sqrt(qq) * px), k * (1 - fade) * Math.pow(0.6, (step + i) - cyc * per), { under: sc, underK: 0.5 });
    em.restore();
  }
  // ---- the standing crescent "fin" at the head ----
  if (travel < 0.995 && fade < 0.6) {
    const side = o.side ?? 1;
    let Ux = n.x * 0.2, Uy = -0.8 + n.y * 0.2;
    const ul = Math.hypot(Ux, Uy) || 1; Ux /= ul; Uy /= ul;
    const Bx = -Uy * side, By = Ux * side;
    const chordH = width * qh * (o.height ?? 0.5);
    const span = o.span ?? 2.2;
    const R = chordH / (2 * Math.sin(span / 2));
    const cS = Math.cos(span / 2);
    const thick = chordH * (o.thick ?? 0.16);
    const sq = 1 - (o.tilt ?? 0.3);
    const map = (lx, ly) => { const b = (lx - R * cS) * sq, u = ly + chordH * 0.5; return { x: head.x + Ux * u + Bx * b, y: head.y + Uy * u + By * b }; };
    const geo = arcGeo(map, R, -span / 2, span / 2, (u) => thick * Math.pow(Math.sin(Math.PI * clamp(u * 0.92 + 0.04)), 0.75) * lerp(1.1, 0.7, u), 0.45);
    const kh = k * (1 - smoothstep(0.8, 0.995, travel)) * (1 - fade / 0.6);
    if (sc && (darkA > 0 || paintA > 0)) { sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); bladeShadow(sc, geo, { alpha: darkA * kh, n: 90, paint: paintA * kh, P, seed, step }); sc.restore(); }
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0);
    drawBlade(em, geo, {
      P, k: kh, u0: 0, u1: 1, n: 200, seed, step,
      stops: [0.08, 0.24, 0.5, 0.76], alphas: [1, lerp(0.45, 0.72, bright), lerp(0.26, 0.6, bright), lerp(0.2, 0.55, bright)], lanes: 44, laneF0: 0.5, laneF1: 1.7, streaks: 16, laneBias: 0.45, laneSpread: 0.95,
      halo: 0.08, ragFreq: 30, ragAmp: [0, 0.04, 0.08, 0.22], minCore: 1.4 * px,
    });
    em.globalCompositeOperation = 'lighter';
    const tip = geo.edge(1);
    starGlint(em, tip.x, tip.y, Math.max(6 * px, thick * 0.9), P, kh * 0.9, 0.3);
    // the cutting point where the fin meets the cloud surface
    glowDot(em, head.x, head.y, Math.max(10 * px, chordH * 0.35), P.mid, 0.35 * kh, 0.45);
    starGlint(em, head.x, head.y, Math.max(8 * px, chordH * 0.3), P, kh, 0);
    em.restore();
  }
  // ---- spray: cloud matter curling out in two walls (scene, opaque puffs) + sparks (emit) ----
  const nPuff = Math.round(110 * (o.spray ?? 1));
  if (nPuff > 0 && sc) {
    sc.save(); sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalCompositeOperation = 'source-over';
    const rng = new RNG(seed * 97 + 1);
    const top = o.puffTop || [214, 218, 246], bot = o.puffShade || [118, 124, 190];
    const sprayFrom = o.sprayFrom ?? 0.06;
    for (let j = 0; j < nPuff; j++) {
      const tj = lerp(sprayFrom, 1, rng.next() ** 1.2), side = rng.sign(), vs = rng.range(0.6, 1.0), vu = 0.8 * rng.range(0.7, 1.2), life = rng.range(0.6, 1.2);
      const r0 = rng.range(9, 42) * px, ph = rng.next() * TAU;
      if (tj > travel) continue;
      const age = (travel - tj) * dur + fade * 1.2;
      if (age > life || age < 0) continue;
      const base = at(tj), qq = q(tj);
      const spread = Math.max(trailW * 2.5, width * 0.04) * qq;
      const g = 1 - Math.exp(-age * 3.2);
      const lat = spread * vs * g * (1 + 0.5 * age);
      const rise = spread * vu * (g - 0.9 * age * age);
      const x = base.x + n.x * side * lat, y = base.y + n.y * side * lat - rise;
      const life01 = age / life;
      const rad = r0 * 1.4 * Math.max(0.3, qq) * (0.6 + 1.3 * age) * smoothstep(0, 0.06, age) * Math.pow(1 - life01, 0.6);
      const al = clamp((o.k ?? 1) * (1 - smoothstep(0.7, 1, life01)), 0, 1);
      if (al < 0.01 || rad < 0.6) continue;
      // cel-shaded cloud clump: 3 overlapping lobes, shadowed underside + lit top
      const lobes = [[0, 0, 1], [Math.cos(ph) * 0.75, 0.15, 0.72], [-Math.cos(ph) * 0.6, 0.22, 0.6]];
      sc.fillStyle = rgba(bot, al);
      sc.beginPath();
      for (const [ox, oy, rs] of lobes) { sc.moveTo(x + ox * rad + rad * rs, y + oy * rad); sc.arc(x + ox * rad, y + oy * rad, rad * rs, 0, TAU); }
      sc.fill();
      sc.fillStyle = rgba(top, al);
      sc.beginPath();
      for (const [ox, oy, rs] of lobes) { const r2 = rad * rs * 0.8; sc.moveTo(x + ox * rad + r2, y + oy * rad - rad * rs * 0.24); sc.arc(x + ox * rad, y + oy * rad - rad * rs * 0.24, r2, 0, TAU); }
      sc.fill();
    }
    sc.restore();
  }
  const nsp = Math.round(110 * (o.sparks ?? o.spray ?? 1));
  if (nsp > 0) {
    em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
    const rng = new RNG(seed * 131 + 9);
    for (let j = 0; j < nsp; j++) {
      const tj = rng.next() ** 1.3, side = rng.sign(), vs = rng.range(0.15, 1.0), vu = rng.range(0.1, 1.0), life = rng.range(0.3, 0.9);
      const wj = rng.range(0.7, 2.0), pointy = rng.next() < 0.35;
      if (tj > travel) continue;
      const age = (travel - tj) * dur + fade * 1.2;
      if (age > life) continue;
      const base = at(tj), qq = q(tj);
      const spread = width * 0.2 * qq;
      const pos = (aa) => {
        const gg = 1 - Math.exp(-aa * 4);
        return { x: base.x + n.x * side * spread * vs * gg, y: base.y + n.y * side * spread * vs * gg - spread * 0.6 * vu * gg + spread * 0.5 * aa * aa };
      };
      const al = k * Math.pow(1 - age / life, 1.2);
      sparkTrail(em, pos, age, wj * Math.max(0.5, Math.min(1.5, qq * 3)) * px, P, al, pointy, 0.06);
    }
    em.restore();
  }
  return { head, scale: qh };
}

// ---------------------------------------------------------------------------------------------
// drawSkyCut — the world-cut line (shot 10): razor-thin line across the frame that bursts open into a torn rift
// (ridged-fractal width: pinches and bulges, violet fringe, fissure trees branching off the edges), with rays and sparks.
// The rift band, its glow, god rays and fissures go into S.L.back (layer='back', default) so ruins and pillars occlude
// it and silhouette against the light; only a <=3 px hairline, small electric tears, sparks and star glints go into S.L.emit.
// o: { y0=S.H*0.42 (screen y of the line at frame centre), angle=-0.1, t=S.t, open=0..1, burst=0..1(+),
//      settle=0.6 (open is scaled by lerp(settle, 1, burst): as the burst decays the rift settles to 60% — pass open
//      without its own settle), reveal=1 (0..1 the line draws across), dir=1 (1 left->right, -1 right->left),
//      width=S.H*0.05 (half-width at open=1), color='blue', violet=0.45 (violet blended into the deep fringe), k=1, seed=3,
//      rays=1, sparks=1, cracks=1 (small emit tears), fissures=1 (big fractal fissures), back=1 (soft glow),
//      web=1 (fractal cell-crack energy mass around the rift, violet-shifted), webSpread=3.6 (web half-height / band
//      half-width), webScale=0.45, flashFront=0 (>0: extra emissive band flash in FRONT of the scene at the burst peak),
//      layer='back'|'emit', bandGain=2 (alpha boost for the back layer, which has no emitGain), t0=0 (time the opening
//      started; drives spark ages), ctx=S.L.emit }
// Screen-space (camera roll/shake applied). To pin it to the world while the camera dollies, compute y0 each frame from
// a far point, e.g. y0 = S.cam.project(0, -40, 600).y. Timing recipe: reveal over ~0.3 s, hold thin, then
// open = prog(t,TB,TB+0.14,E.outCubic) (no settle of your own), burst = pulse(t,TB,0.03,0.3..0.9), S.post.flash ~0.45*pulse.
// ---------------------------------------------------------------------------------------------
export function drawSkyCut(S, o = {}) {
  const t = o.t ?? S.t;
  const burst = clamp(o.burst ?? 0, 0, 2);
  const reveal = clamp(o.reveal ?? 1);
  if (reveal <= 0) return;
  const settle = o.settle ?? 0.6;
  const open = clamp(o.open ?? 0) * lerp(settle, 1, clamp(burst));
  const P0 = pal(o.color);
  const vio = o.violet ?? 0.45;
  const P = { core: P0.core, hot: P0.hot, mid: P0.mid, deep: mixc(P0.deep, PAL.violet.deep, vio), dark: mixc(P0.dark, PAL.violet.dark, clamp(vio * 1.3)) };
  // fissure palette: white core, lavender hot, violet glow (ref rifts go white -> cyan -> violet/magenta)
  const PF = { core: P0.core, hot: mixc(P0.hot, PAL.violet.hot, vio * 1.2), mid: mixc(P0.mid, PAL.violet.mid, clamp(vio * 1.4)), deep: mixc(P0.deep, PAL.violet.deep, clamp(vio * 1.6)), dark: P.dark };
  const k = o.k ?? 1;
  const px = S.H / 1080;
  const y0 = o.y0 ?? S.H * 0.42, angle = o.angle ?? -0.1;
  const maxHW = o.width ?? S.H * 0.05;
  const seed = o.seed ?? 3;
  const step = boilStep(t);
  const step12 = boilStep(t, 12);
  const D = Math.hypot(S.W, S.H) * 0.5 + 80 * px;
  const dir = o.dir ?? 1;
  const xa = dir > 0 ? -D : D, xb = lerp(xa, -xa, reveal);
  const xL = Math.min(xa, xb), xR = Math.max(xa, xb);
  const em = o.ctx || S.L.emit;
  const layer = o.layer ?? 'back';
  const bk = layer === 'back' ? S.L.back : em;
  const gain = layer === 'back' ? (o.bandGain ?? 2.0) : 1;
  const hair = 1.2 * px;
  const setT = (ctx) => { S.cam.toScreen(ctx); ctx.translate(S.W * 0.5, y0); ctx.rotate(angle); };
  const ob = clamp(open * (1 + 0.3 * burst));
  // ridged fractal width: pinches (0.15x) and bulges (1.5x) along the line
  const X = (x) => x / px;
  // billow fractal (|noise| octaves): round bulges with sharp pinches between them -> torn, cauliflower-edged rift
  const fb = (x, s) => (Math.abs(noise2(X(x) * 0.0026, s)) + 0.55 * Math.abs(noise2(X(x) * 0.0085, s + 3.7)) + 0.3 * Math.abs(noise2(X(x) * 0.026, s + 7.1 + step * 0.04))) / 1.85;
  const body = (x, side) => { const b = 0.75 * fb(x, seed * 1.31) + 0.25 * fb(x + 400, seed * 1.31 + side * 11); return 0.12 + 1.55 * Math.pow(clamp(b * 1.9), 1.15); };
  const halfW = (x, side) => {
    const edgeFade = smoothstep(0, 160 * px, x - xL) * smoothstep(0, 160 * px, xR - x);
    return hair + maxHW * ob * body(x, side) * lerp(0.25, 1, edgeFade);
  };
  // ---- soft sky glow behind the ruins (back layer), peak alpha <= 0.3 ----
  const back = (o.back ?? 1) * k;
  if (back > 0.003) {
    const bc = S.L.back;
    bc.save(); setT(bc); bc.globalCompositeOperation = 'lighter';
    const gh = maxHW * 3 * (0.4 + ob) + 40 * px + 120 * px * burst;
    const g = bc.createLinearGradient(0, -gh, 0, gh);
    const a = back * Math.min(0.3, 0.08 + 0.14 * ob + 0.12 * burst);
    g.addColorStop(0, rgba(P.dark, 0));
    g.addColorStop(0.2, rgba(P.deep, clamp(a * 0.35, 0, 1)));
    g.addColorStop(0.4, rgba(P.mid, clamp(a * 0.65, 0, 1)));
    g.addColorStop(0.5, rgba(P.hot, clamp(a, 0, 1)));
    g.addColorStop(0.6, rgba(P.mid, clamp(a * 0.65, 0, 1)));
    g.addColorStop(0.8, rgba(P.deep, clamp(a * 0.35, 0, 1)));
    g.addColorStop(1, rgba(P.dark, 0));
    bc.fillStyle = g;
    bc.fillRect(xL, -gh, xR - xL, gh * 2);
    bc.restore();
  }
  bk.save(); setT(bk); bk.globalCompositeOperation = 'lighter';
  // ---- god rays: soft gradient wedges fanning out from the band (back layer) ----
  const nGod = Math.round(14 * (o.rays ?? 1));
  const godK = k * clamp(ob * 0.5 + burst * 0.7);
  if (godK > 0.01) {
    const rng = new RNG(seed * 41 + Math.floor(step / 3));
    for (let i = 0; i < nGod; i++) {
      const x = lerp(xL, xR, (i + rng.next()) / nGod), side = rng.sign();
      const L = S.H * lerp(0.15, 0.5, rng.next() ** 1.5) * (0.5 + 0.6 * ob + 0.5 * burst);
      const w0 = lerp(10, 40, rng.next()) * px * (0.4 + ob), w1 = w0 * lerp(1.8, 3.5, rng.next());
      const tA = (x / D) * 0.5 * side + (rng.next() - 0.5) * 0.2;
      const ex = x + Math.sin(tA) * L, ey = side * Math.cos(tA) * L;
      const g = bk.createLinearGradient(x, 0, ex, ey);
      const a = godK * lerp(0.1, 0.22, rng.next());
      g.addColorStop(0, rgba(P.hot, clamp(a, 0, 1)));
      g.addColorStop(0.3, rgba(P.mid, clamp(a * 0.55, 0, 1)));
      g.addColorStop(1, rgba(P.deep, 0));
      bk.fillStyle = g;
      bk.beginPath(); bk.moveTo(x - w0, 0); bk.lineTo(x + w0, 0); bk.lineTo(ex + w1, ey); bk.lineTo(ex - w1, ey); bk.closePath(); bk.fill();
    }
  }
  // ---- energy web around the rift: fractal cell-crack mass (ref2's torn sky), violet-shifted, behind the ruins ----
  const webK = k * (o.web ?? 1) * clamp(ob * 1.3 + burst * 0.7);
  if (webK > 0.01) {
    bk.restore();
    const PW = { core: P0.core, hot: mixc(P0.hot, PAL.violet.hot, clamp(vio * 1.3)), mid: mixc(P0.mid, PAL.violet.mid, clamp(vio * 1.5)), deep: mixc(P0.deep, PAL.violet.deep, clamp(vio * 1.8)), dark: PAL.violet.dark };
    const spread = o.webSpread ?? 3.6;
    drawEnergyWeb(S, {
      cx: S.W * 0.5, cy: y0, rx: (xR - xL) * 0.5 + 40 * px, ry: maxHW * (spread * 1.6 + 1) + 60 * px, angle, color: PW, t, seed: seed + 5,
      k: webK, scale: o.webScale ?? 0.45, stretch: 1.5, speed: 0.4 * dir, fps: 12,
      band: { x0: xL, x1: xR, hw: (x, sd) => (halfW(x, sd) * spread + (14 + 30 * burst) * px) * smoothstep(xL, xL + 220 * px, x) * smoothstep(xR, xR - 220 * px, x) },
      under: 0, ctx: bk, shake: true,
    });
    if (gain > 1.2) drawEnergyWeb(S, {
      cx: S.W * 0.5, cy: y0, rx: (xR - xL) * 0.5 + 40 * px, ry: maxHW * 2 + 40 * px, angle, color: PW, t, seed: seed + 5,
      k: webK * (gain - 1) * 0.6, scale: o.webScale ?? 0.45, stretch: 1.5, speed: 0.4 * dir, fps: 12,
      band: { x0: xL, x1: xR, hw: (x, sd) => (halfW(x, sd) * 1.6 + 8 * px) * smoothstep(xL, xL + 220 * px, x) * smoothstep(xR, xR - 220 * px, x) },
      under: 0, ctx: bk, shake: true,
    });
    bk.save(); setT(bk); bk.globalCompositeOperation = 'lighter';
  }
  // ---- the rift band: two blades back to back (bright edge on the centre line) ----
  const heat = 0.5 + 0.5 * clamp(ob + burst * 0.5);
  const ga = (a) => clamp(a * gain, 0, 1);
  for (const side of [-1, 1]) {
    const geo = {
      edge: (u) => ({ x: lerp(xL, xR, u), y: 0 }),
      nrm: () => ({ x: 0, y: side }),
      th: (u) => halfW(lerp(xL, xR, u), side),
    };
    drawBlade(bk, geo, {
      P, k, u0: 0, u1: 1, n: 420, seed: seed + (side > 0 ? 101 : 0), step,
      stops: [lerp(0.08, 0.12, heat), lerp(0.2, 0.28, heat), 0.55, 0.9], alphas: [1, ga(0.42), ga(0.3), ga(0.24)],
      lanes: 30, laneF0: 0.3, laneF1: 1.1, laneW: 1.6, laneBias: 0.5, laneSpread: 1.0, streaks: Math.round(16 * ob),
      halo: 0.1 * ob * gain, ragFreq: 26 * reveal, ragAmp: [0.05, 0.07, 0.1, 0.16], minCore: 1.0 * px,
    });
  }
  // ---- fine crack texture: many small fissures hugging the band (granular "torn glass" detail) ----
  const nsf = Math.round(40 * (o.fissures ?? 1) * clamp(ob * 1.5 + burst * 0.5));
  for (let i = 0; i < nsf; i++) {
    const per = 3, cyc = Math.floor((step12 + i) / per);
    const hc = (qq) => hash3(seed * 23 + i, cyc, qq);
    const x = lerp(xL, xR, (i + hc(1)) / Math.max(1, nsf)), side = hc(2) < 0.5 ? -1 : 1;
    const L = S.H * lerp(0.025, 0.09, hc(3)) * (0.6 + 0.6 * ob);
    const ang = side * Math.PI / 2 + (hc(4) - 0.5) * 2.2;
    const ay = side * halfW(x, side) * lerp(0.4, 1.0, hc(5));
    const tree = boltTree(((seed * 71 + i * 613 + cyc * 17) >>> 0) || 1, { x, y: ay }, { x: x + Math.cos(ang) * L, y: ay + Math.sin(ang) * L }, { jitter: 0.35, branches: 1, depth: 2, minSeg: 5 * px });
    renderTree(bk, tree, PF, lerp(0.8, 1.5, hc(6)) * px, k * clamp(ob + burst) * gain * 0.4, { taperIn: 0.02, taperOut: 0.4 });
  }
  // ---- fissures: big fractal crack trees from the band edges into the sky (back layer, 12 fps boil) ----
  const nf = Math.round(lerp(8, 12.99, hash2(seed, 5)) * (o.fissures ?? 1) * clamp(ob * 1.4 + burst * 0.6));
  for (let i = 0; i < nf; i++) {
    const per = 4, cyc = Math.floor((step12 + i * 2) / per);
    const hc = (qq) => hash3(seed * 11 + i, cyc, qq);
    const x = lerp(xL, xR, (i + 0.15 + 0.7 * hc(1)) / Math.max(1, nf)), side = hc(2) < 0.5 ? -1 : 1;
    const L = S.H * lerp(0.07, 0.24, hc(3) ** 1.3) * (0.55 + 0.45 * ob + 0.3 * burst);
    const ang = side * Math.PI / 2 + (hc(4) < 0.5 ? -1 : 1) * lerp(0.4, 1.1, hc(5));
    const ay = side * halfW(x, side) * 0.85;
    const tree = boltTree(((seed * 53 + i * 977 + cyc * 13) >>> 0) || 1, { x, y: ay }, { x: x + Math.cos(ang) * L, y: ay + Math.sin(ang) * L },
      { jitter: 0.32, branches: 1.0, depth: 3, minSeg: 8 * px });
    const w = lerp(2, 4, hc(6)) * px;
    renderTree(bk, tree, PF, w, k * clamp(ob + burst) * (0.75 + 0.25 * hash2(i, step)) * gain * 0.5, { taperIn: 0.02, taperOut: 0.35 });
  }
  // ---- sharp thin rays out of the band (back layer) ----
  const nr = Math.round(40 * (o.rays ?? 1));
  const rayK = k * clamp(ob * 0.4 + burst);
  if (nr > 0 && rayK > 0.01) {
    const rng = new RNG(seed * 13 + step * 7);
    for (let i = 0; i < nr; i++) {
      const x = lerp(xL, xR, (i + rng.next()) / nr), side = rng.sign();
      const L = S.H * (0.02 + 0.18 * Math.pow(rng.next(), 2.5)) * (0.4 * ob + 1.0 * burst + 0.05);
      const w = rng.range(0.8, 2.4) * px;
      const tA = (x / D) * 0.6 * side + (rng.next() - 0.5) * 0.35;
      const yb = side * halfW(x, side) * 0.8;
      const ex = x + Math.sin(tA) * L, ey = yb + side * Math.cos(tA) * L;
      bk.fillStyle = rgba(rng.next() < 0.4 ? P.core : P.hot, clamp(rayK * rng.range(0.3, 0.9) * gain * 0.6, 0, 1));
      bk.beginPath(); bk.moveTo(x - w, yb); bk.lineTo(x + w, yb); bk.lineTo(ex, ey); bk.closePath(); bk.fill();
    }
  }
  bk.restore();

  // ================= emit: hairline core, burst flash, small tears, sparks, glints =================
  em.save(); setT(em); em.globalCompositeOperation = 'lighter';
  // hairline (<= 3 px)
  for (const [w, key, a] of [[3 * px, 'mid', 0.35], [1.6 * px, 'hot', 0.8], [0.9 * px, 'core', 1]]) {
    em.fillStyle = rgba(P[key], clamp(a * k, 0, 1));
    em.fillRect(xL, -w * 0.5, xR - xL, w);
  }
  // optional emissive flash of the band IN FRONT of the scene at the burst peak (off by default: it would glaze the
  // ruins that should silhouette against the rift; use S.post.flash for the burst instead)
  const bf = k * (o.flashFront ?? 0) * Math.pow(clamp(burst), 2.2);
  if (bf > 0.01) {
    for (const side of [-1, 1]) {
      const geo = { edge: (u) => ({ x: lerp(xL, xR, u), y: 0 }), nrm: () => ({ x: 0, y: side }), th: (u) => halfW(lerp(xL, xR, u), side) * 0.6 };
      drawBlade(em, geo, { P, k: bf * 0.8, u0: 0, u1: 1, n: 200, seed: seed + 7, step, stops: [0.25, 0.55, 0.8, 1], alphas: [1, 0.6, 0.35, 0.2], lanes: 0, streaks: 0, halo: 0, ragFreq: 120, ragAmp: [0.15, 0.2, 0.25, 0.3] });
    }
  }
  // small electric tears off the band edges
  const ncr = Math.round(8 * (o.cracks ?? 1) * clamp(ob * 1.3 + burst));
  for (let i = 0; i < ncr; i++) {
    const per = 3;
    const cyc = Math.floor((step + i) / per);
    const hc = (qq) => hash3(seed * 7 + i, cyc, qq);
    const x = lerp(xL, xR, (i + hc(1)) / Math.max(1, ncr)), side = hc(2) < 0.5 ? -1 : 1;
    const L = S.H * lerp(0.03, 0.1, hc(3) ** 1.5) * (0.6 + ob + 0.5 * burst);
    const ang = side * Math.PI / 2 + (hc(4) - 0.5) * 1.3;
    const ay = side * halfW(x, side) * 0.9;
    const tree = boltTree(((seed * 31 + i * 977 + cyc * 13) >>> 0) || 1, { x, y: ay }, { x: x + Math.cos(ang) * L, y: ay + Math.sin(ang) * L }, { jitter: 0.33, branches: 0.9, depth: 2, minSeg: 6 * px });
    renderTree(em, tree, P, lerp(1.0, 1.8, hc(5)) * px, k * Math.pow(0.6, (step + i) - cyc * per) * clamp(ob + burst));
  }
  // leading spark while the line is drawing in
  if (reveal < 1) {
    glowDot(em, xb, 0, 60 * px, P.mid, 0.45 * k);
    starGlint(em, xb, 0, 46 * px, P, k, 0);
  }
  // sparks ejected from the line (spindles + points)
  const nsp = Math.round(80 * (o.sparks ?? 1));
  if (nsp > 0 && (ob > 0.01 || burst > 0.01)) {
    const t0 = o.t0 ?? 0;
    for (let i = 0; i < nsp; i++) {
      const life = lerp(0.5, 1.4, hash2(seed + 1, i));
      const cyc = (t - t0 + hash2(seed + 2, i) * life) / life;
      const ci = Math.floor(cyc), a = cyc - ci;
      const hp = (qq) => hash3(seed + i, ci, qq);
      const x = lerp(xL, xR, hp(1)), side = hp(2) < 0.5 ? -1 : 1;
      const v = S.H * lerp(0.03, 0.2, hp(3) ** 1.5) * (0.4 + ob + burst);
      const vx = (hp(4) - 0.5) * v * 0.8;
      const hw = halfW(x, side);
      const pos = (aa) => { const g = 1 - Math.exp(-aa * 3); return { x: x + vx * g, y: side * (hw + v * g) + S.H * 0.05 * aa * aa }; };
      const al = k * Math.pow(1 - a, 1.3) * clamp(ob * 1.5 + burst);
      sparkTrail(em, pos, a, lerp(0.7, 1.8, hp(5) ** 2) * px, P, al, hp(6) < 0.35, 0.06);
    }
  }
  // burst flare: big star glints along the line
  if (burst > 0.02) {
    const rng = new RNG(seed * 5 + Math.floor(step / 2));
    for (let i = 0; i < 4; i++) {
      const x = lerp(xL, xR, rng.range(0.15, 0.85));
      starGlint(em, x, 0, S.H * rng.range(0.06, 0.14) * Math.min(1, burst), P, k * Math.min(1, burst), rng.range(-0.1, 0.1));
    }
  }
  em.restore();
}
