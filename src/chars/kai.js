// KAI — lightning swordsman. drawKai(S, o): procedural anime key-frame character.
// Canonical local space: metres, x forward (facing right), y down, origin = ground between the feet.
//
// drawKai(S, { x, y, z, facing=1, pose='stand' | {a,b,k} (k quantised to 1/8 unless o.poseSteps=0), t=S.t,
//   wind={x,y} (screen-space, ~0..6), rimA={color,dir,k}, rimB, light={x,y}, eyeGlow=0.8 (>1 adds a glint
//   trail), aura=0, silhouette=0, silColor, alpha=1, smear=0 (+smearLen=1.6 m, smearDir), scale=1,
//   lineScale=1, grade=1, step (cloth fps: 24, 12 for idle poses, 0 = smooth), hold (2|3: impact holds), emitK=1, rim=1, rimWidth=1,
//   sword='sheathed'|'drawn', bladeOut=0..1, sheathT (pose 'sheath'), bladeGlow, poseOverride:{...} })
// Poses: stand, iai_ready, dash, slash_end, sheath (3/4 back). Returns { pts:{eye,head,top,chest,hip,handN,handF,
//   grip,tsuba,bladeTip,koiguchi,footN,footF} each {x,y,z (world m), sx,sy (screen px), s}, skeleton }.
import { TAU, clamp, lerp, smoothstep, rgba, noise2, hash1 } from '../core/math.js';
import {
  Fr, fr, pt, plerp, padd, pdist, pang, dirv, ik2, resolvePose, target, spline, closedPath, mixedPath, polyP, prof, limb, limbShade,
  chain, hangAngle, mat, beginChar, endChar, part, ink, emitFill, emitStroke, drawEye, drawHand, INKS, toRGB, curvePath, capsulePush, sheet,
  outside, outsidePath, worldPts, castShadow, isIdle, termPath,
} from './rig.js';

// ------------------------------------------------------------------ palette (near-black darks: ref7 values)
const M = {
  skin: mat([250, 226, 216], [206, 160, 178], [255, 246, 240], { rimMul: 0.75, line: [160, 90, 100] }),
  skinD: mat([214, 172, 186], [176, 128, 152], null, { line: [140, 80, 96] }),
  coat: mat([238, 242, 253], [128, 142, 206], [255, 255, 255], { deep: [96, 104, 170], line: [118, 128, 190] }),
  lining: mat([150, 158, 212], [98, 106, 172], null, { rimMul: 0.75, deep: [70, 76, 134], line: [76, 84, 150] }),
  shirt: mat([26, 27, 44], [12, 12, 24], [70, 82, 136], { line: [6, 6, 14] }),
  pants: mat([24, 25, 40], [12, 12, 22], [64, 74, 124], { deep: [6, 6, 14], line: [6, 6, 13] }),
  boot: mat([22, 22, 36], [10, 10, 18], [110, 122, 176]),
  sole: mat([12, 12, 20], [6, 6, 12]),
  belt: mat([20, 20, 32], [9, 9, 16], [110, 116, 150]),
  hair: mat([22, 24, 40], [8, 9, 20], [60, 90, 170], { rimMul: 0.5, line: [40, 60, 120], deep: [4, 5, 12] }),
  hairU: mat([14, 15, 28], [6, 6, 14], null, { rimMul: 0.3, line: [30, 44, 96] }),
  saya: mat([22, 22, 34], [8, 8, 15], [150, 164, 224]),
  ito: mat([230, 234, 248], [148, 154, 198]),
  same: mat([210, 214, 226], [150, 154, 176]),
  tsuba: mat([44, 44, 60], [20, 20, 30], [210, 218, 236]),
  silver: mat([206, 214, 234], [122, 128, 160], [255, 255, 255]),
  sageo: mat([46, 120, 245], [22, 54, 168], [150, 210, 255], { emitMul: 0.5 }),
  blade: mat([222, 232, 248], [146, 158, 196], [255, 255, 255]),
  collarIn: mat([150, 158, 212], [104, 112, 176]),
  habaki: mat([220, 196, 150], [150, 120, 90], [255, 240, 210]),
};
const EYE = [70, 228, 255];
const HAND_K = 1.12;

// ------------------------------------------------------------------ proportions
const D = { thigh: 0.47, shin: 0.45, lumbar: 0.17, chestL: 0.36, neck: 0.085, headUp: 0.11, upper: 0.30, fore: 0.27,
  blade: 0.72, tsuka: 0.255, saya: 0.76, H: 1.8 };

// ------------------------------------------------------------------ poses (canonical, facing right)
// hand/foot targets in metres; 'saya' / 'tsuka' are anchors on the katana.
const BASE = {
  hip: [0, -0.985], pelvis: 0.04, spine: 0.03, chest: 0.0, neck: 0.05, head: 0.06,
  footN: [-0.17, -0.085], footNa: 0, footF: [0.21, -0.085], footFa: 0.04, kneeN: -1, kneeF: -1,
  handN: 'saya', handF: [0.07, -0.92], elbowN: 1, elbowF: 1, handFa: 1.72, handNa: 1.7,
  shapeN: 'sayaGrip', shapeF: 'relaxed', sayaA: 0.42, swordA: -0.35, wind: [0, 0], view: 0, look: 0.0,
  coatFlare: 0, brow: 0.5, hairLift: 0, mouth: 0,
};
const POSES = {
  // standoff: tall, weight back, chest open, head lowered (looking from under the brows)
  stand: { ...BASE, hip: [-0.02, -0.99], pelvis: -0.04, spine: -0.05, chest: 0.06, neck: 0.12, head: 0.1,
    footN: [-0.22, -0.085], footF: [0.24, -0.085], footFa: 0.08, handF: [0.03, -0.93], handFa: 1.66, brow: 0.8 },
  iai_ready: { ...BASE,
    hip: [-0.1, -0.6], pelvis: 0.32, spine: 0.62, chest: 0.06, neck: -0.32, head: -0.3,
    footN: [-0.68, -0.07], footNa: 0.7, footF: [0.47, -0.085], footFa: 0.0, kneeN: -1, kneeF: -1,
    handN: 'saya', handF: 'tsuka', shapeF: 'grip', elbowF: 1, sayaA: 0.36, wind: [-0.7, -0.1], coatFlare: 0.35, brow: 1, look: 0.25 },
  // body one horizontal line, face low
  dash: { ...BASE,
    hip: [0.1, -0.5], pelvis: 1.0, spine: 1.45, chest: 0.05, neck: -0.45, head: -0.42,
    footN: [-1.2, -0.35], footNa: 1.35, footF: [0.1, -0.2], footFa: 1.05, kneeN: -1, kneeF: -1,
    handN: 'saya', handF: 'tsuka', shapeF: 'grip', sayaA: 0.3, wind: [-5.5, -0.4], coatFlare: 0.6, brow: 1, look: 0.3, hairLift: 1, mouth: 0.5 },
  // back foot, spine, sword arm and blade in one low diagonal
  slash_end: { ...BASE,
    hip: [0.05, -0.42], pelvis: 0.35, spine: 0.7, chest: 0.15, neck: -0.4, head: -0.28,
    footN: [-0.95, -0.05], footNa: 1.3, footF: [0.66, -0.085], footFa: 0.0, kneeN: -1, kneeF: -1,
    handN: 'saya', handF: [-0.9, -1.25], elbowF: -1, shapeF: 'grip', swordA: -2.85, sayaA: 0.3,
    wind: [-2.6, -1.0], coatFlare: 0.8, brow: 1, look: -0.1, hairLift: 0.7, shF: -0.11, shN: 0.09, mouth: 0.35 },
  // 3/4 back view: only the raised elbow and the tsuka end break the silhouette; kojiri down-back
  sheath: { ...BASE,
    hip: [0, -0.985], pelvis: 0.02, spine: 0.04, chest: 0.02, neck: 0.16, head: 0.22,
    footN: [-0.12, -0.085], footF: [0.16, -0.085],
    handN: 'saya', handF: 'tsuka', shapeF: 'grip', elbowF: -1, sayaA: 0.6, view: 1, wind: [0, 0], brow: 0.3 },
};
export const KAI_POSES = POSES;

