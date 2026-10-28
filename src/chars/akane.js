// AKANE — crimson crystal witch. drawAkane(S, o): procedural anime key-frame character.
// Canonical local space: metres, x forward (facing right), y down, origin = ground between the feet.
//
// drawAkane(S, { x, y, z, facing=1 (use -1 when she faces Kai on the left), pose='stand' | {a,b,k}, t, wind,
//   rimA, rimB, light, eyeGlow=0.8, aura=0, silhouette=0, silColor, alpha=1, smear=0, scale=1, lineScale=1,
//   grade=1, step (cloth fps: 24, 12 for idle poses, 0 = smooth), hold (2|3: impact holds), emitK=1, rim=1, rimWidth=1,
//   castGlow=0..1 (palm glow, near hand), scarfCut=0..1 (severed long tail drifting), poseOverride })
// Poses: stand, cast, blown_back, float (feet hang ~0.15 m below origin; raise y to levitate).
// Returns { pts:{eye,head,top,chest,hip,handN,handF,palm,scarfRoot,footN,footF}, skeleton }.
import { TAU, clamp, lerp, smoothstep, rgba, noise2, hash1, angLerp } from '../core/math.js';
import {
  Fr, fr, pt, plerp, padd, pdist, pang, dirv, ik2, resolvePose, target, spline, closedPath, mixedPath, polyP, prof, limb, limbShade,
  chain, hangAngle, mat, beginChar, endChar, part, ink, emitFill, emitStroke, drawEye, INKS, toRGB, curvePath, capsulePush, sheet, drawHand,
  worldPts, castShadow, isIdle, termPath,
} from './rig.js';

// ------------------------------------------------------------------ palette (near-black darks, silver hair, crimson silk)
const M = {
  skin: mat([252, 230, 222], [212, 166, 184], [255, 248, 244], { rimMul: 0.75, line: [160, 90, 100] }),
  hair: mat([236, 234, 248], [170, 166, 214], [255, 255, 255], { deep: [124, 118, 180], rimMul: 0.9, line: [118, 112, 178] }),
  hairBack: mat([200, 196, 232], [140, 134, 192], [240, 238, 255], { deep: [100, 94, 156], rimMul: 0.8, line: [100, 94, 160] }),
  dress: mat([26, 20, 32], [12, 9, 18], [96, 74, 112], { deep: [5, 4, 9], line: [6, 4, 10] }),
  dressIn: mat([92, 10, 36], [52, 4, 22], null, { rimMul: 0.6, line: [34, 0, 14] }),
  glove: mat([22, 18, 30], [10, 8, 16], [120, 106, 150], { gloss: 1, line: [4, 3, 8] }),
  boot: mat([22, 18, 30], [10, 8, 16], [140, 124, 172], { line: [4, 3, 8] }),
  scarf: mat([212, 22, 56], [128, 4, 34], [255, 110, 130], { deep: [86, 0, 24], line: [100, 0, 28] }),
  scarfIn: mat([128, 8, 36], [80, 0, 24], null, { deep: [56, 0, 16], line: [50, 0, 14] }),
  sash: mat([196, 16, 48], [116, 4, 30], [255, 96, 120], { line: [96, 0, 26] }),
  metal: mat([230, 196, 210], [150, 110, 130], [255, 255, 255]),
};
const EYE = [255, 64, 168];

const D = { thigh: 0.45, shin: 0.43, lumbar: 0.15, chestL: 0.32, neck: 0.088, headUp: 0.1, upper: 0.27, fore: 0.245, H: 1.7 };

// ------------------------------------------------------------------ poses (canonical, facing right)
const BASE = {
  hip: [-0.02, -0.96], pelvis: -0.1, spine: 0.06, chest: -0.1, neck: 0.08, head: 0.06,
  footN: [0.12, -0.105], footNa: 0.55, footF: [-0.13, -0.105], footFa: 0.65, kneeN: -1, kneeF: -1,
  handN: [0.05, -0.86], handF: [-0.07, -0.88], elbowN: 1, elbowF: 1, handNa: 1.75, handFa: 1.62,
  shapeN: 'relaxed', shapeF: 'relaxed', spreadN: 1, spreadF: 1,
  wind: [0, 0], look: 0, hairFloat: 0, scarfLift: 0, shN: -0.07, shF: 0.1, brow: 0.3, hairFront: 0, whip: 0,
};
const POSES = {
  // tall, cool standoff: weight on the back leg, hip cocked, near hand loose and slightly out, chin down
  stand: { ...BASE, hip: [-0.04, -0.975], pelvis: -0.16, spine: 0.08, chest: -0.12, neck: 0.1, head: 0.1,
    footN: [0.1, -0.105], footF: [-0.16, -0.105], handN: [0.12, -0.9], handNa: 1.45, elbowN: 1, handF: [-0.12, -0.92], handFa: 1.8, spreadN: 0.7, brow: 0.7 },
  cast: { ...BASE,
    hip: [-0.06, -0.84], pelvis: 0.1, spine: 0.22, chest: 0.08, neck: -0.08, head: -0.12,
    footN: [0.4, -0.105], footNa: 0.35, footF: [-0.44, -0.08], footFa: 1.0, kneeN: -1, kneeF: -1,
    handN: [0.78, -1.36], handNa: -0.95, shapeN: 'open', elbowN: 1, spreadN: 1.25,
    handF: [-0.52, -1.06], handFa: 2.6, shapeF: 'relaxed', elbowF: -1, spreadF: 0.9,
    wind: [-1.8, -0.35], look: 0.2, brow: 1, shN: -0.03, shF: 0.08 },
  // C-curve arch: hips thrust forward, chest and head thrown back, arms flung, legs trailing
  blown_back: { ...BASE,
    hip: [0.0, -1.05], pelvis: 0.3, spine: -0.48, chest: -0.32, neck: -0.06, head: -0.08,
    footN: [0.56, -0.36], footNa: 1.05, footF: [0.08, -0.3], footFa: 1.25, kneeN: -1, kneeF: -1, air: 1,
    handN: [0.85, -1.45], handNa: -0.5, shapeN: 'claw', elbowN: 1, spreadN: 1.4,
    handF: [0.5, -1.9], handFa: -1.2, shapeF: 'claw', elbowF: 1, spreadF: 1.3,
    wind: [4.2, -1.2], look: -0.3, brow: 0.0, mouth: 0.9, hairFloat: 0.3, scarfLift: 0.6, shN: -0.02, shF: 0.08, whip: 1, eyeOpen: 0.75 },
  float: { ...BASE,
    hip: [0, -1.0], pelvis: 0.06, spine: -0.06, chest: -0.06, neck: 0.04, head: 0.02,
    footN: [0.05, -0.16], footNa: 1.25, footF: [-0.07, -0.22], footFa: 1.3, kneeN: -1, kneeF: -1,
    handN: [0.3, -0.98], handNa: 1.0, shapeN: 'open', spreadN: 0.8, elbowN: 1,
    handF: [-0.32, -1.0], handFa: 2.2, shapeF: 'open', spreadF: 0.8, elbowF: 1,
    wind: [0, -1.4], hairFloat: 1, scarfLift: 1, air: 1, eyeOpen: 0.85 },
};
export const AKANE_POSES = POSES;

