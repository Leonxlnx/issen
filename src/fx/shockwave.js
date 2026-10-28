// ISSEN — builder E: shockwave rings.
// An expanding ring lying in the ground plane (perspective-correct ellipse) or facing the camera.
// Read: a crisp white-hot leading rim on a thin band (short 3-step wake), two hairline echo rings for the
// concentric-line look of ref3/ref6, boiling jagged teeth, radial streaks; ground rings add a rising energy
// wall with flickering vertical streaks along the front arc and a unioned cel dust skirt with a crimson bounce;
// a 24 fps-snapped jagged centre pop and optional screen refraction through S.post.wave.
import { RNG, TAU, clamp, lerp, smoothstep, mixColor, rgba, hash1, hash2, hash3, E, pulse } from '../core/math.js';
import { pal, boil, drawStar, glowDot, drawParticles, dustUnion, streak, burstFlash, q24 } from './particles.js';

function ringXYZ(o, a, r) {
  if (o.plane === 'screen') {
    const ca = Math.cos(a), sa = Math.sin(a);
    const ex = ca * r, ey = sa * r * (1 - o.tilt);
    return { x: o.x + ex * Math.cos(o.rot) - ey * Math.sin(o.rot), y: o.y + ex * Math.sin(o.rot) + ey * Math.cos(o.rot), z: o.z + sa * r * o.tilt * 0.6 };
  }
  return { x: o.x + Math.cos(a) * r, y: o.y, z: o.z + Math.sin(a) * r };
}
function ringPts(S, o, R, nSeg, jag, tb, seedOff) {
  const cam = S.cam, pts = [];
  for (let i = 0; i < nSeg; i++) {
    const a = (i / nSeg) * TAU;
    let r = R;
    if (jag > 0) {
      // teeth: boiling on 24 fps steps, a few big + many small
      const h = hash3(i * 1.37 + seedOff, tb * 0.71, 3.3);
      const h2 = hash2(Math.floor(i / 4) + seedOff * 3.1, tb);
      r = R * (1 + jag * ((h - 0.5) * 0.6 + (h2 - 0.5) * 0.9));
    }
    const w = ringXYZ(o, a, r);
    // keep points in front of the camera (ring passing under/behind the lens)
    if (w.z - cam.z < 0.3) w.z = cam.z + 0.3;
    pts.push(cam.project(w.x, w.y, w.z));
  }
  return pts;
}
function band(ctx, outer, inner) {
  ctx.beginPath();
  ctx.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
  ctx.closePath();
  if (inner) {
    ctx.moveTo(inner[inner.length - 1].x, inner[inner.length - 1].y);
    for (let i = inner.length - 2; i >= 0; i--) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.closePath();
  }
  ctx.fill('evenodd');
}
function polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// drawShockwave(S, { x, y, z, t=S.t, t0=0, maxR=8, color='red'|'blue'|'white'|[r,g,b], thickness=0.6, duration=0.9,
//   plane='ground'|'screen', tilt=0 (screen rings: 0 = circle facing camera, →1 = flattened), rot=0, rings=2, ringDelay=0.07,
//   distort=0 (sets S.post.wave), dust=1 (ground skirt), dustTint=null (defaults to the ring colour), wall=thickness*3
//   (ground energy wall height; 0 = off), sparks=1, flash=1, streaks=1, jag=1, echoes=1 (hairline echo rings),
//   alpha=1, seed=1, fill=0 })
export function drawShockwave(S, o = {}) {
  const t = o.t == null ? S.t : o.t, t0 = o.t0 || 0;
  const dt = t - t0;
  const dur = o.duration == null ? 0.9 : o.duration;
  const rings = o.rings == null ? 2 : o.rings, rDelay = o.ringDelay == null ? 0.07 : o.ringDelay;
  if (dt < 0 || dt > dur + rings * rDelay + 0.05) return;
  const P = pal(o.color || 'red');
  const oo = { x: o.x || 0, y: o.y || 0, z: o.z || 0, plane: o.plane || 'ground', tilt: o.tilt || 0, rot: o.rot || 0, tint: o.dustTint || P.mid };
  const maxR = o.maxR == null ? 8 : o.maxR, th0 = o.thickness == null ? 0.6 : o.thickness;
  const A = o.alpha == null ? 1 : o.alpha;
  const seed = o.seed == null ? 1 : o.seed;
  const echoes = o.echoes == null ? 1 : o.echoes;
  const tb = boil(t);
  const cam = S.cam, em = S.L.emit, sc = S.L.scene;
  const qc = cam.project(oo.x, oo.y, Math.max(oo.z, cam.z + 0.3));
  em.save(); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'lighter';
  em.lineJoin = 'round'; em.lineCap = 'round';
  let waveR = 0, waveK = 0;
  for (let r = 0; r < rings; r++) {
    const tr = dt - r * rDelay;
    if (tr < 0) continue;
    const u = clamp(tr / (dur * (1 - r * 0.12)));
    if (u >= 1) continue;
    const R = maxR * (1 - r * 0.2) * (0.04 + 0.96 * E.outCubic(u));
    const fade = (1 - smoothstep(0.35, 1, u)) * (r === 0 ? 1 : 0.7);
    // band never thicker than ~30 % of the radius (no filled disc while the ring is still small)
    const th = Math.min(th0 * (1 - r * 0.25) * (0.35 + 0.65 * (1 - u)) + R * 0.006, R * 0.3);
    const nSeg = Math.max(48, Math.min(180, Math.round(R * 16)));
    const jag = (o.jag == null ? 1 : o.jag) * 0.025;
    const so = seed * 13 + r * 7;
    const outerJ = ringPts(S, oo, R, nSeg, jag, tb, so);
    const outer = ringPts(S, oo, R, nSeg, 0, tb, so);
    const mk = (k) => ringPts(S, oo, Math.max(0.01, R - th * k), nSeg, 0, tb, so);
    // energy fill inside (screen rings)
    if (o.fill && oo.plane === 'screen' && qc) {
      em.globalAlpha = A * fade * o.fill * 0.3;
      em.fillStyle = rgba(P.deep);
      band(em, outer, null);
    }
    // short 3-step wake → thin hot body → white-hot leading rim
    const steps = [[1.8, P.deep, 0.07], [1.0, P.mid, 0.12], [0.45, P.hot, 0.2]];
    for (const [k, col, a] of steps) { em.globalAlpha = A * fade * a; em.fillStyle = rgba(col); band(em, k > 1.2 ? outer : outerJ, mk(k)); }
    em.globalAlpha = A * fade * 0.22; em.fillStyle = rgba(P.hot); band(em, outerJ, mk(0.25));
    em.globalAlpha = A * fade * 0.95; em.fillStyle = rgba(P.core); band(em, outer, mk(0.035));
    // hairline echo rings (thin concentric lines)
    if (echoes > 0) {
      for (const f of [0.93, 1.035]) {
        const pts = ringPts(S, oo, R * f, nSeg, 0, tb, so);
        polyline(em, pts);
        em.globalAlpha = A * fade * 0.5 * echoes * (f > 1 ? 0.8 : 1); em.strokeStyle = rgba(P.core); em.lineWidth = 1.5; em.stroke();
      }
    }
    // radial streaks (speed lines inside the band), boil on 24 fps
    if (o.streaks == null || o.streaks > 0) {
      const ns = Math.round(28 + R * 3);
      for (let k = 0; k < ns; k++) {
        const h = hash3(k, tb, seed + r);
        if (h < 0.45) continue;
        const a = (k + hash2(k, tb + 3.1)) / ns * TAU;
        const r0 = R - th * (0.8 + 2.2 * hash2(k * 1.7, tb)), r1 = R + th * 0.3 * hash2(k * 2.3, tb + 1);
        const pa = pt(S, oo, a, r0), pb = pt(S, oo, a, r1);
        if (!pa || !pb) continue;
        em.globalAlpha = A * fade * (0.25 + 0.45 * h);
        em.fillStyle = rgba(h > 0.85 ? P.core : P.hot);
        em.beginPath(); streak(em, pa.x, pa.y, pb.x, pb.y, clamp(th * 0.06 * pb.s, 1, 6)); em.fill();
      }
    }
    // rising energy wall at the ring front (ground rings): reads strongly from low angles
    const wallH = (o.wall == null ? (oo.plane === 'ground' ? th0 * 3 : 0) : o.wall) * (r === 0 ? 1 : 0.6);
    if (wallH > 0 && oo.plane === 'ground') {
      const hh = wallH * (0.35 + 0.65 * (1 - u));
      const layers = [[1, P.deep, 0.12], [0.6, P.mid, 0.1], [0.22, P.hot, 0.12]];
      for (const [kh, col, a] of layers) {
        const top = [];
        for (let i = 0; i < nSeg; i++) {
          const ang = (i / nSeg) * TAU;
          const jh = 0.55 + 0.9 * hash3(i * 0.37 + so, tb * 0.53, 7.1);
          let wz = oo.z + Math.sin(ang) * R; if (wz - cam.z < 0.3) wz = cam.z + 0.3;
          top.push(cam.project(oo.x + Math.cos(ang) * R, oo.y - hh * kh * jh, wz));
        }
        em.globalAlpha = A * fade * a; em.fillStyle = rgba(col);
        // back half and front half filled separately (opposite windings would cancel in one path)
        for (let half = 0; half < 2; half++) {
          em.beginPath();
          for (let i = 0; i < nSeg; i++) {
            if ((Math.sin(((i + 0.5) / nSeg) * TAU) > 0) !== (half === 0)) continue;
            const j = (i + 1) % nSeg, b0 = outer[i], b1 = outer[j], t0p = top[i], t1p = top[j];
            if (!b0 || !b1 || !t0p || !t1p) continue;
            em.moveTo(b0.x, b0.y); em.lineTo(b1.x, b1.y); em.lineTo(t1p.x, t1p.y); em.lineTo(t0p.x, t0p.y); em.closePath();
          }
          em.fill();
        }
      }
      // flickering vertical energy streaks rising from the front arc (each lives ~4 frames at 24 fps)
      const nv = 12 + Math.round(8 * hash1(seed + r));
      for (let j = 0; j < nv; j++) {
        const life = 4, ph = Math.floor(hash1(seed * 3.7 + j) * life);
        const ep = Math.floor((tb + ph) / life), age = (tb + ph) % life;
        const ang = Math.PI * (1.08 + 0.84 * hash3(j, ep, seed + r)); // front arc: sin(ang) < 0 (toward the camera)
        const w0 = ringXYZ(oo, ang, R * (0.97 + 0.05 * hash2(j, ep)));
        if (w0.z - cam.z < 0.4) continue;
        const hgt = hh * (1.2 + 1.6 * hash3(j * 1.3, ep, 2.2)) * (0.6 + 0.4 * (age + 1) / life);
        const qa = cam.project(w0.x, w0.y, w0.z), qb = cam.project(w0.x, w0.y - hgt, w0.z);
        if (!qa || !qb) continue;
        const k = (1 - age / life) * fade;
        const w = clamp(th0 * 0.06 * qa.s, 1, 5);
        em.globalAlpha = A * k * 0.45; em.fillStyle = rgba(P.mid);
        em.beginPath(); streak(em, qb.x, qb.y, qa.x, qa.y, w * 2.2); em.fill();
        em.globalAlpha = A * k * 0.8; em.fillStyle = rgba(P.core);
        em.beginPath(); streak(em, lerp(qa.x, qb.x, 0.6), lerp(qa.y, qb.y, 0.6), qa.x, qa.y, w * 0.8); em.fill();
      }
    }
    if (r === 0) { waveR = R; waveK = fade; }
    // dust skirt along the ground ring (scene layer)
    if (r === 0 && oo.plane === 'ground' && (o.dust == null || o.dust > 0)) dustSkirt(S, sc, oo, R, th0, u, A * (o.dust == null ? 1 : o.dust), seed, qc);
  }
  // centre pop: jagged burst snapped to 24 fps (2 solid frames, 2 outline frames) + one small star
  if (qc && (o.flash == null || o.flash > 0)) {
    const fk = o.flash == null ? 1 : o.flash;
    const f = Math.floor(dt * 24 + 1e-6);
    const Rpx = Math.min(300, maxR * 0.12 * qc.s);
    if (f < 2) burstFlash(em, qc.x, qc.y, Rpx * (0.8 + 0.3 * f), { color: P, alpha: A * fk, seed: seed * 5, tb: f, spikes: 12, aspect: oo.plane === 'ground' ? 1.6 : 1 });
    else if (f < 4) burstFlash(em, qc.x, qc.y, Rpx * (1.15 + 0.2 * (f - 2)), { color: P, alpha: A * fk * (f === 2 ? 1 : 0.55), seed: seed * 5, tb: f, spikes: 12, mode: 'line', aspect: oo.plane === 'ground' ? 1.6 : 1 });
    const k = 1 - q24(dt) / 0.3;
    if (k > 0) {
      drawStar(em, qc.x, qc.y, Math.min(70, maxR * 0.08 * qc.s) * k, { color: P, alpha: A * fk * k, aspect: 1.8, rot: 0, diag: 0.3 });
      glowDot(em, qc.x, qc.y, Math.min(24, th0 * qc.s * 0.25 * k), P, A * fk * k * 0.8);
    }
  }
  em.restore();
  if (o.sparks == null || o.sparks > 0) {
    drawParticles(S, { kind: 'sparks', seed: seed + 91, origin: { x: oo.x, y: oo.y - 0.05, z: oo.z }, t, t0, count: Math.round(36 * (o.sparks || 1)), speed: maxR * 1.6, life: 0.55, drag: 2.2, gravity: 6, size: 0.04 * Math.max(1, maxR / 6), tail: 0.06, color: P, alpha: A, flat: oo.plane === 'ground' });
  }
  // screen refraction
  if (o.distort && qc && waveR > 0) {
    let rpx = waveR * qc.s;
    if (oo.plane === 'ground') { const e = cam.project(oo.x + waveR, oo.y, Math.max(oo.z, cam.z + 0.3)); if (e) rpx = Math.abs(e.x - qc.x); }
    S.post.wave = [qc.x / S.W, qc.y / S.H, rpx / S.H, o.distort * 0.022 * waveK];
  }
}
function pt(S, oo, a, r) {
  const w = ringXYZ(oo, a, r);
  if (w.z - S.cam.z < 0.3) return null;
  return S.cam.project(w.x, w.y, w.z);
}
// cel-shaded dust kicked up along the ring: unioned billows, crimson bounce on the side facing the ring centre
function dustSkirt(S, sc, oo, R, th0, u, A, seed, qc) {
  const cam = S.cam;
  const N = Math.round(14 + R * 2.2);
  const list = [];
  const tb = boil(S.t);
  for (let k = 0; k < N; k++) {
    const rng = new RNG(seed * 31 + k * 7);
    const a = (k + rng.range(-0.4, 0.4)) / N * TAU;
    const rr = R * rng.range(0.84, 1.0);
    const lift = th0 * rng.range(0.2, 0.9) * (0.25 + 0.6 * u);
    const wz = oo.z + Math.sin(a) * rr;
    if (wz - cam.z < 0.4) continue;
    const q = cam.project(oo.x + Math.cos(a) * rr, oo.y - lift, wz);
    if (!q) continue;
    const size = th0 * rng.range(0.8, 1.6) * (0.4 + 0.8 * u) * q.s;
    const life = smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u) * 0.6);
    let tdir = null;
    if (qc) { const dx = qc.x - q.x, dy = qc.y - q.y, l = Math.hypot(dx, dy) || 1; tdir = { x: dx / l, y: dy / l }; }
    list.push({ q, r: size, a: life, seed: rng.next() * 977 + tb * 0.31, tdir });
  }
  list.sort((a, b) => b.q.z - a.q.z);
  dustUnion(sc, list, { tint: oo.tint }, A * 0.9 * (1 - smoothstep(0.25, 0.8, u)) * smoothstep(0, 0.06, u));
}