// ------------------------------------------------------------------ skeleton
function skeleton(P, o) {
  const hip = pt(P.hip[0], P.hip[1]);
  const pel = fr(hip, P.pelvis);
  const sp = fr(hip, P.spine);
  const waist = sp.p(0, -D.lumbar);
  const chA = P.spine + P.chest;
  const ch = fr(waist, chA);
  const neckB = ch.p(0.012, -D.chestL);
  const nkA = chA + P.neck;
  const nk = fr(neckB, nkA);
  const hdA = nkA + P.head;
  const headC = nk.p(0.02, -(D.neck + D.headUp));
  const hd = fr(headC, hdA, 1.07);
  const shN = ch.p(P.shN ?? -0.088, -0.298), shF = ch.p(P.shF ?? 0.118, -0.298);
  const hipN = pel.p(-0.02, 0.0), hipF = pel.p(0.04, -0.012);
  const back = P.view > 0.5;
  // katana on the near hip; the saya only partly follows the pelvis so it stays near horizontal in a lean
  const sayaDirA = P.pelvis * 0.35 + Math.PI - P.sayaA;     // koiguchi -> kojiri
  const tsukaDirA = sayaDirA + Math.PI;                      // forward-up
  const koi = back ? pel.p(0.07, -0.06) : pel.p(0.125, -0.06);
  let sword = o.sword === 'drawn' ? 'drawn' : 'sheathed';
  let bladeOut = sword === 'sheathed' ? clamp(o.bladeOut ?? 0) : 0;
  if (back || o._pose === 'sheath') { sword = 'sheathed'; bladeOut = 1 - clamp(o.sheathT ?? 0.5); }
  const fs = back ? 0.35 : 1;   // foreshortening of the katana axis in the back view (it points into the screen)
  const td = dirv(tsukaDirA);
  const tsubaS = padd(koi, td, 0.012 + bladeOut * D.blade * fs);
  const anchors = {
    saya: padd(koi, dirv(sayaDirA), 0.05),
    tsuka: padd(tsubaS, td, 0.092 * fs + (back ? 0.02 : 0)),
    hip: pel.p(0.0, -0.05),
    thighF: pel.p(0.12, 0.1),
  };
  // legs
  const ankN = target(P.footN, anchors), ankF = target(P.footF, anchors);
  const lN = ik2(hipN, ankN, D.thigh, D.shin, P.kneeN);
  const lF = ik2(hipF, ankF, D.thigh, D.shin, P.kneeF);
  // arms (grip hands: IK to a wrist point offset from the grip toward the shoulder)
  const arm = (sh, tg, bend, shape) => {
    let wristT = tg, grip = null;
    const off = 0.066;
    if (shape === 'grip' || shape === 'sayaGrip') {
      grip = tg;
      const d = pdist(sh, tg) || 1;
      wristT = { x: tg.x + (sh.x - tg.x) / d * off, y: tg.y + (sh.y - tg.y) / d * off };
    }
    const r = ik2(sh, wristT, D.upper, D.fore, bend);
    if (grip && pdist(r.e, wristT) > 0.003) { const d = pdist(sh, r.e) || 1; grip = { x: r.e.x - (sh.x - r.e.x) / d * off, y: r.e.y - (sh.y - r.e.y) / d * off }; }
    return { sh, el: r.j, wr: r.e, grip };
  };
  const aN = arm(shN, target(P.handN, anchors), P.elbowN, P.shapeN);
  const aF = arm(shF, target(P.handF, anchors), P.elbowF, P.shapeF);
  return { P, hip, pel, sp, waist, ch, neckB, nk, headC, hd, shN, shF, hipN, hipF, lN: { hip: hipN, knee: lN.j, ank: lN.e, fa: P.footNa }, lF: { hip: hipF, knee: lF.j, ank: lF.e, fa: P.footFa },
    aN, aF, koi, sayaDirA, tsukaDirA, tsubaS, bladeOut, sword, anchors, fs, back };
}

// ------------------------------------------------------------------ parts: legs
function drawLeg(R, L, near) {
  const { hip, knee, ank, fa } = L;
  const ft = fr(ank, fa);
  // boot shaft + foot (one silhouette)
  const shinDirA = pang(knee, ank);
  const sf = fr(ank, shinDirA - Math.PI / 2); // u = forward-ish (perp to shin), v = down the shin
  const bootTop = plerp(knee, ank, 0.42);
  const bt = fr(bootTop, shinDirA - Math.PI / 2);
  const boot = [
    bt.p(-0.062, 0.0), bt.p(0.056, -0.004),
    sf.p(0.05, -0.07), ft.p(0.06, -0.012), ft.p(0.13, 0.018), ft.p(0.2, 0.05), ft.p(0.205, 0.075),
    { ...ft.p(0.17, 0.088), sharp: true }, { ...ft.p(-0.04, 0.088), sharp: true }, ft.p(-0.062, 0.05), ft.p(-0.06, 0.0), sf.p(-0.058, -0.06),
  ];
  const bootP = mixedPath(boot, 1);
  const sole = polyP([ft.p(-0.07, 0.07), ft.p(0.22, 0.066), ft.p(0.22, 0.12), ft.p(-0.07, 0.12)]);
  const hiB = R.detail > 0.5 ? closedPath([bt.p(0.03, 0.02), sf.p(0.034, -0.08), sf.p(0.04, -0.07), bt.p(0.04, 0.03)]) : null;
  part(R, bootP, M.boot, { shadeW: 0.02, term: 0.45, termPts: boot, deep: [sole], his: [hiB, closedPath([ft.p(0.1, 0.022), ft.p(0.17, 0.04), ft.p(0.16, 0.046), ft.p(0.09, 0.03)])] });
  // trousers: hip -> knee -> boot top (bunched hem)
  const kn = knee;
  const hem = plerp(knee, ank, 0.5);
  const pts = [hip, plerp(hip, kn, 0.5), kn, plerp(kn, hem, 0.6), hem];
  const wA = prof([[0, 0.1], [0.22, 0.092], [0.48, 0.066], [0.62, 0.074], [0.82, 0.07], [1, 0.076]]);
  const wB = prof([[0, 0.075], [0.25, 0.086], [0.48, 0.064], [0.7, 0.06], [0.9, 0.066], [1, 0.074]]);
  const lm = limb(pts, wA, wB, { per: 6, capEnd: 0.15, capStart: 0.6 });
  const pathL = closedPath(lm.pts, 1);
  const bendAmt = Math.abs(((pang(kn, ank) - pang(hip, kn) + Math.PI) % TAU + TAU) % TAU - Math.PI);
  const shadows = [];
  const n = lm.sp.length;
  const kA = lm.A[Math.floor(n * 0.48)];
  shadows.push(closedPath([kA, plerp(kA, kn, 0.6), lm.A[Math.floor(n * 0.62)], lm.A[Math.floor(n * 0.36)]]));
  // bunching at the boot top
  shadows.push(closedPath([lm.A[n - 4], plerp(lm.A[n - 3], lm.B[n - 3], 0.55), lm.B[n - 2], lm.B[n - 1], lm.A[n - 1]], 0.6));
  part(R, pathL, M.pants, { shadeW: 0.015, shadows, termP: limbShade(R, lm, 0.5) });
  if (R.detail > 0.3) {
    const at = (i, side, k) => { const a = lm.A[i], b = lm.B[i]; return side ? plerp(b, a, k) : plerp(a, b, k); };
    const iK = Math.floor(n * 0.5);
    const fw = R.lwIn * 1.3, col = M.pants.line;
    ink(R, [at(iK - 2, 0, 0.05), at(iK, 0, 0.35), at(iK + 1, 0, 0.42)], fw * (0.8 + bendAmt), { col });
    ink(R, [at(iK + 3, 0, 0.0), at(iK + 4, 0, 0.3)], fw, { col });
    ink(R, [at(Math.floor(n * 0.2), 1, 0.05), at(Math.floor(n * 0.3), 1, 0.3), at(Math.floor(n * 0.38), 1, 0.36)], fw * 0.9, { col });
    ink(R, [at(n - 3, 0, 0.1), at(n - 2, 0, 0.45), at(n - 3, 0, 0.75)], fw, { col });
    ink(R, [at(Math.floor(n * 0.75), 1, 0.0), at(Math.floor(n * 0.82), 1, 0.35)], fw * 0.8, { col });
    // glint along the thigh front (lit side)
    const hl = [at(Math.floor(n * 0.08), 1, 0.1), at(Math.floor(n * 0.25), 1, 0.13), at(Math.floor(n * 0.4), 1, 0.11)];
    ink(R, hl, R.lwIn * 1.4, { col: M.pants.hi, alpha: 0.6 });
  }
  return { path: pathL, lm };
}