// ------------------------------------------------------------------ skeleton
function skeleton(P) {
  const hip = pt(P.hip[0], P.hip[1]);
  const pel = fr(hip, P.pelvis);
  const sp = fr(hip, P.spine);
  const waist = sp.p(0, -D.lumbar);
  const chA = P.spine + P.chest;
  const ch = fr(waist, chA);
  const neckB = ch.p(0.006, -D.chestL);
  const nkA = chA + P.neck;
  const nk = fr(neckB, nkA);
  const hdA = nkA + P.head;
  const HK = 1.14;
  const headC = nk.p(0.022, -(D.neck + D.headUp * HK));
  const hd = fr(headC, hdA, HK);
  const shN = ch.p(P.shN, -0.27), shF = ch.p(P.shF, -0.27);
  const hipN = pel.p(-0.02, 0.0), hipF = pel.p(0.035, -0.01);
  const anchors = { hip: pel.p(0.02, -0.12) };
  const ankN = target(P.footN, anchors), ankF = target(P.footF, anchors);
  const lN = ik2(hipN, ankN, D.thigh, D.shin, P.kneeN);
  const lF = ik2(hipF, ankF, D.thigh, D.shin, P.kneeF);
  const aN = ik2(shN, target(P.handN, anchors), D.upper, D.fore, P.elbowN);
  const aF = ik2(shF, target(P.handF, anchors), D.upper, D.fore, P.elbowF);
  return { P, hip, pel, sp, waist, ch, neckB, nk, headC, hd, shN, shF,
    lN: { hip: hipN, knee: lN.j, ank: lN.e, fa: P.footNa }, lF: { hip: hipF, knee: lF.j, ank: lF.e, fa: P.footFa },
    aN: { sh: shN, el: aN.j, wr: aN.e, ha: P.handNa, shape: P.shapeN, spread: P.spreadN }, aF: { sh: shF, el: aF.j, wr: aF.e, ha: P.handFa, shape: P.shapeF, spread: P.spreadF } };
}

// ------------------------------------------------------------------ legs (thigh-high heeled boots)
function drawLeg(R, L, near) {
  const { hip, knee, ank, fa } = L;
  const pts = [hip, plerp(hip, knee, 0.5), knee, plerp(knee, ank, 0.45), ank];
  // bare upper thigh (skin) under the boot top
  const wA = prof([[0, 0.088], [0.2, 0.08], [0.45, 0.054], [0.55, 0.05], [0.7, 0.056], [0.88, 0.038], [1, 0.032]]);
  const wB = prof([[0, 0.07], [0.22, 0.072], [0.45, 0.05], [0.6, 0.046], [0.85, 0.036], [1, 0.032]]);
  const lm = limb(pts, wA, wB, { per: 6, capEnd: 0.3, capStart: 0.6 });
  const n = lm.sp.length;
  const i0 = Math.floor(n * 0.24);
  part(R, closedPath(lm.pts, 1), M.skin, { shadeW: 0.012, termP: limbShade(R, lm, 0.4, 0, i0 + 3) });
  // boot: from mid-thigh down, including foot
  const ft = fr(ank, fa);
  const sA = lm.A.slice(i0), sB = lm.B.slice(i0);
  // the boot top cuff slightly wider
  const top0 = padd(sA[0], { x: (sA[0].x - lm.sp[i0].x) * 0.12, y: (sA[0].y - lm.sp[i0].y) * 0.12 });
  const top1 = padd(sB[0], { x: (sB[0].x - lm.sp[i0].x) * 0.12, y: (sB[0].y - lm.sp[i0].y) * 0.12 });
  const heelTop = ft.p(-0.032, 0.03);
  const boot = [
    { ...top0, sharp: true }, ...sA.slice(1, sA.length - 2),
    ft.p(-0.04, -0.01), { ...heelTop, sharp: true },
    { x: heelTop.x + 0.006, y: heelTop.y + 0.085, sharp: true }, { x: heelTop.x + 0.018, y: heelTop.y + 0.085, sharp: true }, { ...ft.p(-0.0, 0.034), sharp: true },
    ft.p(0.07, 0.04), ft.p(0.13, 0.034), { ...ft.p(0.165, 0.022), sharp: true }, ft.p(0.155, 0.002), ft.p(0.09, -0.012), ft.p(0.03, -0.026),
    ...sB.slice(1, sB.length - 2).reverse(), { ...top1, sharp: true },
  ];
  const bootP = mixedPath(boot, 1);
  const hiL = [];
  if (R.detail > 0.3) {
    // glossy streak down the shin front & thigh
    const st = [];
    for (let i = Math.floor(n * 0.3); i < Math.floor(n * 0.92); i++) st.push(plerp(lm.B[i], lm.sp[i], 0.4));
    for (let i = Math.floor(n * 0.92) - 1; i >= Math.floor(n * 0.3); i--) st.push(plerp(lm.B[i], lm.sp[i], 0.5));
    hiL.push(closedPath(st, 1));
  }
  part(R, bootP, M.boot, { shadeW: 0.012, his: hiL, termP: limbShade(R, lm, 0.5, i0, n - 1) });
  // boot top band + knee crease
  ink(R, [plerp(top0, top1, 0.0), plerp(top0, top1, 0.5), plerp(top0, top1, 1)], R.lwIn * 1.2);
  const tb0 = lm.A[i0 + 2], tb1 = lm.B[i0 + 2];
  ink(R, [tb0, plerp(tb0, tb1, 0.5), tb1], R.lwIn * 0.9, { alpha: 0.7, col: M.boot.hi });
  const ik = Math.floor(n * 0.5);
  ink(R, [plerp(lm.A[ik - 1], lm.sp[ik - 1], 0.0), plerp(lm.A[ik], lm.sp[ik], 0.4)], R.lwIn, { alpha: 0.8, col: M.boot.hi });
}

