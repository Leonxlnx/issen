// Canvas2D helpers for the anime look: cel shading via shifted-shape crescents, rim light,
// tapered strokes, glow strokes. Shapes are Path2D in whatever transform is active.
import { rgba, vnorm } from './math.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Cel-shade a closed Path2D.
//  base/shade/rim: [r,g,b]; light: direction TOWARD the key light (unit, in current units);
//  shadeW: crescent width of the shadow (current units); rim: rim colour, rimDir toward rim light.
export function celFill(ctx, path, o) {
  const { base, shade = null, light = { x: -0.5, y: -0.8 }, shadeW = 0, rim = null, rimDir = { x: 1, y: 0 }, rimW = 0, rimAlpha = 1,
    line = null, lineW = 0, alpha = 1, emit = null, emitRim = 0 } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(shade || base);
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  if (shade && shadeW > 0) {
    const l = vnorm(light);
    ctx.translate(l.x * shadeW, l.y * shadeW);
    ctx.fillStyle = rgba(base);
    ctx.fill(path);
  }
  ctx.restore();
  if (rim && rimW > 0) {
    // rim = path minus path shifted away from the rim light
    ctx.save();
    ctx.clip(path);
    const r = vnorm(rimDir);
    ctx.globalAlpha = alpha * rimAlpha;
    ctx.fillStyle = rgba(rim);
    ctx.beginPath();
    // even-odd of (path, path shifted away) inside clip(path) = crescent facing the rim light
    const p2 = new Path2D();
    p2.addPath(path);
    p2.addPath(path, new DOMMatrix([1, 0, 0, 1, -r.x * rimW, -r.y * rimW]));
    ctx.fill(p2, 'evenodd');
    ctx.restore();
    if (emit && emitRim > 0) {
      emit.save();
      emit.setTransform(ctx.getTransform());
      emit.clip(path);
      emit.globalAlpha = emitRim * rimAlpha;
      emit.globalCompositeOperation = 'lighter';
      emit.fillStyle = rgba(rim);
      emit.fill(p2, 'evenodd');
      emit.restore();
    }
  }
  if (line && lineW > 0) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(line, alpha);
    ctx.lineWidth = lineW;
    ctx.stroke(path);
  }
  ctx.restore();
}

// polygon -> Path2D (closed)
export function polyPath(pts, closed = true) {
  const p = new Path2D();
  if (!pts.length) return p;
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  if (closed) p.closePath();
  return p;
}
// smooth closed path through points (Catmull-Rom -> bezier)
export function smoothPath(pts, closed = true, tension = 0.5) {
  const p = new Path2D();
  const n = pts.length;
  if (n < 3) return polyPath(pts, closed);
  const get = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  p.moveTo(pts[0].x, pts[0].y);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t = tension / 3 * 2;
    p.bezierCurveTo(p1.x + (p2.x - p0.x) * t / 2, p1.y + (p2.y - p0.y) * t / 2, p2.x - (p3.x - p1.x) * t / 2, p2.y - (p3.y - p1.y) * t / 2, p2.x, p2.y);
  }
  if (closed) p.closePath();
  return p;
}
// tapered ribbon along a polyline: widths per point -> closed outline points
export function ribbon(pts, widths) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = (typeof widths === 'function' ? widths(i / (pts.length - 1), i) : widths[i]) * 0.5;
    L.push({ x: pts[i].x - dy * w, y: pts[i].y + dx * w });
    R.push({ x: pts[i].x + dy * w, y: pts[i].y - dx * w });
  }
  return L.concat(R.reverse());
}
// additive glow stroke: several passes from wide/dim to thin/bright
export function glowStroke(ctx, path, color, width, core = [255, 255, 255], passes = 3, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < passes; i++) {
    const k = 1 - i / passes;
    ctx.strokeStyle = rgba(color, alpha * (0.18 + 0.25 * (1 - k)));
    ctx.lineWidth = width * (1 + k * 3);
    ctx.stroke(path);
  }
  ctx.strokeStyle = rgba(core, alpha);
  ctx.lineWidth = width * 0.5;
  ctx.stroke(path);
  ctx.restore();
}