// ------------------------------------------------------------------ parts: hands
// Gripping fist around a handle. F: u along the handle, +v away from the wrist (finger side).
// ix = +1/-1: the u side of the index finger (toward the guard). thumb: 'wrap' | {tip:{x,y}} (press point)
function gripHand(R, F, ix, m, mD, thumb, front = false) {
  const G = new Fr(F.x, F.y, F.a, HAND_K);
  const P = (u, v) => G.p(u * ix, v);
  const tipOff = [0.006, 0.002, -0.002, -0.006]; // index .. pinky
  const uc = [0.033, 0.011, -0.011, -0.033];
  if (front) {
    // far hand seen from the fingertip side: palm heel behind, four fingers curled over the handle
    // toward us (no knuckle row), thumb hooked over the index from the far side
    const heel = [P(-0.052, -0.036), P(0.046, -0.04), P(0.052, -0.006), P(-0.05, -0.002)];
    part(R, closedPath(heel, 1), mD, { shadeW: 0.008, lw: 0.8 });
    for (let f = 3; f >= 0; f--) {
      const c = uc[f], vt = 0.03 + tipOff[f];
      const lz = [P(c - 0.0118, -0.026), P(c + 0.0116, -0.026), P(c + 0.0122, vt - 0.01), P(c + 0.005, vt + 0.003), P(c - 0.005, vt + 0.003), P(c - 0.0122, vt - 0.01)];
      part(R, closedPath(lz, 0.9), m, { shadeW: 0.006, lw: 0.75, termPts: lz, term: 0.4 });
      if (R.detail > 0.6) ink(R, [P(c - 0.008, vt - 0.016), P(c, vt - 0.013), P(c + 0.008, vt - 0.016)], R.lwIn * 0.6, { col: m.line, alpha: 0.7 });
    }
    const tp = [P(0.05, -0.034), P(0.062, -0.012), P(0.05, 0.012), P(0.036, 0.016)];
    const lm = limb(tp, (q) => 0.0118 * HAND_K * (1 - 0.3 * q), (q) => 0.0118 * HAND_K * (1 - 0.3 * q), { per: 4, capEnd: 0.9, capStart: 0.4 });
    part(R, closedPath(lm.pts, 1), m, { shadeW: 0.006, lw: 0.8, termP: limbShade(R, lm, 0.4) });
    return;
  }
  // middle phalanges wrapped round the handle, pinky first
  for (let f = 3; f >= 0; f--) {
    const c = uc[f], vt = 0.046 + tipOff[f];
    const lz = [P(c - 0.0115, -0.004), P(c + 0.0112, -0.004), { ...P(c + 0.0118, vt - 0.012), sharp: false }, P(c + 0.006, vt), P(c - 0.004, vt + 0.001), P(c - 0.0118, vt - 0.01)];
    part(R, closedPath(lz, 0.9), m, { shadeW: 0.006, lw: 0.75, termPts: lz, term: 0.35 });
  }
  // back of the hand with a sharp knuckle row along its finger edge (shade tone)
  const bk = [P(-0.05, -0.004), { ...P(-0.044, 0.006), sharp: true }, P(-0.033, 0.012), { ...P(-0.022, 0.006), sharp: true }, P(-0.011, 0.013), { ...P(0.0, 0.006), sharp: true },
    P(0.011, 0.014), { ...P(0.022, 0.006), sharp: true }, P(0.034, 0.015), { ...P(0.047, 0.004), sharp: true },
    P(0.052, -0.022), P(0.036, -0.05), P(0.0, -0.058), P(-0.034, -0.052), P(-0.052, -0.03)];
  part(R, mixedPath(bk, 0.9), mD, { shadeW: 0.01, lw: 0.85, his: [closedPath([P(-0.03, -0.036), P(0.02, -0.044), P(0.02, -0.038), P(-0.03, -0.03)], 0.6)] });
  if (R.detail > 0.6) ink(R, [P(-0.02, -0.02), P(0.012, -0.026), P(0.032, -0.018)], R.lwIn * 0.7, { col: mD.line, alpha: 0.6 });
  // thumb (drawn last, over the index)
  let tp;
  if (thumb && thumb.tip) {
    // press point given in local metres: run the thumb along the handle to it
    const tip = thumb.tip;
    const root = P(0.03, -0.036), mid = plerp(root, tip, 0.5);
    const nrm = { x: -(tip.y - root.y), y: tip.x - root.x }; const nl = Math.hypot(nrm.x, nrm.y) || 1;
    const vdir = G.d(0, -1); const sgn = (nrm.x * vdir.x + nrm.y * vdir.y) > 0 ? 1 : -1;
    tp = [root, padd(mid, { x: nrm.x / nl * sgn, y: nrm.y / nl * sgn }, 0.01), tip];
  } else tp = [P(0.022, -0.04), P(0.05, -0.022), P(0.054, 0.004), P(0.044, 0.026)];
  const lm = limb(tp, (s) => 0.0125 * HAND_K * (1 - 0.25 * s), (s) => 0.0125 * HAND_K * (1 - 0.25 * s), { per: 4, capEnd: 0.9, capStart: 0.4 });
  part(R, closedPath(lm.pts, 1), m, { shadeW: 0.006, lw: 0.8, termP: limbShade(R, lm, 0.4) });
  if (R.detail > 0.6) { const q = lm.sp[Math.floor(lm.sp.length * 0.75)]; ink(R, [padd(q, G.d(0.004, -0.006)), padd(q, G.d(-0.004, 0.006))], R.lwIn * 0.6, { col: m.line, alpha: 0.7 }); }
}
function drawGripHand(R, grip, axisA, wrist, guardDir, m, thumb, front = false) {
  // v must point away from the wrist
  let F = fr(grip, axisA);
  const toW = { x: wrist.x - grip.x, y: wrist.y - grip.y };
  const vv = F.d(0, 1);
  if (vv.x * toW.x + vv.y * toW.y > 0) F = new Fr(grip.x, grip.y, axisA + Math.PI);
  const u = F.d(1, 0);
  const ix = (u.x * guardDir.x + u.y * guardDir.y) >= 0 ? 1 : -1;
  gripHand(R, F, ix, m, M.skinD, thumb, front);
}

// ------------------------------------------------------------------ parts: arms
function drawSleeve(R, a, near) {
  const { sh, el, wr } = a;
  const pts = [sh, plerp(sh, el, 0.5), el, plerp(el, wr, 0.5), wr];
  const wA = prof([[0, 0.06], [0.3, 0.053], [0.5, 0.05], [0.75, 0.048], [1, 0.05]]);
  const wB = prof([[0, 0.056], [0.3, 0.051], [0.5, 0.049], [0.75, 0.046], [1, 0.05]]);
  const lm = limb(pts, wA, wB, { per: 6, capEnd: 0.1, capStart: 0.45 });
  const path = closedPath(lm.pts, 1);
  const n = lm.sp.length, iE = Math.floor(n * 0.5);
  const sh2 = [];
  // inner-elbow fold shadow (side depends on bend)
  const bendS = Math.sign(((pang(el, wr) - pang(sh, el) + Math.PI) % TAU + TAU) % TAU - Math.PI) || 1;
  const S1 = bendS > 0 ? lm.B : lm.A;
  sh2.push(closedPath([S1[iE - 4], S1[iE], S1[iE + 4], plerp(S1[iE], lm.sp[iE], 0.6)]));
  const m = near ? M.coat : M.lining;
  part(R, path, m, { shadeW: 0.018, shadows: sh2, termP: limbShade(R, lm, 0.45) });
  if (R.detail > 0.3) {
    const at = (i, side, k) => plerp(side ? lm.B[i] : lm.A[i], lm.sp[i], k);
    const fw = R.lwIn * 1.2, col = m.line;
    const s1 = bendS > 0 ? 1 : 0;
    ink(R, [at(iE - 3, s1, 0.0), at(iE - 1, s1, 0.45), at(iE + 1, s1, 0.6)], fw, { col });
    ink(R, [at(iE + 1, s1, 0.0), at(iE + 3, s1, 0.5)], fw * 0.9, { col });
    ink(R, [at(iE - 6, 1 - s1, 0.0), at(iE - 5, 1 - s1, 0.35)], fw * 0.8, { col });
    ink(R, [at(Math.floor(n * 0.15), s1, 0.05), at(Math.floor(n * 0.25), s1, 0.4)], fw * 0.8, { col });
    ink(R, [at(n - 6, 1 - s1, 0.0), at(n - 4, 1 - s1, 0.4)], fw * 0.8, { col });
    // zig-zag compression folds on the forearm
    ink(R, [at(iE + 4, s1, 0.05), at(iE + 6, s1, 0.55), at(iE + 7, 1 - s1, 0.7)], fw * 0.85, { col, alpha: 0.9 });
    ink(R, [at(n - 9, 1 - s1, 0.05), at(n - 8, 1 - s1, 0.5), at(n - 7, s1, 0.75)], fw * 0.75, { col, alpha: 0.85 });
  }
  return lm;
}
function drawCuff(R, a, near) {
  const A = pang(a.el, a.wr);
  const F = fr(a.wr, A);
  const pts = [F.p(-0.05, -0.04), F.p(0.0, -0.042), F.p(0.009, 0.0), F.p(0.0, 0.042), F.p(-0.05, 0.04)];
  const m = near ? M.coat : M.lining;
  part(R, closedPath(pts, 1), m, { shadeW: 0.012, term: 0.4, termPts: pts });
  ink(R, [F.p(-0.04, -0.038), F.p(-0.042, 0.0), F.p(-0.04, 0.038)], R.lwIn * 0.9, { col: m.line, alpha: 0.8 });
}
function drawHandFree(R, a, shape, ang) {
  drawHand(R, fr(a.wr, ang), shape, M.skin, { k: HAND_K * 0.95 });
}