// ------------------------------------------------------------------ arms (bare upper arm, long glove)
function drawArm(R, a, near, castGlow) {
  const { sh, el, wr } = a;
  const pts = [sh, plerp(sh, el, 0.5), el, plerp(el, wr, 0.5), wr];
  const wA = prof([[0, 0.048], [0.25, 0.04], [0.5, 0.032], [0.7, 0.034], [1, 0.024]]);
  const wB = prof([[0, 0.045], [0.25, 0.037], [0.5, 0.03], [0.7, 0.031], [1, 0.024]]);
  const lm = limb(pts, wA, wB, { per: 6, capEnd: 0.2, capStart: 0.8 });
  const n = lm.sp.length, i0 = Math.floor(n * 0.36);
  part(R, closedPath(lm.pts, 1), M.skin, { shadeW: 0.01, termP: limbShade(R, lm, 0.4, 0, i0 + 2) });
  // glove from above the elbow
  const gA = lm.A.slice(i0), gB = lm.B.slice(i0);
  const t0 = padd(gA[0], { x: (gA[0].x - lm.sp[i0].x) * 0.15, y: (gA[0].y - lm.sp[i0].y) * 0.15 });
  const t1 = padd(gB[0], { x: (gB[0].x - lm.sp[i0].x) * 0.15, y: (gB[0].y - lm.sp[i0].y) * 0.15 });
  const g = [{ ...t0, sharp: true }, ...gA.slice(1), ...gB.slice(1).reverse(), { ...t1, sharp: true }];
  const hi = [];
  const st = [];
  for (let i = i0 + 2; i < n - 2; i++) st.push(plerp(lm.B[i], lm.sp[i], 0.36));
  for (let i = n - 3; i >= i0 + 2; i--) st.push(plerp(lm.B[i], lm.sp[i], 0.5));
  if (st.length > 3) hi.push(closedPath(st, 1));
  part(R, mixedPath(g, 1), M.glove, { shadeW: 0.01, his: hi, termP: limbShade(R, lm, 0.5, i0, n - 1) });
  ink(R, [t0, plerp(t0, t1, 0.5), t1], R.lwIn * 1.1);
  if (R.detail > 0.5) {
    // wrinkles bunching at the elbow / wrist
    const at = (i, k) => plerp(lm.A[i], lm.B[i], k);
    ink(R, [at(Math.floor(n * 0.52), 0.1), at(Math.floor(n * 0.55), 0.45)], R.lwIn * 0.8, { col: M.glove.hi, alpha: 0.55 });
    ink(R, [at(n - 4, 0.15), at(n - 3, 0.5), at(n - 4, 0.8)], R.lwIn * 0.8, { col: M.glove.hi, alpha: 0.5 });
  }
  // hand
  const F = fr(wr, a.ha);
  const h = drawHand(R, F, a.shape, M.glove, { k: 1.14, spread: a.spread, gloss: true });
  if (castGlow > 0 && near) {
    // palm glow: hot core + ring, into emission (bloomed by the compositor)
    const c = h.palmC;
    const e = R.e;
    const r = 0.12 * castGlow + 0.02;
    const g1 = e.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 2.2);
    g1.addColorStop(0, rgba([255, 230, 240], clamp(castGlow * R.emitK)));
    g1.addColorStop(0.18, rgba([255, 90, 140], clamp(0.9 * castGlow * R.emitK)));
    g1.addColorStop(0.5, rgba([200, 0, 60], clamp(0.35 * castGlow * R.emitK)));
    g1.addColorStop(1, 'rgba(120,0,40,0)');
    e.fillStyle = g1; e.beginPath(); e.arc(c.x, c.y, r * 2.2, 0, TAU); e.fill();
    // crisp sparkle rays boiling at 24 fps
    const tb = Math.floor(R.S.t * 24 + 0.5);
    for (let i = 0; i < 6; i++) {
      const an = i / 6 * TAU + tb * 0.13;
      const l = r * (1.3 + 0.7 * hash1(tb * 7 + i));
      ink(R, [c, padd(c, dirv(an, l * 0.5)), padd(c, dirv(an, l))], r * 0.12, { ctx: e, col: [255, 160, 190], alpha: clamp(castGlow * R.emitK), taper: 'end' });
    }
  }
  return lm;
}

