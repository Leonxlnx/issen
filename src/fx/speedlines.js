// Builder D — manga speed lines (radial focus lines / linear motion lines): dense clumps of tapered lines with a wide
// weight range, concentrated toward the frame edges, boiled on 12 fps (anime "on twos"), sliding between boils.
import { RNG, TAU, clamp, lerp, rgba, smoothstep } from '../core/math.js';
import { pal, boilStep } from './lightning.js';

// drawSpeedLines(S, ctx, o)
// o: { kind='radial'|'linear', cx=W/2, cy=H/2, angle=0 (linear: direction of motion, radians),
//      density=1, k=0..1 (radial: lines also retract outward as k->0), color=[255,255,255] | 'blue' | palette,
//      t=S.t, seed=11, fps=12, inner=0.3 (radial clear radius, fraction of H), width=6 (max px at the frame edge, 1080p),
//      alpha=0.85, length=1 (linear line length factor), speed=2400 (linear: px/s drift along the direction between boils),
//      clear=0 (linear: half-height in px of a clear corridor through (cx,cy)), tint=0.3 if a palette is given (fraction of
//      lines drawn in the palette's mid colour), blend='lighter'|'source-over' (default: lighter for emit/back),
//      ink=false (also draw a second, darker set source-over into S.L.scene in #0d0f22 — for bright backgrounds),
//      inkAlpha=0.8 }
export function drawSpeedLines(S, ctx, o = {}) {
  ctx = ctx || S.L.emit;
  const k = clamp(o.k ?? 1);
  if (k <= 0.002) return;
  const t = o.t ?? S.t;
  const fps = o.fps ?? 12;
  const step = boilStep(t, fps);
  const seed = o.seed ?? 11;
  const P = o.color && !Array.isArray(o.color) ? pal(o.color) : null;
  const base = Array.isArray(o.color) ? o.color : P ? P.core : [255, 255, 255];
  const tintC = P ? P.mid : base;
  const tint = o.tint ?? (P ? 0.3 : 0);
  const additive = o.blend ? o.blend === 'lighter' : (ctx === S.L.emit || ctx === S.L.back);
  drawSet(S, ctx, o, k, t, step, fps, seed, base, tintC, tint, additive, o.alpha ?? 0.85);
  if (o.ink && S.L.scene) {
    const ink = [13, 15, 34];
    drawSet(S, S.L.scene, { ...o, width: (o.width ?? 6) * 1.2 }, k, t, step, fps, seed * 7 + 3, ink, ink, 0, false, o.inkAlpha ?? 0.8);
  }
}

function drawSet(S, ctx, o, k, t, step, fps, seed, base, tintC, tint, additive, alpha0) {
  const kind = o.kind ?? 'radial';
  const density = o.density ?? 1;
  const px = S.H / 1080;
  const alpha = alpha0 * (kind === 'radial' ? lerp(0.4, 1, k) : k * 0.6);
  const width = (o.width ?? 6) * px;
  const rng = new RNG(((seed * 2654435761) ^ (step * 40503)) >>> 0);
  const { W, H } = S;
  const cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
  ctx.save();
  S.cam.toScreen(ctx);
  ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
  const spindle = (tx, ty, hx, hy, mx, my, nx, ny, w, col, al) => {
    ctx.fillStyle = rgba(col, clamp(al, 0, 1));
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(mx + nx * w * 0.5, my + ny * w * 0.5);
    ctx.lineTo(hx, hy);
    ctx.lineTo(mx - nx * w * 0.5, my - ny * w * 0.5);
    ctx.closePath();
    ctx.fill();
  };
  if (kind === 'radial') {
    const Rout = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + 40 * px;
    const inner = (o.inner ?? 0.3) * H;
    const N = Math.round(240 * density);
    let i = 0;
    while (i < N) {
      const th0 = rng.next() * TAU;
      const m = 3 + Math.floor(rng.next() * 5);
      const rInC = inner * (1 + Math.pow(rng.next(), 2) * 1.9);
      const wC = rng.next();
      for (let j = 0; j < m && i < N; j++, i++) {
        const th = th0 + (j - m / 2) * rng.range(0.004, 0.012) + (rng.next() - 0.5) * 0.004;
        const r2 = clamp(wC + (rng.next() - 0.5) * 0.5), r3 = rng.next(), r4 = rng.next();
        if (r4 > 0.35 + 0.65 * k) continue;
        const rIn = rInC * rng.range(0.85, 1.2) + (1 - k) * Rout * 0.45;
        if (rIn >= Rout) continue;
        const w = width * (0.1 + 2.2 * r2 * r2 * r2);
        const c = Math.cos(th), s = Math.sin(th);
        const bx = cx + c * Rout, by = cy + s * Rout;
        const col = r3 < tint ? tintC : base;
        ctx.fillStyle = rgba(col, clamp(alpha * lerp(0.35, 1, r3), 0, 1));
        ctx.beginPath();
        ctx.moveTo(cx + c * rIn, cy + s * rIn);
        ctx.lineTo(bx - s * w * 0.5, by + c * w * 0.5);
        ctx.lineTo(bx + s * w * 0.5, by - c * w * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    const a = o.angle ?? 0, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const D = Math.hypot(W, H) * 0.5 + Math.hypot(cx - W / 2, cy - H / 2) + 120 * px;
    const Dp = Math.abs(nx) * W * 0.5 + Math.abs(ny) * H * 0.5;   // frame half-extent across the lines
    const N = Math.round(300 * density);
    const clearW = (o.clear ?? 0) * px;
    const speed = (o.speed ?? 2400) * px;
    const tb = step / fps, drift = speed * (t - tb);           // slide between boils
    const period = 2 * D + 2.6 * W;
    let i = 0, guard = 0;
    while (i < N && guard++ < N * 4) {
      // clump centre offset: rejection-sampled toward the frame edges, clear corridor through (cx,cy)
      const off0 = lerp(-Dp * 1.05, Dp * 1.05, rng.next());
      const wgt = 0.22 + 0.78 * smoothstep(clearW, 0.85 * Dp, Math.abs(off0));
      if (rng.next() > wgt) continue;
      if (clearW > 0 && Math.abs(off0) < clearW) continue;
      const m = 3 + Math.floor(rng.next() * 5);
      const full = rng.next() < 0.05;
      const lenC = (full ? 2.6 * W : W * lerp(0.4, 1.3, rng.next() ** 1.5)) * (o.length ?? 1);
      const alongC = lerp(-D, D, rng.next());
      const wC = rng.next();
      for (let j = 0; j < m && i < N; j++, i++) {
        const off = off0 + (rng.next() - 0.5) * 6 * px + (j - m / 2) * rng.range(2, 9) * px;
        const len = lenC * rng.range(0.6, 1.1);
        let along = alongC + rng.range(-0.15, 0.15) * lenC + drift;
        along = ((along + D + lenC) % period + period) % period - D - lenC;
        // one lead line carries the clump weight, its companions are hairlines (no solid white bands)
        const r2 = j === 0 ? wC : rng.next() * 0.45, r3 = rng.next();
        const w = width * (0.1 + 2.2 * r2 * r2 * r2);
        const qx = cx + nx * off + dx * along, qy = cy + ny * off + dy * along;
        const col = r3 < tint ? tintC : base;
        spindle(qx - dx * len * 0.5, qy - dy * len * 0.5, qx + dx * len * 0.5, qy + dy * len * 0.5, qx + dx * len * 0.22, qy + dy * len * 0.22, nx, ny, w, col, alpha * lerp(0.3, 1, r3));
      }
    }
  }
  ctx.restore();
}