// ------------------------------------------------------------------ katana
function drawSaya(R, K, fs = 1) {
  const sd = K.sayaDirA;
  const F = fr(K.koi, sd); // u: toward kojiri, v: perpendicular
  const L = D.saya * fs;
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) { const f = i / N; pts.push(F.p(f * L, -0.03 * Math.sin(f * Math.PI) * (L / D.saya))); }
  const lm = limb(pts, (s) => 0.019 - s * 0.003, (s) => 0.019 - s * 0.003, { per: 2, capEnd: 0.6, capStart: 0.05 });
  const path = closedPath(lm.pts, 1);
  // long lacquer highlight streak
  const nB = lm.B.length;
  part(R, path, M.saya, { shadeW: 0.008, his: [closedPath([...lm.B.slice(2, nB - 4).map((p, i) => plerp(p, lm.sp[i + 2], 0.25)), ...lm.B.slice(2, nB - 4).reverse().map((p, i) => plerp(p, lm.sp[nB - 5 - i], 0.62))], 1)] });
  // kojiri cap
  const kj = fr(pts[N], sd);
  part(R, closedPath([kj.p(-0.04, -0.02), kj.p(0.008, -0.02), kj.p(0.018, 0), kj.p(0.008, 0.02), kj.p(-0.04, 0.02)], 0.8), M.silver, { shadeW: 0.006, lw: 0.8 });
  // koiguchi collar
  const kg = fr(K.koi, sd);
  part(R, closedPath([kg.p(-0.002, -0.022), kg.p(0.03, -0.022), kg.p(0.03, 0.022), kg.p(-0.002, 0.022)], 0.4), M.silver, { shadeW: 0.006, lw: 0.8 });
  return { F, pts };
}
function drawSageo(R, K, sk) {
  // blue cord: tied at the kurikata, loops down, tails dangle with wind
  const sd = K.sayaDirA;
  const F = fr(K.koi, sd);
  const root = F.p(0.13, 0.02);
  const hang = hangAngle({ x: R.wind.x * 0.5 + sk.windX * 0.35, y: R.wind.y * 0.3 }, 1.2);
  const c1 = chain(root, 6, 0.04, { a0: sd + 1.2, hang, t: R.t, amp: 0.25, freq: 1.4, k: 3, seed: 2.1, stiff: 0.5 });
  const c2 = chain(F.p(0.2, 0.02), 6, 0.034, { a0: sd + 1.1, hang, t: R.t, amp: 0.3, freq: 1.5, k: 3, seed: 4.7, stiff: 0.5 });
  for (const c of [c2, c1]) {
    const lm = limb(c, 0.008, 0.008, { per: 3 });
    part(R, closedPath(lm.pts, 1), M.sageo, { shadeW: 0.005, lw: 0.6 });
  }
  // wrap band on the saya
  const wr = [F.p(0.11, -0.024), F.p(0.21, -0.022), F.p(0.21, 0.022), F.p(0.11, 0.024)];
  part(R, closedPath(wr, 0.5), M.sageo, { shadeW: 0.006, lw: 0.6 });
  if (R.detail > 0.5) for (let i = 0; i < 5; i++) { const u = 0.12 + i * 0.02; ink(R, [F.p(u, -0.02), F.p(u + 0.012, 0.02)], R.lwIn * 0.8, { alpha: 0.7 }); }
}
// tsuba + tsuka at a given guard position, tsuka direction ang; fs foreshortens the handle
function drawHilt(R, tsuba, ang, fs = 1) {
  const F = fr(tsuba, ang);
  const L = D.tsuka * fs;
  const tp = [F.p(0.012, -0.02), F.p(L * 0.5, -0.018), F.p(L, -0.019), F.p(L + 0.012, -0.012), F.p(L + 0.014, 0.012), F.p(L, 0.019), F.p(L * 0.5, 0.018), F.p(0.012, 0.02)];
  const tsP = closedPath(tp, 0.5);
  part(R, tsP, M.same, { shadeW: 0.006, lw: 0.8 });
  // ito diamonds
  const c = R.c;
  c.save(); c.clip(tsP);
  const nD = Math.max(3, Math.round(6 * fs));
  const dl = (L - 0.04) / nD;
  for (let i = 0; i < nD; i++) {
    const u0 = 0.03 + i * dl;
    const p1 = closedPath([F.p(u0 - dl * 0.05, -0.024), F.p(u0 + dl * 0.5, -0.002), F.p(u0 + dl * 1.05, -0.024)], 0.2);
    const p2 = closedPath([F.p(u0 - dl * 0.05, 0.024), F.p(u0 + dl * 0.5, 0.002), F.p(u0 + dl * 1.05, 0.024)], 0.2);
    part(R, p1, M.ito, { shadeW: 0.004, lw: 0.55 });
    part(R, p2, M.ito, { shadeW: 0.004, lw: 0.55 });
  }
  c.restore();
  // kashira (pommel cap)
  part(R, closedPath([F.p(L - 0.004, -0.021), F.p(L + 0.016, -0.016), F.p(L + 0.02, 0), F.p(L + 0.016, 0.016), F.p(L - 0.004, 0.021)], 0.8), M.tsuba, { shadeW: 0.005, lw: 0.7 });
  // fuchi collar
  part(R, closedPath([F.p(0.006, -0.022), F.p(0.026, -0.022), F.p(0.026, 0.022), F.p(0.006, 0.022)], 0.4), M.tsuba, { shadeW: 0.004, lw: 0.7 });
  // tsuba (round guard seen nearly edge-on; rounder when foreshortened)
  const rx = lerp(0.03, 0.012, fs);
  const tb = new Path2D(); tb.ellipse(tsuba.x, tsuba.y, rx, 0.045, ang, 0, TAU);
  part(R, tb, M.tsuba, { shadeW: 0.006, lw: 0.9, his: [(() => { const h = new Path2D(); h.ellipse(tsuba.x, tsuba.y, rx * 0.6, 0.042, ang, -1.2, 0.5); h.ellipse(tsuba.x, tsuba.y, rx * 0.33, 0.034, ang, 0.5, -1.2, true); return h; })()] });
  return F;
}
function drawBlade(R, base, ang, len, glowK, partial) {
  // base = habaki position, blade toward ang, slight sori toward -v
  const F = fr(base, ang);
  const N = 12;
  const back = [], edge = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N; const u = f * len;
    const sori = -0.022 * Math.sin(f * Math.PI * 0.9) * (len / D.blade);
    const w = 0.0145 * (1 - 0.25 * f);
    back.push(F.p(u, sori - w));
    edge.push(F.p(u, sori + w * 0.85));
  }
  const tip = partial ? null : F.p(len + 0.03, -0.012);
  const pts = partial ? [...back, ...edge.slice().reverse()] : [...back, { ...tip, sharp: true }, ...edge.slice().reverse()];
  const path = mixedPath(pts.map((p, i) => (i === 0 || i === pts.length - 1) ? { ...p, sharp: true } : p), 0.6);
  // hamon / shinogi split: lower half brighter
  const hamon = [];
  for (let i = 0; i <= N; i++) { const f = i / N; const u = f * len; const sori = -0.022 * Math.sin(f * Math.PI * 0.9) * (len / D.blade); hamon.push(F.p(u, sori + 0.002 + 0.003 * Math.sin(f * 40))); }
  const hiP = closedPath([...hamon, ...edge.slice().reverse()], 0.5);
  part(R, path, M.blade, { shadeW: 0, lw: 0.8, his: [hiP], rimInner: 0.6 });
  ink(R, hamon, R.lwIn * 0.6, { col: [120, 130, 170], alpha: 0.6, taper: 'none' });
  // habaki
  part(R, closedPath([F.p(-0.004, -0.019), F.p(0.03, -0.017), F.p(0.03, 0.015), F.p(-0.004, 0.017)], 0.4), M.habaki, { shadeW: 0.005, lw: 0.6 });
  if (glowK > 0 && R.emitK > 0) {
    // energy along the edge: soft wide band -> hot line -> white core (bloomed by the compositor)
    emitStroke(R, polyP(edge, false), [40, 120, 255], Math.max(R.px * 6, 0.02), 0.35 * glowK);
    emitStroke(R, polyP(edge, false), [120, 220, 255], Math.max(R.px * 2.5, 0.007), 0.85 * glowK);
    emitStroke(R, polyP(edge, false), [235, 252, 255], Math.max(R.px * 1.2, 0.0025), glowK);
  }
  return F;
}