// ------------------------------------------------------------------ torso / dress
function torsoPts(K) {
  const { ch, pel } = K;
  const mid = (u1, v1, u2, v2) => plerp(ch.p(u1, v1), pel.p(u2, v2), 0.5);
  return [
    ch.p(0.035, -0.33), ch.p(0.085, -0.31), ch.p(0.122, -0.262), ch.p(0.152, -0.205), ch.p(0.148, -0.165), ch.p(0.115, -0.13), ch.p(0.088, -0.07),
    mid(0.076, 0.0, 0.08, -0.15), pel.p(0.1, -0.06), pel.p(0.104, 0.0), pel.p(0.06, 0.06), pel.p(-0.04, 0.072), pel.p(-0.135, 0.03), pel.p(-0.142, -0.06),
    mid(-0.088, 0.0, -0.11, -0.15), ch.p(-0.094, -0.1), ch.p(-0.112, -0.2), ch.p(-0.115, -0.262), ch.p(-0.08, -0.308), ch.p(-0.025, -0.335),
  ];
}
function drawTorso(R, K) {
  const { ch } = K;
  // skin base for shoulders / upper chest (sleeveless)
  const sk = [ch.p(0.03, -0.345), ch.p(0.11, -0.3), ch.p(0.13, -0.24), ch.p(-0.11, -0.24), ch.p(-0.11, -0.3), ch.p(-0.04, -0.345)];
  part(R, closedPath(sk, 1), M.skin, { shadeW: 0.015, term: 0.4, termPts: sk });
  // bodice: halter neck, bare shoulders, fitted
  const tp = torsoPts(K);
  const bod = [ch.p(0.035, -0.34), ch.p(0.07, -0.318), ch.p(0.1, -0.27), ...tp.slice(3, tp.length - 3), ch.p(-0.1, -0.24), ch.p(-0.07, -0.29), ch.p(-0.025, -0.34)];
  const bodP = closedPath(bod, 1);
  const sh = [closedPath([ch.p(0.155, -0.19), ch.p(0.11, -0.16), ch.p(0.09, -0.12), ch.p(0.13, -0.12)], 1)];
  part(R, bodP, M.dress, { shadeW: 0.025, shadows: sh, term: 0.45, termPts: bod, his: [closedPath([ch.p(0.13, -0.24), ch.p(0.145, -0.2), ch.p(0.13, -0.18), ch.p(0.12, -0.22)], 1)] });
  if (R.detail > 0.3) {
    ink(R, [ch.p(0.06, -0.32), ch.p(0.1, -0.24), ch.p(0.105, -0.17)], R.lwIn * 0.9, { col: M.dress.hi, alpha: 0.55 });
    ink(R, [ch.p(0.12, -0.13), ch.p(0.1, -0.08), ch.p(0.08, -0.02)], R.lwIn * 0.9, { col: M.dress.hi, alpha: 0.45 });
    ink(R, [ch.p(-0.06, -0.2), ch.p(-0.05, -0.1), ch.p(-0.055, -0.02)], R.lwIn, { col: M.dress.line, alpha: 0.8 });
  }
  return bodP;
}
function drawSash(R, K, windL) {
  const { ch, pel } = K;
  const band = [ch.p(0.084, -0.045), ch.p(0.09, 0.0), pel.p(0.1, -0.1), pel.p(-0.13, -0.09), ch.p(-0.098, -0.002), ch.p(-0.094, -0.05)];
  part(R, closedPath(band, 0.8), M.sash, { shadeW: 0.012, lw: 0.9, term: 0.4, termPts: band });
  ink(R, [ch.p(0.086, -0.02), ch.p(-0.02, -0.02), ch.p(-0.096, -0.025)], R.lwIn * 0.8, { alpha: 0.8, col: M.sash.line });
  // bow on the near hip: flat twisting ribbon tails, two loops, a small wrapped knot
  const kp = pel.p(-0.05, -0.125);
  const hang = hangAngle({ x: windL.x * 0.7, y: windL.y * 0.7 }, 1);
  const wm = Math.min(Math.hypot(windL.x, windL.y), 6);
  const back = pel.d(-1, 0), up = pel.d(0, -1);
  for (let j = 0; j < 2; j++) {
    const c = chain(padd(kp, pel.d(-0.01 * j, 0.012)), 9, (0.42 - j * 0.09) / 9, { a0: pel.a + Math.PI / 2 + 0.35 + j * 0.3, hang: hang + j * 0.14, t: R.t, amp: 0.14 + 0.05 * wm, freq: 1 + 0.25 * wm, k: 4.4, seed: 11 + j * 1.7, stiff: 0.45, maxBend: 0.5, curve: j ? -0.25 : 0.2, curveF: 2 });
    const W = (q) => 0.05 * (1 - 0.3 * q) * (q > 0.82 ? Math.max(0.35, (1 - q) / 0.18) : 1);
    ribbonTwist(R, c, W, (q) => q * 4.2 - TAU * (0.4 + 0.1 * wm) * R.t + j * 1.9, j ? M.scarfIn : M.sash, j ? M.sash : M.scarfIn, 'fork', j);
  }
  // loops: teardrops out of the knot, back-up and back-down, fluttering a little
  const fl = (k) => Math.sin(TAU * (0.9 + 0.2 * wm) * R.t + k) * 0.006 * (1 + wm * 0.3);
  for (const [bu, uu, len, wid, k] of [[0.85, 0.55, 0.095, 0.048, 0], [0.7, -0.75, 0.085, 0.044, 1.7]]) {
    const dir = { x: back.x * bu + up.x * uu, y: back.y * bu + up.y * uu };
    const dl = Math.hypot(dir.x, dir.y) || 1; const d = { x: dir.x / dl, y: dir.y / dl }, nn = { x: -d.y, y: d.x };
    const tip = padd(padd(kp, d, len), { x: fl(k), y: fl(k + 1) });
    const loop = [padd(kp, nn, wid * 0.22), padd(padd(kp, d, len * 0.55), nn, wid * 0.62), { ...tip, sharp: false }, padd(padd(kp, d, len * 0.62), nn, -wid * 0.55), padd(kp, nn, -wid * 0.22)];
    const lp = closedPath(loop, 1);
    const inner = closedPath([padd(kp, d, 0.012), padd(padd(kp, d, len * 0.5), nn, wid * 0.2), padd(kp, d, len * 0.78), padd(padd(kp, d, len * 0.5), nn, -wid * 0.14)], 1);
    part(R, lp, M.sash, { shadeW: 0.012, lw: 0.9, term: 0.45, termPts: loop, deep: [inner] });
  }
  const knot = [padd(kp, pel.d(-0.022, -0.022)), padd(kp, pel.d(0.02, -0.02)), padd(kp, pel.d(0.022, 0.02)), padd(kp, pel.d(-0.02, 0.022))];
  part(R, closedPath(knot, 1), M.sash, { shadeW: 0.01, lw: 0.9, term: 0.5, termPts: knot });
  ink(R, [padd(kp, pel.d(-0.008, -0.016)), padd(kp, pel.d(0.0, 0.0)), padd(kp, pel.d(-0.006, 0.016))], R.lwIn * 0.9, { col: M.sash.line });
}
function drawSkirt(R, K, layer, windL) {
  const { pel, P } = K;
  const wm = Math.hypot(windL.x, windL.y);
  const hang = hangAngle({ x: windL.x * 0.55, y: windL.y * 0.55 }, 1);
  const amp = 0.07 + 0.05 * Math.min(wm, 6);
  const freq = 0.9 + 0.3 * Math.min(wm, 6);
  const down = pel.a + Math.PI / 2;
  const n = 9;
  const lF = K.lF, lN = K.lN;
  const legCol = (p) => capsulePush(p, lF.hip, lF.knee, 0.085) || capsulePush(p, lN.hip, lN.knee, 0.085);
  const ch = (root, a0, len, hangOff, seed, collide, ampK = 1) => chain(root, n, len / n, {
    a0, hang: hang + hangOff, t: R.t, amp: amp * ampK, freq, k: 3.4, seed, stiff: 0.55, maxBend: 0.45, collide, ampPow: 1.3, ground: P.air ? null : -0.004,
  });
  if (layer === 'back') {
    const A = ch(pel.p(-0.0, -0.06), down + 0.18, 0.66, 0.12, 2.2, null, 1.0);
    const B = ch(pel.p(-0.15, -0.05), down + 0.55, 0.74, 0.32, 3.1, null, 1.2);
    sheet(R, A, B, { m: M.dressIn, cols: 4, freq, seed: 2, ripple: 0.2, shadeW: 0.03, term: 0.4, tuck: 0.035 });
    const A2 = ch(pel.p(0.03, -0.065), down + 0.08, 0.6, 0.06, 1.2, null, 0.9);
    const B2 = ch(pel.p(-0.145, -0.055), down + 0.42, 0.7, 0.24, 2.5, null, 1.1);
    sheet(R, A2, B2, { m: M.dress, cols: 5, freq, seed: 4, ripple: 0.18, deepEdge: true, term: 0.4, lining: M.dressIn, tuck: 0.04 });
  } else if (layer === 'front') {
    const A = ch(pel.p(0.11, -0.07), down - 0.12, 0.44, -0.05, 4.4, legCol, 0.8);
    const B = ch(pel.p(0.02, -0.065), down + 0.05, 0.48, 0.03, 5.0, legCol, 0.9);
    sheet(R, A, B, { m: M.dress, cols: 2, freq, seed: 5, ripple: 0.12, tuck: 0, term: 0.35 });
  } else if (layer === 'hip') {
    // near side panel over the top of the near thigh; the slit opens below it
    const A = ch(pel.p(0.1, -0.08), down - 0.06, 0.17, 0.0, 6.1, null, 0.4);
    const B = ch(pel.p(-0.13, -0.065), down + 0.2, 0.22, 0.1, 6.6, null, 0.5);
    sheet(R, A, B, { m: M.dress, cols: 3, freq, seed: 6, ripple: 0.08, shadeW: 0.02, tuck: 0.02, term: 0.4, lining: M.dressIn });
  }
}

