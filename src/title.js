// End title: 一閃 cut by a diagonal slash — the two halves slide apart a few pixels.
import { clamp, E, prog } from './core/math.js';

export function drawTitle(S, k, slide, o = {}) {
  if (k <= 0) return;
  const ctx = S.L.ui, W = S.W, H = S.H;
  const size = Math.round(H * 0.15);
  const cx = o.cx ?? W / 2, cy = o.cy ?? H * 0.5;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // soft scrim: lifts the title off the lightning band behind it
  ctx.save();
  ctx.translate(cx, cy + size * 0.2); ctx.scale(1.5, 0.75);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.2);
  sg.addColorStop(0, `rgba(2,4,16,${0.42 * k})`); sg.addColorStop(1, 'rgba(2,4,16,0)');
  ctx.fillStyle = sg; ctx.fillRect(-size * 2.2, -size * 2.2, size * 4.4, size * 4.4);
  ctx.restore();
  ctx.font = `600 ${size}px "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "MS Mincho", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ang = -0.38;                       // the cut
  const nx = Math.sin(ang), ny = -Math.cos(ang);
  const off = slide * size * 0.05;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.beginPath();
    // half-plane clip along the cut line through the centre
    const L = W;
    const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
    ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx + nx * side * L, cy + dy + ny * side * L);
    ctx.lineTo(cx - dx + nx * side * L, cy - dy + ny * side * L);
    ctx.closePath();
    ctx.clip();
    const sx = Math.cos(ang) * off * side, sy = Math.sin(ang) * off * side;
    ctx.globalAlpha = k;
    ctx.shadowColor = 'rgba(120,200,255,0.9)';
    ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = '#f4f8ff';
    ctx.fillText('一閃', cx + sx, cy + sy);
    ctx.shadowBlur = 0;
    ctx.fillText('一閃', cx + sx, cy + sy);
    ctx.restore();
  }
  // the cut line itself
  const lk = clamp(k * 1.4);
  const len = W * 0.18 * E.outExpo(clamp(slide * 1.5));
  ctx.globalAlpha = lk * (1 - clamp(slide - 0.6) * 1.5);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(120,210,255,1)'; ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(ang) * len, cy - Math.sin(ang) * len);
  ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
  ctx.stroke();
  // romanised subtitle
  ctx.shadowBlur = 0;
  ctx.globalAlpha = k * 0.95;
  ctx.font = `500 ${Math.round(H * 0.05)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#cfe6ff';
  ctx.letterSpacing = `${Math.round(H * 0.024)}px`;
  ctx.fillText('ISSEN', cx + H * 0.006, cy + size * 0.86);
  ctx.restore();
}
