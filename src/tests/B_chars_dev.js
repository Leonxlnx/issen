// Builder B dev bench: one pose per second at large scale, then a lineup.
import { drawKai } from '../chars/kai.js';
import { drawAkane } from '../chars/akane.js';
import { rgba } from '../core/math.js';

export const FPS = 60;
export const DURATION = 11;
export const shots = [{ name: 'dev', start: 0, end: 11 }];

export function floor(S, col = [34, 37, 62]) {
  const c = S.L.scene, cam = S.cam;
  const a = cam.project(-40, 0, -1.5), b = cam.project(40, 0, -1.5), d = cam.project(-40, 0, 60), e = cam.project(40, 0, 60);
  if (!a || !b) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, d.y, 0, a.y);
  g.addColorStop(0, rgba([70, 76, 120])); g.addColorStop(1, rgba(col));
  c.fillStyle = g;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y); c.lineTo(d.x, d.y); c.closePath(); c.fill();
  c.restore();
}

export function render(S) {
  const { cam, env, t } = S;
  env.lightAC = [0.05, 0.2, 0.6]; env.lightA = [-6, 0, 10, 12];
  env.lightBC = [0.6, 0.03, 0.12]; env.lightB = [6, 0, 10, 12];
  cam.fov = 40; cam.cy = S.H * 0.62;
  const seg = Math.floor(t);
  const kp = ['stand', 'iai_ready', 'dash', 'slash_end', 'sheath'];
  const ap = ['stand', 'cast', 'blown_back', 'float'];
  if (seg < 5) {
    cam.x = 0.1; cam.y = -0.95; cam.z = -4.2;
    if (seg === 2) cam.y = -0.6;
    floor(S);
    drawKai(S, { x: 0, y: 0, z: 0, pose: kp[seg], t, wind: { x: -1.2, y: -0.2 }, eyeGlow: 0.9, sword: seg === 3 ? 'drawn' : 'sheathed', sheathT: seg === 4 ? 0.6 : undefined });
  } else if (seg < 9) {
    const i = seg - 5;
    cam.x = -0.1; cam.y = -0.9; cam.z = -4.0;
    if (i === 3) cam.y = -1.3;
    floor(S);
    drawAkane(S, { x: 0, y: i === 3 ? -0.4 : 0, z: 0, facing: -1, pose: ap[i], t, wind: { x: 1.2, y: -0.2 }, eyeGlow: 0.9, castGlow: i === 1 ? 1 : 0, scarfCut: 0 });
  } else {
    cam.x = 0; cam.y = -1.0; cam.z = -11;
    floor(S);
    kp.forEach((p, i) => drawKai(S, { x: -6.5 + i * 1.9, y: 0, z: 0, pose: p, t, wind: { x: -1.2, y: -0.2 }, sword: i === 3 ? 'drawn' : 'sheathed', sheathT: 0.5 }));
    ap.forEach((p, i) => drawAkane(S, { x: 3.2 + i * 1.6, y: i === 3 ? -0.3 : 0, z: 0, facing: -1, pose: p, t, wind: { x: 1.2, y: -0.2 }, castGlow: i === 1 ? 1 : 0, scarfCut: seg === 10 ? 0.5 : 0 }));
  }
}