// ------------------------------------------------------------------ scarf
// thin silk ribbon along a chain: the width follows cos(twist) so it truly flips (showing the inner,
// darker side), tapers to a point (or a dovetail fork) at the end.
function ribbonTwist(R, c, W, phase, mOut, mIn, tip = 'point', foldSide = 0) {
  const n = c.length;
  const L = [], Rr = [], hs = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const s = i / (n - 1);
    let tw = Math.cos(phase(s));
    if (Math.abs(tw) < 0.12) tw = (tw < 0 ? -1 : 1) * 0.12;
    const w = W(s) * 0.5 * tw;
    hs.push(w);
    L.push({ x: c[i].x - dy * w, y: c[i].y + dx * w });
    Rr.push({ x: c[i].x + dy * w, y: c[i].y - dx * w });
  }
  // split into runs of the same side
  let i0 = 0, run_i = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || Math.sign(hs[i]) !== Math.sign(hs[i0])) {
      const i1 = i - 1;
      const run = [];
      const startP = i0 > 0 ? plerp(c[i0 - 1], c[i0], 0.5) : null;
      const endP = i1 < n - 1 ? plerp(c[i1], c[i1 + 1], 0.5) : null;
      if (startP) run.push({ ...startP, sharp: true });
      for (let k = i0; k <= i1; k++) run.push(L[k]);
      if (endP) run.push({ ...endP, sharp: true });
      else {
        const e = c[i1], e0 = c[Math.max(0, i1 - 1)];
        const d = { x: e.x - e0.x, y: e.y - e0.y }; const dl = Math.hypot(d.x, d.y) || 1;
        if (tip === 'fork') { run.push({ ...L[i1], sharp: true }); run.push({ x: e.x - d.x / dl * 0.07, y: e.y - d.y / dl * 0.07, sharp: true }); }
        else if (tip === 'cut') run.push({ ...L[i1], sharp: true });
        else { run.push({ ...L[i1], sharp: true }); run.push({ x: e.x + d.x / dl * 0.05, y: e.y + d.y / dl * 0.05, sharp: true }); }
      }
      for (let k = i1; k >= i0; k--) run.push(k === i1 && !endP ? { ...Rr[k], sharp: true } : Rr[k]);
      if (run.length >= 3) {
        const front = hs[i0] > 0;
        const p = mixedPath(run, 1);
        const m = front ? mOut : mIn;
        part(R, p, m, { shadeW: 0.02, term: front ? 0.3 : 0, termPts: run });
        if (R.detail > 0.3 && i1 - i0 > 3) {
          // a fold line along the run, alternating sides
          const side = (run_i + foldSide) % 2 ? Rr : L;
          const fl = [];
          for (let k = i0 + 1; k < i1; k++) fl.push(plerp(c[k], side[k], 0.4));
          if (fl.length > 2) ink(R, fl, R.lwIn * 1.1, { alpha: 0.9, col: m.line });
        }
      }
      i0 = i; run_i++;
    }
  }
}
function scarfChains(R, K, windL) {
  const { nk, P } = K;
  const wm = Math.min(Math.hypot(windL.x, windL.y), 6);
  const hang = hangAngle({ x: windL.x * 0.85, y: windL.y * 0.85 - P.scarfLift * 0.6 }, 1);
  const amp = 0.21 + 0.08 * wm;
  const freq = 0.75 + 0.22 * wm;
  const root = nk.p(-0.07, 0.02);
  const a0 = nk.a + Math.PI * 0.62;
  const n1 = 22, L1 = 2.3;
  const c1 = chain(root, n1, L1 / n1, { a0, hang, t: R.t, amp, freq, k: 6.5, seed: 0.4, stiff: 0.28, maxBend: 0.5, ampPow: 1.1 });
  const c2 = chain(nk.p(-0.055, 0.035), 17, 1.7 / 17, { a0: a0 + 0.2, hang: hang + 0.12, t: R.t, amp: amp * 1.1, freq: freq * 1.08, k: 6.8, seed: 2.3, stiff: 0.26, maxBend: 0.5, ampPow: 1.1 });
  return { c1, c2, freq, hang, amp, n1, L1 };
}
const taperEnd = (s) => (s > 0.75 ? Math.max(0.05, (1 - s) / 0.25) : 1);
function drawScarfTails(R, K, windL, scarfCut) {
  const { c1, c2, freq, hang, n1, L1 } = scarfChains(R, K, windL);
  const t = R.t;
  const W1 = (s) => (0.16 * (1 - 0.2 * s) + 0.025 * Math.sin(s * 9 + t * 2)) * Math.max(taperEnd(s), 0.5 * smoothstep(0.75, 1, s) + 0.05);
  const W2 = (s) => 0.14 * (1 - 0.25 * s) * taperEnd(s);
  const ph1 = (s) => s * 7.5 - TAU * freq * 0.3 * t + 0.4;
  const ph2 = (s) => s * 6.4 - TAU * freq * 0.33 * t + 2.6;
  ribbonTwist(R, c2, W2, ph2, M.scarf, M.scarfIn, 'point', 1);
  if (scarfCut > 0) {
    // severed: attached stub + a loose piece that flutters while it drifts away
    const cutI = 8, cf = cutI / n1;
    const stub = c1.slice(0, cutI + 1);
    ribbonTwist(R, stub, (s) => W1(s * cf) * (s > 0.92 ? 0.7 : 1), (s) => ph1(s * cf), M.scarf, M.scarfIn, 'cut');
    const k = scarfCut;
    const cutP = c1[cutI];
    const drift = { x: -0.5 * k - windL.x * 0.25 * k, y: 0.55 * k * k - 0.15 * k };
    const lroot = padd(cutP, drift);
    const a0 = pang(c1[cutI - 1], cutP) + k * 0.9 + Math.sin(t * 1.3) * 0.15 * k;
    const loose = chain(lroot, 10, L1 / n1, { a0, hang: hang + 0.4, t: R.t, amp: 0.35, freq: 1.6, k: 5, seed: 7.7, stiff: 0.2, maxBend: 0.6, ampPow: 1 });
    ribbonTwist(R, loose, (s) => W1(cf + s * (1 - cf)), (s) => ph1(cf + s * (1 - cf)) + k * 2, M.scarf, M.scarfIn, 'fork');
    // glowing cut edges
    if (R.emitK > 0) {
      const dA = pang(c1[cutI - 1], cutP) + Math.PI / 2, dB = a0 + Math.PI / 2;
      const ga = 0.95 * (1 - k * 0.55) * R.emitK;
      for (const [p, d] of [[cutP, dA], [lroot, dB]]) {
        const ce = [padd(p, dirv(d, -0.075)), padd(p, dirv(d, 0.075))];
        ink(R, ce, 0.016, { ctx: R.e, col: [60, 160, 255], alpha: ga * 0.7, taper: 'both' });
        ink(R, ce, 0.007, { ctx: R.e, col: [220, 250, 255], alpha: ga, taper: 'both' });
      }
    }
  } else {
    ribbonTwist(R, c1, W1, ph1, M.scarf, M.scarfIn, 'fork');
  }
}
// slim wrap: two bands from under the jaw to the neck base, V-dip at the front, diagonal folds
function drawScarfWrap(R, K) {
  const { nk, hd } = K;
  const J = (u, v) => hd.p(u, v), N = (u, v) => nk.p(u, v), M2 = (a, b, k = 0.5) => plerp(a, b, k);
  const topF = J(0.07, 0.122), topB = J(-0.06, 0.07);
  const botF = N(0.075, 0.035), botV = N(0.04, 0.06), botB = N(-0.075, 0.04);
  const midF = M2(topF, botF, 0.48), midB = M2(topB, botB, 0.5);
  const fwd = nk.d(1, 0);
  const upper = [topF, padd(M2(topF, topB, 0.5), nk.d(0, 0.012)), topB, padd(M2(topB, midB, 0.5), nk.d(-0.01, 0)), midB, padd(M2(midB, midF, 0.5), nk.d(0, 0.012)), padd(midF, fwd, 0.008)];
  const lower = [padd(midF, fwd, 0.006), padd(M2(midF, midB, 0.5), nk.d(0, 0.008)), midB, padd(M2(midB, botB, 0.5), nk.d(-0.012, 0)), botB, N(-0.02, 0.058), { ...botV, sharp: true }, botF, padd(M2(midF, botF, 0.5), fwd, 0.012)];
  const lp = mixedPath(lower, 1);
  part(R, lp, M.scarf, { shadeW: 0.016, term: 0.42, termPts: lower });
  const up = closedPath(upper, 1);
  // the jaw casts a shadow across the top of the wrap
  part(R, up, M.scarf, { shadeW: 0.016, term: 0.42, termPts: upper, shadows: [closedPath([topF, padd(M2(topF, topB, 0.5), nk.d(0, 0.02)), topB, padd(topB, nk.d(0, 0.025)), padd(M2(topF, topB, 0.5), nk.d(0, 0.04)), padd(topF, nk.d(0, 0.02))], 1)] });
  if (R.detail > 0.3) {
    const col = M.scarf.line;
    // diagonal folds: upper-back to lower-front
    ink(R, [M2(topB, midB, 0.25), M2(M2(topB, topF, 0.5), M2(midB, midF, 0.5), 0.55), M2(topF, midF, 0.85)], R.lwIn * 1.1, { col });
    ink(R, [M2(midB, botB, 0.2), M2(M2(midB, midF, 0.5), botV, 0.5), M2(midF, botF, 0.8)], R.lwIn * 1.0, { col, alpha: 0.9 });
    ink(R, [M2(midB, botB, 0.6), M2(midB, botV, 0.75)], R.lwIn * 0.8, { col, alpha: 0.8 });
  }
}