// ------------------------------------------------------------------ coat (cloth panels)
function drawCoatSkirt(R, K, layer, windL) {
  const { pel, P } = K;
  const wm = Math.hypot(windL.x, windL.y);
  // gravity dominates gentle wind; strong wind streams the coat out
  const hang = hangAngle({ x: windL.x * 0.5, y: windL.y * 0.5 }, 1);
  const amp = 0.07 + 0.045 * Math.min(wm, 6) + P.coatFlare * 0.05;
  const freq = 0.8 + 0.28 * Math.min(wm, 6);
  const down = pel.a + Math.PI / 2;
  const ground = P.view > 0.5 ? null : -0.004;
  const n = 10;
  const ch = (root, a0, len, hangOff, seed, collide, ampK = 1) => chain(root, n, len / n, {
    a0, hang: hang + hangOff, t: R.t, amp: amp * ampK, freq, k: 3.6, seed, stiff: 0.62 - P.coatFlare * 0.25, ground, maxBend: 0.42, collide, ampPow: 1.4,
  });
  const lN = K.lN, lF = K.lF;
  const frontCol = (p) => capsulePush(p, lF.hip, lF.knee, 0.105) || capsulePush(p, lN.hip, lN.knee, 0.105);
  const fk = clamp(wm / 2.5 + P.coatFlare * 0.5);   // flare grows with wind
  if (layer === 'back') {
    const A = ch(pel.p(-0.04, -0.11), down + 0.12 + 0.12 * fk, 0.82, 0.04 + 0.08 * fk, 1.3, null, 1.1);
    const B = ch(pel.p(-0.15, -0.1), down + 0.22 + 0.3 * fk, 0.92, 0.1 + 0.22 * fk, 2.1, null, 1.25);
    return sheet(R, A, B, { m: M.lining, cols: 6, freq, seed: 1, ripple: 0.2, shadeW: 0.03, term: 0.35, tuck: 0.04 });
  } else if (layer === 'farFront') {
    const A = ch(pel.p(0.155, -0.11), down - 0.1, 0.7, -0.06, 3.3, frontCol, 0.8);
    const B = ch(pel.p(0.08, -0.11), down - 0.0, 0.74, 0.0, 3.9, frontCol, 0.9);
    return sheet(R, A, B, { m: M.lining, cols: 2, freq, seed: 3, ripple: 0.1, tuck: 0 });
  } else if (layer === 'nearSide') {
    const A = ch(pel.p(0.03, -0.11), down + 0.02 + 0.04 * fk, 0.8, 0.03 + 0.05 * fk, 4.4, null, 0.95);
    const B = ch(pel.p(-0.152, -0.1), down + 0.16 + 0.28 * fk, 0.94, 0.08 + 0.2 * fk, 5.9, null, 1.15);
    return sheet(R, A, B, { m: M.coat, cols: 6, freq, seed: 5, ripple: 0.2, deepEdge: true, term: 0.4, lining: M.lining, tuck: 0.045 });
  } else if (layer === 'nearFront') {
    const A = ch(pel.p(0.088, -0.11), down - 0.05, 0.74, 0.0, 5.1, frontCol, 0.85);
    const B = ch(pel.p(0.03, -0.11), down + 0.02, 0.79, 0.04, 4.4, null, 0.95);
    return sheet(R, A, B, { m: M.coat, cols: 2, freq, seed: 7, ripple: 0.1, shadeW: 0.025, edgeLining: M.lining, tuck: 0 });
  } else if (layer === 'backL' || layer === 'backR') {
    // back view: two long tails split by the centre vent, hanging over both legs
    const L = layer === 'backL';
    const A = L ? ch(pel.p(-0.0, -0.12), down + 0.04, 0.84, 0.05, 6.4, null, 1.0) : ch(pel.p(0.14, -0.12), down - 0.06, 0.8, -0.02, 7.7, null, 0.9);
    const B = L ? ch(pel.p(-0.16, -0.11), down + 0.12 + 0.2 * fk, 0.9, 0.1 + 0.15 * fk, 8.1, null, 1.15) : ch(pel.p(0.0, -0.12), down + 0.02, 0.86, 0.04, 6.9, null, 1.0);
    return sheet(R, A, B, { m: M.coat, cols: 5, freq, seed: L ? 9 : 11, ripple: 0.18, term: L ? 0.5 : 0.3, lining: M.lining, tuck: 0.04, deepEdge: L });
  }
}

// ------------------------------------------------------------------ torso
// 3/4-front torso (we see the chest and the near side): wide chest, far shoulder peeking at the front
function torsoPts(K) {
  const { ch, pel } = K;
  const mid = (u1, v1, u2, v2) => plerp(ch.p(u1, v1), pel.p(u2, v2), 0.5);
  return [
    ch.p(0.05, -0.372), ch.p(0.12, -0.338), ch.p(0.162, -0.272), ch.p(0.17, -0.205), ch.p(0.152, -0.14), ch.p(0.128, -0.07),
    mid(0.116, 0.0, 0.116, -0.17), pel.p(0.124, -0.085), pel.p(0.104, 0.0), pel.p(0.045, 0.07), pel.p(-0.05, 0.078),
    pel.p(-0.13, 0.03), pel.p(-0.138, -0.07), mid(-0.112, 0.0, -0.128, -0.17), ch.p(-0.13, -0.1), ch.p(-0.152, -0.2),
    ch.p(-0.156, -0.288), ch.p(-0.11, -0.352), ch.p(-0.035, -0.386),
  ];
}
function drawTorso(R, K) {
  const { ch, pel, P } = K;
  const back = K.back;
  if (back) {
    // coat back panel across the whole back: centre seam, shoulder-blade shadows
    const cb = [
      ch.p(-0.05, -0.405), ch.p(0.06, -0.402), ch.p(0.145, -0.365), ch.p(0.178, -0.29), ch.p(0.172, -0.2), ch.p(0.152, -0.1), ch.p(0.142, 0.0), pel.p(0.145, -0.1),
      pel.p(-0.146, -0.085), ch.p(-0.142, -0.08), ch.p(-0.166, -0.2), ch.p(-0.174, -0.292), ch.p(-0.135, -0.365),
    ];
    const cbP = closedPath(cb, 1);
    const sh = [
      // shoulder-blade crescents either side of the spine, and the waist pinch
      closedPath([ch.p(-0.14, -0.29), ch.p(-0.08, -0.27), ch.p(-0.035, -0.22), ch.p(-0.03, -0.15), ch.p(-0.05, -0.19), ch.p(-0.09, -0.245)], 1),
      closedPath([ch.p(0.15, -0.3), ch.p(0.1, -0.27), ch.p(0.04, -0.22), ch.p(0.03, -0.15), ch.p(0.055, -0.2), ch.p(0.11, -0.25)], 1),
      closedPath([ch.p(-0.14, -0.1), ch.p(0.0, -0.07), ch.p(0.15, -0.1), pel.p(0.145, -0.1), pel.p(-0.146, -0.085)], 1),
    ];
    part(R, cbP, M.coat, { shadeW: 0.03, term: 0.45, termPts: cb, shadows: sh });
    if (R.detail > 0.3) {
      const col = M.coat.line;
      ink(R, [ch.p(0.0, -0.4), ch.p(-0.006, -0.25), ch.p(0.0, -0.1), pel.p(0.0, -0.1)], R.lwIn * 1.2, { col });
      ink(R, [ch.p(-0.12, -0.29), ch.p(-0.06, -0.25), ch.p(-0.05, -0.19)], R.lwIn * 1.0, { col, alpha: 0.85 });
      ink(R, [ch.p(0.13, -0.28), ch.p(0.07, -0.25), ch.p(0.06, -0.19)], R.lwIn * 1.0, { col, alpha: 0.85 });
      ink(R, [ch.p(-0.14, -0.06), ch.p(0.0, -0.05), ch.p(0.15, -0.06)], R.lwIn * 1.1, { col, alpha: 0.9 });
    }
    return { cbP };
  }
  const tp = torsoPts(K);
  const tPath = closedPath(tp, 1);
  part(R, tPath, M.shirt, { shadeW: 0.03, term: 0.45, termPts: tp, his: [closedPath([ch.p(0.148, -0.27), ch.p(0.158, -0.2), ch.p(0.146, -0.14), ch.p(0.15, -0.2)], 1)] });
  if (R.detail > 0.3) {
    // pec / abdomen form lines on the black shirt
    ink(R, [ch.p(0.1, -0.2), ch.p(0.13, -0.17), ch.p(0.155, -0.165)], R.lwIn * 1.0, { col: M.shirt.hi, alpha: 0.5 });
    ink(R, [ch.p(0.115, -0.32), ch.p(0.14, -0.22), ch.p(0.125, -0.08), ch.p(0.118, 0.0)], R.lwIn * 0.8, { col: M.shirt.hi, alpha: 0.4 });
  }
  // coat upper body (white): back + near side; front edge (lapel) runs down from the collar
  const fe = 0.088;
  const cb = [
    ch.p(0.01, -0.402), ch.p(fe - 0.004, -0.37), ch.p(fe + 0.016, -0.3), ch.p(fe + 0.014, -0.2), ch.p(fe + 0.004, -0.1), ch.p(fe + 0.012, 0.0), pel.p(fe + 0.03, -0.1),
    pel.p(-0.142, -0.085), ch.p(-0.14, -0.08), ch.p(-0.165, -0.2), ch.p(-0.172, -0.292), ch.p(-0.13, -0.362), ch.p(-0.06, -0.4),
  ];
  const cbP = closedPath(cb, 1);
  // shadow under the near arm / along the side
  const sh = [closedPath([ch.p(-0.04, -0.28), ch.p(0.03, -0.22), ch.p(0.06, -0.1), ch.p(0.03, 0.0), ch.p(-0.05, -0.02), ch.p(-0.06, -0.15)], 1)];
  part(R, cbP, M.coat, { shadeW: 0.03, shadows: sh, term: 0.4, termPts: cb });
  // the near arm casts a shadow on the coat body
  const aN = K.aN;
  const armC = limb([aN.sh, plerp(aN.sh, aN.el, 0.5), aN.el, plerp(aN.el, aN.wr, 0.4)], 0.052, 0.052, { per: 3, capEnd: 0.6 });
  castShadow(R, cbP, closedPath(armC.pts, 1), 0.032, M.coat.shade, 0.9);
  if (R.detail > 0.3) {
    const col = M.coat.line;
    ink(R, [ch.p(-0.02, -0.27), ch.p(0.01, -0.16), ch.p(-0.0, -0.05)], R.lwIn * 1.2, { col });
    ink(R, [ch.p(0.05, -0.22), ch.p(0.062, -0.12)], R.lwIn * 1.0, { col, alpha: 0.85 });
    ink(R, [ch.p(-0.12, -0.25), ch.p(-0.13, -0.15)], R.lwIn * 1.0, { col, alpha: 0.75 });
    ink(R, [ch.p(fe + 0.002, -0.36), ch.p(fe + 0.018, -0.25), ch.p(fe + 0.01, -0.1), ch.p(fe + 0.016, 0.0)], R.lwIn * 1.8, { col: M.lining.base, taper: 'both', alpha: 0.95 });
  }
  // belt in the opening
  const bl = [ch.p(fe - 0.005, -0.035), ch.p(0.122, -0.04), pel.p(0.13, -0.118), pel.p(0.127, -0.072), ch.p(fe - 0.005, 0.02)];
  part(R, closedPath(bl, 0.5), M.belt, { shadeW: 0.008, lw: 0.8 });
  const bk = [pel.p(0.112, -0.135), pel.p(0.132, -0.135), pel.p(0.132, -0.085), pel.p(0.112, -0.085)];
  part(R, closedPath(bk, 0.3), M.silver, { shadeW: 0.004, lw: 0.6 });
  return { cbP };
}