// ------------------------------------------------------------------ hair
// Long silver hair = layered locks (clumps), not a sheet. Each lock is a tapered leaf along its own
// deterministic chain: a wide root hidden under the cap, a belly, a long pointed (sometimes forked)
// tip. Darker under-layer locks are drawn first and peek between the top locks. In 'float' the locks
// fan out into a slow halo; in 'blown_back' the forward wind whips them over and around the head.
const D2R = Math.PI / 180;
const HC = { x: -0.012, y: -0.012 }; // skull centre (head space)
// [root angle deg (head polar), a0 deg (head-relative start direction), length, width, fan (rad, + = toward the back), layer, seed]
const LOCKS = [ // + curve (rad): C/S bend of the lock
  [-128, 160, 0.5, 0.09, 0.3, 0, 1.1, 0.3],
  [-156, 140, 0.64, 0.094, 0.16, 0, 2.3, -0.25],
  [174, 118, 0.68, 0.09, 0.04, 0, 3.7, 0.32],
  [148, 102, 0.58, 0.08, -0.06, 0, 4.9, -0.2],
  [-112, 166, 0.46, 0.1, 0.36, 1, 5.3, -0.34],
  [-136, 150, 0.58, 0.104, 0.24, 1, 6.1, 0.28],
  [-160, 134, 0.66, 0.1, 0.12, 1, 7.4, -0.3],
  [-178, 120, 0.62, 0.094, 0.04, 1, 8.2, 0.36],
  [160, 106, 0.54, 0.084, -0.06, 1, 9.6, -0.26],
  [140, 98, 0.44, 0.07, -0.14, 1, 10.3, 0.3],
];
const lockOrder = (th) => clamp((248 - (th < 0 ? th + 360 : th)) / 112); // 0 crown .. 1 nape
function lockWidth(W, fork) {
  return (s) => {
    const belly = s < 0.3 ? lerp(0.72, 1, Math.sin(s / 0.3 * Math.PI / 2)) : (fork ? lerp(0.34, 1, Math.pow(Math.max(0, (1 - s) / 0.7), 0.8)) : Math.pow(Math.max(0, (1 - s) / 0.7), 0.8));
    return W * 0.5 * belly;
  };
}
// one lock: chain -> leaf outline -> cel shading + highlight streak + strand line
function drawLock(R, root, a0, len, W, hang, o) {
  const c = chain(root, 10, len / 10, { a0, hang, t: R.t, amp: o.amp, freq: o.freq, k: o.k ?? 3.6, seed: o.seed, stiff: o.stiff ?? 0.5, maxBend: o.maxBend ?? 0.42, ampPow: 1.25, curve: o.curve ?? 0, curveF: o.curveF ?? 1 });
  const fork = (o.fork ?? true) && hash1(o.seed * 3.7) > 0.78;
  const wf = lockWidth(W, fork);
  const lm = limb(c, (s) => wf(s) * 1.08, (s) => wf(s) * 0.92, { per: 3, capEnd: 0, capStart: 0.6 });
  const nA = lm.A.length;
  const e = c[c.length - 1], e2 = c[c.length - 2];
  const dA = pang(e2, e);
  const pts = lm.pts.slice();
  if (fork) {
    // two sub-tips with a notch between them
    const sideV = dirv(dA + Math.PI / 2, W * 0.17);
    pts.splice(nA, 0, { ...lm.A[nA - 1], sharp: true }, { ...padd(padd(e, dirv(dA, 0.06)), sideV), sharp: true }, { ...padd(e, dirv(dA, 0.004)), sharp: true }, { ...padd(padd(e, dirv(dA, 0.04)), sideV, -1), sharp: true }, { ...lm.B[nA - 1], sharp: true });
  } else pts.splice(nA, 0, { ...padd(e, dirv(dA + (o.curl ?? 0), 0.05)), sharp: true });
  const path = mixedPath(pts, 1);
  const m = o.m;
  const his = [];
  if (o.hi && R.detail > 0.3) {
    // short glossy streak on the lit side of the belly
    const n = lm.sp.length, i0 = Math.floor(n * 0.1), i1 = Math.floor(n * 0.36);
    const st = [];
    const lit = (lm.A[i0].x - lm.sp[i0].x) * R.light.x + (lm.A[i0].y - lm.sp[i0].y) * R.light.y > 0 ? lm.A : lm.B;
    for (let i = i0; i <= i1; i++) st.push(plerp(lit[i], lm.sp[i], 0.22));
    for (let i = i1; i >= i0; i--) st.push(plerp(lit[i], lm.sp[i], 0.22 + 0.32 * Math.sin((i - i0) / (i1 - i0) * Math.PI)));
    his.push(closedPath(st, 1));
  }
  part(R, path, m, { shadeW: 0.016, termP: limbShade(R, lm, 0.42), his, lw: o.lw ?? 1 });
  if (R.detail > 0.3) {
    const n = lm.sp.length, side = hash1(o.seed * 5.3) > 0.5 ? lm.A : lm.B;
    const fl = [];
    for (let i = Math.floor(n * 0.18); i < Math.floor(n * 0.82); i++) fl.push(plerp(lm.sp[i], side[i], 0.3 + 0.2 * Math.sin(i * 0.4 + o.seed)));
    if (fl.length > 2) ink(R, fl, R.lwIn * 1.0, { alpha: 0.85, col: m.line });
  }
  return { c, lm };
}
const o_strands = false;
function hairMass(R, K, windL) {
  const { hd, P } = K;
  const wm = Math.min(Math.hypot(windL.x, windL.y), 6);
  const hf = P.hairFloat || 0;
  const hang = hangAngle({ x: windL.x * 0.95, y: windL.y * 0.95 - hf * 1.0 }, 1);
  const amp = (0.085 + 0.04 * wm) * (1 + 0.5 * hf);
  const freq = (0.8 + 0.24 * wm) * (1 - 0.35 * hf);
  const out = [];
  for (const layer of [0, 1]) {
    for (const [th, a0d, len, W, fan, ly, seed, curve] of LOCKS) {
      if (ly !== layer) continue;
      const s = lockOrder(th);
      const root = hd.p(HC.x + Math.cos(th * D2R) * 0.072, HC.y + Math.sin(th * D2R) * 0.072);
      // float: halo fan (crown up, nape back); otherwise a gentle fan around the wind direction
      const hj = hang + lerp(fan, -(0.05 + 0.75 * s), hf);
      const r = drawLock(R, root, hd.a + a0d * D2R, len * (1 + 0.08 * hf + 0.15 * (P.whip || 0)), W * (1 + 0.1 * hf), hj, {
        m: layer ? M.hair : M.hairBack, amp: amp * lerp(0.9, 1.15, s), freq, seed, hi: layer === 1 && s < 0.7, stiff: 0.5 - 0.12 * hf, curve: curve * (1 - 0.4 * Math.min(1, wm / 5)), curveF: hash1(seed * 1.3) > 0.5 ? 2 : 1.2,
      });
      out.push(r);
    }
  }
  // two fine stray strands curling off the mass (only at larger scales)
  if (R.detail > 0.6 && o_strands) {
    for (let k = 0; k < 2; k++) {
      const base = out[5 + k].c;
      const root = base[4];
      const c = chain(root, 8, (0.2 + 0.06 * k) / 8, { a0: pang(base[3], base[5]) + (k ? -0.4 : 0.35), hang: hang + (k ? -0.5 : 0.45) - hf * 0.6, t: R.t, amp: amp * 2, freq: freq * 1.3, k: 3.4, seed: 30 + k * 2.3, stiff: 0.35, maxBend: 0.6 });
      const lm = limb(c, (s) => 0.006 * (1 - s), (s) => 0.006 * (1 - s), { per: 3, capEnd: 0, capStart: 0.2 });
      part(R, closedPath(lm.pts, 1), M.hair, { shadeW: 0.003, lw: 0.55, sheen: 0 });
    }
  }
  return out;
}
// blown_back: a few locks torn forward by the blast, arcing past both sides of the face (after the head)
function whipLocks(R, K, windL) {
  const { hd, P } = K;
  const k = P.whip || 0;
  if (k < 0.05) return;
  const hang = hangAngle({ x: windL.x, y: windL.y }, 1);
  // [u, v, len, width, hang offset, start dir (head-relative)]
  const L = [[-0.01, -0.1, 0.56, 0.066, -0.22, -0.9], [-0.05, -0.08, 0.5, 0.058, 0.04, -1.3], [-0.07, -0.02, 0.44, 0.056, 0.3, -2.2], [-0.06, 0.05, 0.4, 0.05, 0.75, 1.2]];
  L.forEach(([u, v, len, w, off, a0], i) => {
    drawLock(R, hd.p(u, v), hd.a + a0, len * k, w, hang + off, { m: i === 1 ? M.hairBack : M.hair, amp: 0.2, freq: 1.7, k: 4.2, seed: 40 + i * 1.9, stiff: 0.3, maxBend: 0.5, hi: i !== 1, fork: false, curve: i === 3 ? -0.3 : 0.25 });
  });
}
// hair cap: crown tufts, the side lock in front of the ear (frames the face, part of the same
// silhouette so it never reads as a separate tusk), short bangs (eyes are drawn over them)
function capNodes(R, K, windL) {
  const { hd, P } = K;
  const cw = Math.cos(-hd.a), sw = Math.sin(-hd.a);
  const wh = { x: windL.x * cw - windL.y * sw, y: windL.x * sw + windL.y * cw };
  const wl = Math.min(Math.hypot(windL.x, windL.y), 6);
  const C = { x: -0.012, y: -0.012 };
  const R0 = 0.108;
  const pol = (a, r) => ({ x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r });
  const CR = [[-16, 0.01, 16, 26], [-50, 0.008, 18, -16], [-86, 0.012, 18, -20], [-122, 0.012, 18, -22], [-158, 0.01, 18, -20], [168, 0.008, 16, -16], [138, 0.008, 14, -12]];
  const nodes = [];
  const t = R.t;
  CR.forEach(([th, h, hw, lean], i) => {
    const a0 = (th + hw) * D2R, a1 = (th - hw) * D2R;
    if (i === 0) nodes.push({ ...pol(a0, R0 - 0.004), b: 0 });
    const ta = (th + lean) * D2R;
    const tip = pol(ta, R0 + h);
    tip.x += wh.x * 0.006 + Math.sin(TAU * 1.2 * t + i) * 0.002 * (1 + wl * 0.3);
    tip.y += wh.y * 0.006 - P.hairFloat * 0.008;
    nodes.push({ ...tip, b: 0.008 });
    nodes.push({ ...pol(a1, R0 + 0.002), b: -0.002 });
  });
  // down behind the ear, then the side lock hanging in front of the ear past the jaw
  const hf = P.hairFloat || 0;
  const hl = clamp(((hangAngle({ x: windL.x * 0.6, y: windL.y * 0.6 - hf * 1.5 }, 1) - hd.a + Math.PI * 3) % TAU) - Math.PI, 1.2, 2.6);
  const sl = { x: Math.cos(hl) * 0.15 + Math.sin(TAU * 0.9 * t + 1.3) * 0.004 * (1 + wl * 0.4) - (-0.002), y: Math.sin(hl) * 0.15 - 0.14 };
  nodes.push({ x: -0.052, y: 0.06, b: 0.004 });
  nodes.push({ x: -0.05 + sl.x * 0.5, y: 0.13 + sl.y * 0.5, b: 0.006 });
  nodes.push({ x: -0.03 + sl.x, y: 0.2 + sl.y, b: 0.008 });                  // side-lock tip
  nodes.push({ x: -0.008 + sl.x * 0.4, y: 0.1 + sl.y * 0.4, b: -0.006 });
  nodes.push({ x: -0.004, y: 0.03, b: -0.004 });
  const sw2 = (i) => Math.sin(TAU * 1.0 * t + i * 2.1) * 0.003 * (0.5 + wl * 0.3);
  // bangs: short pointed locks ending at the upper lid
  nodes.push({ x: 0.002 + sw2(0), y: 0.026, b: 0.006 }, { x: 0.02, y: -0.036, b: -0.003 });
  nodes.push({ x: 0.036 + sw2(1), y: 0.01, b: 0.008 }, { x: 0.054, y: -0.04, b: -0.003 });
  nodes.push({ x: 0.072 + sw2(2), y: 0.006, b: 0.008 }, { x: 0.088, y: -0.044, b: -0.003 });
  nodes.push({ x: 0.112 + sw2(3) + wh.x * 0.002, y: -0.006, b: 0.01 });
  return nodes.map((p) => ({ ...hd.p(p.x, p.y), b: p.b * (hd.k || 1) }));
}


function drawHead(R, K, windL) {
  const { hd, nk, P } = K;
  // neck with the jaw's cast shadow
  const neck = [nk.p(0.042, -0.12), nk.p(0.046, 0.01), nk.p(-0.04, 0.01), nk.p(-0.044, -0.12)];
  part(R, closedPath(neck, 0.6), M.skin, { shadeW: 0.016, shadows: [closedPath([nk.p(0.05, -0.14), nk.p(0.05, -0.075), nk.p(0.0, -0.05), nk.p(-0.05, -0.085), nk.p(-0.05, -0.14)], 1)] });
  // head skin (softer jaw)
  const H = [[-0.02, -0.106], [0.05, -0.092], [0.083, -0.056], [0.093, -0.018], [0.092, 0.004], [0.098, 0.03], [0.092, 0.058], [0.078, 0.086], [{ s: 1 }, 0.056, 0.11], [0.038, 0.113], [0.014, 0.1], [-0.02, 0.076], [-0.042, 0.046], [-0.058, 0.014], [-0.094, -0.02], [-0.088, -0.076]];
  const hp = H.map((a) => (typeof a[0] === 'object' ? { ...hd.p(a[1], a[2]), sharp: true } : hd.p(a[0], a[1])));
  const headP = mixedPath(hp, 1);
  const fs = [];
  fs.push(closedPath([hd.p(-0.02, -0.05), hd.p(-0.004, 0.05), hd.p(0.012, -0.006), hd.p(0.03, 0.002), hd.p(0.046, -0.01), hd.p(0.062, 0.0), hd.p(0.078, -0.012), hd.p(0.094, -0.004), hd.p(0.12, 0.0), hd.p(0.12, -0.08), hd.p(-0.02, -0.08)], 0.5));
  fs.push(closedPath([hd.p(-0.05, -0.02), hd.p(-0.014, -0.006), hd.p(0.0, 0.054), hd.p(0.022, 0.094), hd.p(-0.005, 0.114), hd.p(-0.05, 0.08)], 1));
  part(R, headP, M.skin, { shadeW: 0.0, shadows: fs });
  // blush
  R.c.globalAlpha = 0.35; R.c.fillStyle = rgba([255, 120, 150]);
  const bl = hd.p(0.064, 0.05); R.c.beginPath(); R.c.ellipse(bl.x, bl.y, 0.014, 0.006, hd.a, 0, TAU); R.c.fill(); R.c.globalAlpha = 1;
  // slim scarf wrap under the jaw (the side lock of the cap falls over it)
  drawScarfWrap(R, K);
  // hair cap
  const cap = capNodes(R, K, windL);
  const capP = curvePath(cap, true);
  const C0 = { x: -0.012, y: -0.012 };
  const band = [];
  const NB = 10;
  for (let i = 0; i <= NB; i++) { const a = lerp(-2.7, -0.55, i / NB); band.push({ ...hd.p(C0.x + Math.cos(a) * 0.098, C0.y + Math.sin(a) * 0.098) }); }
  for (let i = NB; i >= 0; i--) { const a = lerp(-2.7, -0.55, i / NB); const r = i % 2 ? 0.07 : 0.082 + 0.004 * hash1(i); band.push({ ...hd.p(C0.x + Math.cos(a) * r, C0.y + Math.sin(a) * r), sharp: i % 2 === 1 }); }
  part(R, capP, M.hair, { shadeW: 0.022, his: [mixedPath(band, 0.6)], term: 0.32, termPts: cap });
  if (R.detail > 0.3) {
    const sl = [[0.0, -0.08, -0.08, -0.06], [0.04, -0.07, 0.06, 0.02], [0.02, -0.06, 0.03, 0.03], [-0.04, -0.06, -0.1, 0.0], [0.07, -0.06, 0.1, 0.0]];
    for (const [a, b, c2, d] of sl) ink(R, [hd.p(a, b), hd.p(lerp(a, c2, 0.5) + 0.004, lerp(b, d, 0.5)), hd.p(c2, d)], R.lwIn * 0.9, { alpha: 0.85, col: M.hair.line });
  }
  // face over hair
  const glow = R.eyeGlow;
  const open = P.eyeOpen ?? 1;
  drawEye(R, hd, 0.036, 0.014, { w: 0.05, h: 0.028, col: EYE, glow, look: 0.06 + P.look * 0.1, flick: 0.35, lashW: 1.3, fem: true, tilt: 0.06, open, creaseCol: M.skin.line });
  drawEye(R, hd, 0.088, 0.012, { w: 0.022, h: 0.026, col: EYE, glow: glow * 0.9, look: 0.1, flick: 0.12, lashW: 0.9, irisK: 0.85, fem: false, crease: false, tilt: 0.04, open });
  const bw = R.lwIn * 1.5;
  ink(R, [hd.p(0.062, -0.014 + 0.004 * P.brow), hd.p(0.04, -0.022), hd.p(0.014, -0.02)], bw, { taper: 'both' });
  ink(R, [hd.p(0.096, 0.03), hd.p(0.1, 0.043), hd.p(0.096, 0.047)], R.lwIn * 0.9, { taper: 'end', col: M.skin.line });
  const mo = P.mouth ?? (P.brow > 0.8 ? 0.4 : 0);
  ink(R, [hd.p(0.064, 0.08), hd.p(0.074, 0.08 + 0.002 * mo), hd.p(0.082, 0.078)], R.lwIn * 1.1, { taper: 'both', col: [120, 40, 60] });
  if (mo > 0.2) { const mp = closedPath([hd.p(0.066, 0.081), hd.p(0.08, 0.08), hd.p(0.074, 0.08 + 0.01 * mo)], 1); R.c.fillStyle = rgba([110, 30, 50]); R.c.fill(mp); }
}