// ------------------------------------------------------------------ head
// Kai's hair: an authored silhouette (head space: u forward, v down, metres before hd.k) — a soft
// near-black mass of a few big swept clumps whose tips curl (convex leading edge, concave trailing
// edge), small accent flicks, nape clumps, and bangs hanging from the hairline over the forehead.
// Node: [u, v, b (bulge of the segment arriving at this node, + = convex), sway (tip mobility)]
const HAIR_FRONT = [
  [0.116, 0.004, 0.006, 0.5],    // front bang tip (start)
  [0.13, -0.074, 0.012, 0],      // front of the volume
  [0.094, -0.15, 0.012, 0.15],
  [0.03, -0.196, 0.016, 1],      // A: top-front clump, tip curling back
  [0.012, -0.16, -0.008, 0],
  [-0.072, -0.205, 0.02, 1],     // B: crown clump
  [-0.084, -0.16, -0.008, 0],
  [-0.176, -0.15, 0.022, 1],     // C: up-back
  [-0.128, -0.104, -0.01, 0],
  [-0.188, -0.088, 0.01, 0.8],   //   accent flick
  [-0.138, -0.058, -0.006, 0],
  [-0.204, -0.016, 0.02, 1],     // D: back
  [-0.142, 0.018, -0.01, 0],
  [-0.174, 0.072, 0.016, 1],     // E: back-down
  [-0.118, 0.058, -0.008, 0],
  [-0.11, 0.128, 0.014, 0.8],    // F: nape
  [-0.08, 0.088, -0.006, 0],
  [-0.054, 0.122, 0.01, 0.6],    // G: nape
  [-0.046, 0.05, -0.004, 0],     // behind the ear
  [-0.04, 0.0, 0.003, 0],
  [-0.012, 0.07, 0.006, 0.35],   // sideburn
  [0.004, -0.014, -0.004, 0],
  [0.022, 0.054, 0.008, 0.45],   // bang 1
  [0.04, -0.03, -0.004, 0],
  [0.062, 0.04, 0.008, 0.45],    // bang 2
  [0.078, -0.03, -0.004, 0],
  [0.096, 0.024, 0.007, 0.45],   // bang 3
  [0.104, -0.026, -0.003, 0],
];
// back 3/4 view: same crown & back clumps, nape clumps across the neck, side hair down to the jaw sliver
const HAIR_BACK = [
  [0.112, -0.05, 0.006, 0],
  ...HAIR_FRONT.slice(2, 18),
  [-0.026, 0.134, 0.004, 0.6],
  [-0.008, 0.086, -0.004, 0],
  [0.02, 0.13, 0.012, 0.6],
  [0.036, 0.074, -0.004, 0],
  [0.062, 0.102, 0.01, 0.5],
  [0.072, 0.038, -0.003, 0],
  [0.1, 0.01, 0.006, 0.3],
];
// darker under-layer that peeks out at the back/nape
const HAIR_UNDER = [
  [-0.05, -0.03, 0, 0],
  [-0.15, -0.01, 0.01, 0],
  [-0.214, 0.046, 0.016, 1],
  [-0.15, 0.064, -0.008, 0],
  [-0.162, 0.122, 0.014, 1],
  [-0.108, 0.1, -0.006, 0],
  [-0.084, 0.152, 0.012, 1],
  [-0.058, 0.086, -0.004, 0],
];
const SKULL_C = { x: -0.01, y: -0.014 }, SKULL_R = 0.116;
function hairNodes(K, R, mode) {
  const { hd, P } = K;
  const W = { x: R.wind.x + P.wind[0], y: R.wind.y + P.wind[1] };
  const wl = Math.min(Math.hypot(W.x, W.y), 6);
  const cw = Math.cos(-hd.a), sw = Math.sin(-hd.a);
  const wh = { x: W.x * cw - W.y * sw, y: W.x * sw + W.y * cw };
  const t = R.t;
  const L = mode === 'under' ? HAIR_UNDER : mode === 'back' ? HAIR_BACK : HAIR_FRONT;
  const nodes = [], tips = [];
  L.forEach(([u, v, b, sw0], i) => {
    let x = u, y = v;
    if (sw0 > 0) {
      // tip mobility grows with the clump's reach beyond the skull
      const reach = clamp((Math.hypot(u - SKULL_C.x, v - SKULL_C.y) - SKULL_R * 0.8) / 0.09, 0.2, 1.3) * sw0;
      const ph = TAU * (1.05 + 0.2 * wl) * t + i * 1.9;
      const fl = 0.004 + 0.0022 * wl;
      const dir = Math.atan2(v - SKULL_C.y, u - SKULL_C.x);
      x += (wh.x * 0.011 + Math.sin(ph) * fl * -Math.sin(dir)) * reach;
      y += (wh.y * 0.011 + Math.sin(ph) * fl * Math.cos(dir) - P.hairLift * 0.016) * reach;
      if (sw0 >= 0.8) tips.push({ base: { x: lerp(SKULL_C.x, u, 0.45), y: lerp(SKULL_C.y, v, 0.45) }, tip: { x, y }, h: Math.hypot(u - SKULL_C.x, v - SKULL_C.y), i });
    }
    nodes.push({ x, y, b });
  });
  return {
    nodes: nodes.map((p) => ({ ...hd.p(p.x, p.y), b: p.b * (hd.k || 1) })),
    tips: tips.map((q) => ({ ...q, base: hd.p(q.base.x, q.base.y), tip: hd.p(q.tip.x, q.tip.y) })),
  };
}
// anime "angel ring" on dark hair: a zigzag band of muted steel-blue teeth following the crown
// (drawn inside the hair clip)
function hairShine(R, hd, a0 = -2.55, a1 = -0.62) {
  if (R.detail <= 0.3) return;
  const C0 = { x: -0.008, y: -0.02 };
  const N = 11;
  const pts = [];
  for (let i = 0; i <= N; i++) { const a = lerp(a0, a1, i / N); const r = 0.146 - 0.006 * Math.sin(i * 1.7); pts.push(hd.p(C0.x + Math.cos(a) * r, C0.y + Math.sin(a) * r)); }
  for (let i = N; i >= 0; i--) {
    const a = lerp(a0, a1, i / N) + (i % 2 ? 0.02 : 0);
    const r = i % 2 ? 0.094 + 0.014 * hash1(i * 3.3) : 0.126 + 0.006 * hash1(i * 1.7);
    pts.push({ ...hd.p(C0.x + Math.cos(a) * r, C0.y + Math.sin(a) * r), sharp: i % 2 === 1 });
  }
  const c = R.c;
  c.fillStyle = rgba(HAIR_SHINE); c.fill(mixedPath(pts, 0.7));
  // a couple of thin glints above the band
  for (let i = 0; i < 3; i++) {
    const a = lerp(a0 + 0.25, a1 - 0.2, (i + 0.5) / 3);
    const p0 = hd.p(C0.x + Math.cos(a) * 0.17, C0.y + Math.sin(a) * 0.17), p1 = hd.p(C0.x + Math.cos(a + 0.06) * 0.152, C0.y + Math.sin(a + 0.06) * 0.152);
    ink(R, [p0, plerp(p0, p1, 0.5), p1], 0.006, { col: HAIR_SHINE, taper: 'both', alpha: 0.9 });
  }
}
const HAIR_SHINE = [46, 60, 110];
function strandInks(R, tips, n = 3) {
  if (R.detail <= 0.3) return;
  const big = tips.slice().sort((a, b) => b.h - a.h).slice(0, n);
  for (const s of big) {
    const a = plerp(s.base, s.tip, 0.25), b = plerp(s.base, s.tip, 0.55), c2 = plerp(s.base, s.tip, 0.86);
    const off = { x: (s.tip.y - s.base.y) * 0.08, y: -(s.tip.x - s.base.x) * 0.08 };
    ink(R, [a, padd(b, off), c2], R.lwIn * 1.1, { col: M.hair.line, alpha: 0.9 });
  }
}