// ------------------------------------------------------------------ main
export function drawAkane(S, o = {}) {
  const pose = resolvePose(POSES, o.pose ?? 'stand', o.poseSteps ?? 8);
  const P = { ...pose, ...(o.poseOverride || {}) };
  const R = beginChar(S, { ...o, _idle: isIdle(o.pose), rimA: o.rimA === undefined ? { color: [70, 190, 255], dir: { x: -1, y: -0.3 }, k: 0.7 } : o.rimA, rimB: o.rimB === undefined ? { color: [255, 40, 90], dir: { x: 1, y: -0.35 }, k: 1 } : o.rimB }, D.H);
  if (!R) return null;
  const K = skeleton(P);
  const windL = { x: R.wind.x + P.wind[0], y: R.wind.y + P.wind[1] };
  const castGlow = clamp(o.castGlow ?? 0);
  const scarfCut = clamp(o.scarfCut ?? 0);
  R.body = [K.headC, K.ch.p(0.02, -0.22), K.hip, K.lN.knee, K.lF.knee, K.lN.ank, K.lF.ank, K.aN.el, K.aF.el, K.aN.wr, K.aF.wr, K.nk.p(-0.3, 0.2)];
  // 1. scarf tails + back hair
  drawScarfTails(R, K, windL, scarfCut);
  hairMass(R, K, windL);
  // 2. far arm
  drawArm(R, K.aF, false, 0);
  // 3. back skirt, far leg, front skirt
  drawSkirt(R, K, 'back', windL);
  drawLeg(R, K.lF, false);
  drawSkirt(R, K, 'front', windL);
  // 4. torso, near leg through the slit, hip panel, sash
  drawTorso(R, K);
  drawLeg(R, K.lN, true);
  drawSkirt(R, K, 'hip', windL);
  drawSash(R, K, windL);
  // 5. near arm
  drawArm(R, K.aN, true, castGlow);
  // 6. head (cap, wrap, side lock, face), then hair torn forward over it
  drawHead(R, K, windL);
  whipLocks(R, K, windL);
  endChar(S, R, { ...o, auraColor: o.auraColor || [255, 40, 96] });
  const palm = fr(K.aN.wr, K.aN.ha).p(0.07, 0);
  const pts = worldPts(S, o, { head: K.headC, eye: K.hd.p(0.036, 0.014), chest: K.ch.p(0.06, -0.2), hip: K.hip, handN: K.aN.wr, handF: K.aF.wr, palm, scarfRoot: K.nk.p(-0.07, 0.02), footN: K.lN.ank, footF: K.lF.ank, top: K.hd.p(-0.02, -0.13) });
  return { pts, skeleton: K };
}