function drawHead(R, K) {
  const { hd, nk, P } = K;
  if (K.back) return drawHeadBack(R, K);
  // collar (back part) of the coat
  const col = [nk.p(-0.075, 0.035), nk.p(-0.098, -0.05), nk.p(-0.094, -0.118), nk.p(-0.05, -0.128), nk.p(0.0, -0.09), nk.p(0.05, -0.055), nk.p(0.078, -0.005), nk.p(0.066, 0.03)];
  part(R, mixedPath(col.map((p, i) => (i === 2 || i === 3 || i === 6) ? { ...p, sharp: true } : p), 0.8), M.collarIn, { shadeW: 0.02 });
  // neck with the chin's cast shadow
  const neck = [nk.p(0.05, -0.12), nk.p(0.052, 0.01), nk.p(-0.046, 0.01), nk.p(-0.05, -0.13)];
  part(R, closedPath(neck, 0.6), M.skin, { shadeW: 0.02, shadows: [closedPath([nk.p(0.06, -0.14), nk.p(0.06, -0.075), nk.p(0.0, -0.05), nk.p(-0.06, -0.09), nk.p(-0.06, -0.15)], 1)] });
  // black high shirt collar
  const sc = [nk.p(0.058, -0.06), nk.p(0.06, 0.02), nk.p(-0.055, 0.02), nk.p(-0.058, -0.075), nk.p(0.0, -0.068)];
  part(R, closedPath(sc, 0.7), M.shirt, { shadeW: 0.012, lw: 0.9 });
  // head skin: sharp jaw, pointed chin (3/4 view facing +u)
  const H = [[-0.02, -0.112], [0.05, -0.098], [0.087, -0.06], [0.099, -0.02], [0.096, 0.006], [0.104, 0.034], [0.099, 0.064], [0.086, 0.096], [{ s: 1 }, 0.066, 0.128], [0.046, 0.134], [0.02, 0.118], [-0.02, 0.09], [-0.046, 0.056], [-0.062, 0.018], [-0.1, -0.02], [-0.094, -0.08]];
  const hp = H.map((a) => (typeof a[0] === 'object' ? { ...hd.p(a[1], a[2]), sharp: true } : hd.p(a[0], a[1])));
  const headP = mixedPath(hp, 1);
  const faceShadows = [];
  // cast shadow of the bangs across the forehead (jagged), side-of-face shadow, jaw underside
  faceShadows.push(closedPath([hd.p(-0.03, -0.06), hd.p(-0.02, 0.045), hd.p(0.006, 0.05), hd.p(0.014, -0.004), hd.p(0.03, 0.006), hd.p(0.044, -0.008), hd.p(0.06, 0.004), hd.p(0.074, -0.01), hd.p(0.09, 0.0), hd.p(0.1, -0.012), hd.p(0.13, 0.0), hd.p(0.13, -0.09), hd.p(-0.03, -0.09)], 0.4));
  faceShadows.push(closedPath([hd.p(-0.06, 0.02), hd.p(-0.018, 0.02), hd.p(0.004, 0.072), hd.p(0.034, 0.114), hd.p(0.0, 0.134), hd.p(-0.06, 0.09)], 1));
  part(R, headP, M.skin, { shadeW: 0.0, shadows: faceShadows });
  // ear
  const ear = closedPath([hd.p(-0.03, -0.006), hd.p(-0.012, 0.004), hd.p(-0.012, 0.03), hd.p(-0.024, 0.05), hd.p(-0.038, 0.03)], 1);
  part(R, ear, M.skin, { shadeW: 0.006, lw: 0.8 });
  ink(R, [hd.p(-0.022, 0.006), hd.p(-0.03, 0.02), hd.p(-0.024, 0.036)], R.lwIn * 0.9, { col: M.skin.line });
  // hair: dark under-clumps at the nape, then the main mass
  const hu = hairNodes(K, R, 'under');
  part(R, curvePath(hu.nodes, true), M.hairU, { shadeW: 0.02 });
  const hn = hairNodes(K, R, 'front');
  const hairP = curvePath(hn.nodes, true);
  const deepH = closedPath([hd.p(-0.03, 0.02), hd.p(-0.09, 0.0), hd.p(-0.16, 0.06), hd.p(-0.1, 0.12), hd.p(-0.05, 0.09)], 1);
  part(R, hairP, M.hair, { shadeW: 0.03, deep: [deepH], term: 0.35, termPts: hn.nodes, rimK: 0.5, after: () => hairShine(R, hd) });
  R.c.save(); R.c.clip(curvePath(hn.nodes, true)); strandInks(R, hn.tips, 3); R.c.restore();
  // face over hair (anime convention): brows, eyes, nose, mouth
  const glow = R.eyeGlow;
  const bw = R.lwIn * 2.4;
  const bt = P.brow;
  ink(R, [hd.p(0.068, -0.006 + 0.006 * bt), hd.p(0.044, -0.014), hd.p(0.012, -0.012 - 0.004 * bt)], bw, { taper: 'end' });
  ink(R, [hd.p(0.09, -0.01 + 0.004 * bt), hd.p(0.104, -0.018)], bw * 0.8, { taper: 'start' });
  drawEye(R, hd, 0.04, 0.02, { w: 0.05, h: 0.026, col: EYE, glow, look: 0.08 + P.look * 0.1, flick: 0.3, lashW: 1.05, tilt: 0.16, creaseCol: M.skin.line });
  drawEye(R, hd, 0.093, 0.017, { w: 0.022, h: 0.023, col: EYE, glow: glow * 0.9, look: 0.1, flick: 0.1, lashW: 0.9, irisK: 0.85, crease: false, tilt: 0.1 });
  ink(R, [hd.p(0.103, 0.03), hd.p(0.111, 0.05), hd.p(0.103, 0.057)], R.lwIn * 1.05, { taper: 'end', col: M.skin.line });
  const mo = P.mouth || 0;
  ink(R, [hd.p(0.064, 0.09), hd.p(0.078, 0.089 + 0.003 * mo), hd.p(0.09, 0.086)], R.lwIn * 1.2, { taper: 'both' });
  if (mo > 0.25) R.c.fillStyle = rgba([90, 30, 50]), R.c.fill(closedPath([hd.p(0.07, 0.09), hd.p(0.086, 0.088), hd.p(0.08, 0.09 + 0.008 * mo)], 1));
  // a bang lock crossing the near eye ("eyes between the bangs")
  const sw = Math.sin(TAU * 1.1 * R.t + 0.7) * 0.002;
  const lock = [{ ...hd.p(0.02, -0.05), b: 0 }, { ...hd.p(0.016 + sw, 0.05), b: 0.004 * hd.k }, { ...hd.p(0.032, -0.034), b: 0.003 * hd.k }];
  part(R, curvePath(lock, true), M.hair, { shadeW: 0.006, lw: 0.8, his: [closedPath([hd.p(0.023, -0.03), hd.p(0.025, -0.012), hd.p(0.028, -0.026)], 0.5)] });
  // near side of the stand collar, in front of the nape
  const cn = [nk.p(-0.078, 0.04), nk.p(-0.088, -0.045), nk.p(-0.066, -0.07), nk.p(-0.02, -0.05), nk.p(0.03, -0.03), nk.p(0.06, 0.02)];
  part(R, mixedPath(cn.map((p, i) => (i === 1 || i === 5) ? { ...p, sharp: true } : p), 0.8), M.coat, { shadeW: 0.02 });
}
// 3/4 back view: nape skin, a sliver of the jaw/cheek, near ear, back-of-skull hair over the collar
function drawHeadBack(R, K) {
  const { hd, nk } = K;
  // nape
  const neck = [nk.p(0.05, -0.13), nk.p(0.054, 0.01), nk.p(-0.05, 0.01), nk.p(-0.052, -0.13)];
  part(R, closedPath(neck, 0.6), M.skin, { shadeW: 0.02, term: 0.5, termPts: neck, shadows: [closedPath([nk.p(-0.06, -0.14), nk.p(0.06, -0.14), nk.p(0.06, -0.09), nk.p(-0.06, -0.06)], 1)] });
  // coat stand collar seen from behind
  const col = [nk.p(-0.088, 0.04), nk.p(-0.096, -0.04), nk.p(-0.08, -0.085), nk.p(0.0, -0.096), nk.p(0.072, -0.07), nk.p(0.084, -0.02), nk.p(0.076, 0.04)];
  part(R, closedPath(col, 1), M.coat, { shadeW: 0.02, term: 0.45, termPts: col });
  ink(R, [nk.p(-0.07, -0.06), nk.p(0.0, -0.07), nk.p(0.066, -0.05)], R.lwIn * 0.9, { col: M.coat.line, alpha: 0.8 });
  // jaw / cheek sliver at the front edge (mostly in shadow: we look at the back of the head)
  const jaw = [hd.p(0.072, 0.02), hd.p(0.094, 0.03), hd.p(0.096, 0.062), hd.p(0.084, 0.094), hd.p(0.064, 0.11), hd.p(0.052, 0.092), hd.p(0.058, 0.05)];
  part(R, closedPath(jaw, 1), M.skin, { shadeW: 0.012, shadows: [closedPath([hd.p(0.04, 0.0), hd.p(0.082, 0.03), hd.p(0.078, 0.07), hd.p(0.068, 0.12), hd.p(0.04, 0.12)], 1)] });
  // hair
  const hu = hairNodes(K, R, 'under');
  part(R, curvePath(hu.nodes, true), M.hairU, { shadeW: 0.02 });
  const hn = hairNodes(K, R, 'back');
  part(R, curvePath(hn.nodes, true), M.hair, { shadeW: 0.03, term: 0.4, termPts: hn.nodes, rimK: 0.5, after: () => hairShine(R, hd, -2.7, -1.1, 4) });
  R.c.save(); R.c.clip(curvePath(hn.nodes, true)); strandInks(R, hn.tips, 3); R.c.restore();
  // near ear poking out of the hair
  const ear = closedPath([hd.p(0.046, 0.016), hd.p(0.064, 0.012), hd.p(0.07, 0.036), hd.p(0.062, 0.06), hd.p(0.05, 0.05)], 1);
  part(R, ear, M.skin, { shadeW: 0.008, lw: 0.8 });
  ink(R, [hd.p(0.056, 0.022), hd.p(0.062, 0.036), hd.p(0.056, 0.05)], R.lwIn * 0.8, { col: M.skin.line });
}

// ------------------------------------------------------------------ main
export function drawKai(S, o = {}) {
  const pose = resolvePose(POSES, o.pose ?? 'stand', o.poseSteps ?? 8);
  const P = { ...pose, ...(o.poseOverride || {}) };
  const R = beginChar(S, { ...o, _idle: isIdle(o.pose, ['stand']) }, D.H);
  if (!R) return null;
  const K = skeleton(P, { ...o, _pose: o.pose });
  const windL = { x: R.wind.x + P.wind[0], y: R.wind.y + P.wind[1] };
  const sk = { windX: windL.x };
  const glowBlade = o.bladeGlow ?? (K.sword === 'drawn' ? 0.7 : 0.4);
  const swordAngDrawn = P.swordA;
  const guardF = dirv(K.tsukaDirA + Math.PI); // from a tsuka grip toward the tsuba
  const guardN = dirv(K.tsukaDirA);           // from the saya grip toward the koiguchi
  const thumbN = { tip: padd(K.tsubaS, guardN, -0.008) };
  R.body = [K.headC, K.ch.p(0.02, -0.25), K.ch.p(0, -0.05), K.hip, K.lN.knee, K.lF.knee, K.lN.ank, K.lF.ank, K.aN.el, K.aF.el, K.aN.wr, K.aF.wr, K.pel.p(-0.3, 0.5)];

  if (K.back) {
    // 3/4 back view (sheathing): the sword work happens in front of the body, hidden by the back;
    // only the raised elbow, the tsuka end and the kojiri break the silhouette.
    if (K.bladeOut > 0.001) drawBlade(R, padd(K.koi, dirv(K.tsukaDirA), 0.005), K.tsukaDirA, K.bladeOut * D.blade * K.fs + 0.01, glowBlade * (0.5 + K.bladeOut), true);
    drawHilt(R, K.tsubaS, K.tsukaDirA, K.fs);
    drawSleeve(R, K.aN, true);
    drawGripHand(R, K.aN.grip || K.aN.wr, K.tsukaDirA, K.aN.wr, guardN, M.skin, thumbN);
    drawCuff(R, K.aN, true);
    drawSleeve(R, K.aF, true);
    drawGripHand(R, K.aF.grip || K.aF.wr, K.tsukaDirA, K.aF.wr, guardF, M.skin, null);
    drawCuff(R, K.aF, true);
    drawLeg(R, K.lF, false);
    drawLeg(R, K.lN, true);
    // saya on the far hip, under the coat: only the kojiri end pokes out behind (down-back)
    drawSaya(R, K, 0.8);
    const tor = drawTorso(R, K);
    drawCoatSkirt(R, K, 'backL', windL);
    drawCoatSkirt(R, K, 'backR', windL);
    drawHead(R, K);
    endChar(S, R, { ...o, auraColor: o.auraColor || [70, 180, 255] });
    return kaiPoints(S, o, K);
  }
  const farGrip = P.shapeF === 'grip';
  const drawnBehind = K.sword === 'drawn';
  const drawFarArmFull = () => {
    drawSleeve(R, K.aF, false);
    if (K.sword === 'drawn' && farGrip) {
      // sword held in the far hand
      const g = K.aF.grip || K.aF.wr;
      const bd = dirv(swordAngDrawn);
      const tsuba = padd(g, bd, 0.075);
      drawBlade(R, padd(tsuba, bd, 0.01), swordAngDrawn, D.blade, glowBlade, false);
      drawHilt(R, tsuba, swordAngDrawn + Math.PI);
      drawGripHand(R, g, swordAngDrawn, K.aF.wr, bd, M.skin, null);
    } else if (!farGrip) drawHandFree(R, K.aF, P.shapeF, P.handFa);
    drawCuff(R, K.aF, false);
  };
  // 1. back coat tails
  drawCoatSkirt(R, K, 'back', windL);
  // 2. far arm (behind body)
  if (!farGrip || drawnBehind) drawFarArmFull();
  else drawSleeve(R, K.aF, false);
  // 3. far leg
  drawLeg(R, K.lF, false);
  // 4. far front flap (inside of the coat)
  drawCoatSkirt(R, K, 'farFront', windL);
  // 5. torso + coat body
  drawTorso(R, K);
  // 6. near coat side/back sheet, then near leg in front of it
  drawCoatSkirt(R, K, 'nearSide', windL);
  const legN = drawLeg(R, K.lN, true);
  // 7. near front flap (+ its shadow on the trousers)
  const flap = drawCoatSkirt(R, K, 'nearFront', windL);
  if (flap && flap.path) castShadow(R, legN.path, flap.path, 0.04, M.pants.deepRGB, 0.85, flap.path);
  // 8. katana at the hip
  drawSaya(R, K);
  drawSageo(R, K, sk);
  if (K.sword === 'sheathed') {
    if (K.bladeOut > 0.001) drawBlade(R, padd(K.koi, dirv(K.tsukaDirA), 0.005), K.tsukaDirA, K.bladeOut * D.blade + 0.01, glowBlade * (0.5 + K.bladeOut), true);
    drawHilt(R, K.tsubaS, K.tsukaDirA);
  }
  // 9. far hand on the tsuka
  if (farGrip && !drawnBehind) {
    const g = K.aF.grip || K.aF.wr;
    drawGripHand(R, g, K.tsukaDirA, K.aF.wr, guardF, M.skin, null, true);
    drawCuff(R, K.aF, false);
  }
  // 10. near arm
  drawSleeve(R, K.aN, true);
  if (P.shapeN === 'sayaGrip' || P.shapeN === 'grip') drawGripHand(R, K.aN.grip || K.aN.wr, K.tsukaDirA, K.aN.wr, guardN, M.skin, P.shapeN === 'sayaGrip' ? thumbN : null);
  else drawHandFree(R, K.aN, P.shapeN, P.handNa);
  drawCuff(R, K.aN, true);
  // 11. head
  drawHead(R, K);
  endChar(S, R, { ...o, auraColor: o.auraColor || [70, 180, 255] });
  return kaiPoints(S, o, K);
}

// key points (world metres + screen px) for composing effects: eye, hands, blade tip, hilt ...
function kaiPoints(S, o, K) {
  const g = K.aF.grip || K.aF.wr;
  let tsuba, tip;
  if (K.sword === 'drawn') { const bd = dirv(K.P.swordA); tsuba = padd(g, bd, 0.075); tip = padd(g, bd, 0.085 + D.blade + 0.03); }
  else { tsuba = K.tsubaS; tip = padd(K.koi, dirv(K.tsukaDirA), K.bladeOut * D.blade * K.fs); }
  const pts = worldPts(S, o, {
    head: K.headC, eye: K.back ? K.hd.p(0.085, 0.03) : K.hd.p(0.04, 0.02), chest: K.ch.p(0.06, -0.2), hip: K.hip, handN: K.aN.wr, handF: K.aF.wr, grip: g,
    tsuba, bladeTip: tip, koiguchi: K.koi, footN: K.lN.ank, footF: K.lF.ank, top: K.hd.p(-0.03, -0.22),
  });
  return { pts, skeleton: K };
}
