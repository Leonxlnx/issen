// Builder B close-up bench: one framing per second (heads, hands, hard poses) for detail work.
//  0 Kai stand head   1 Akane stand head   2 Kai iai hands   3 Akane cast upper body
//  4 Akane blown_back 5 Akane float        6 Kai stand full  7 Akane stand full   8 Kai sheath upper
//  9 Kai dash        10 Kai slash_end      11 Akane head 3/4 wind
import { drawKai } from '../chars/kai.js';
import { drawAkane } from '../chars/akane.js';
import { rgba } from '../core/math.js';

export const FPS = 60;
export const DURATION = 12;
export const shots = [{ name: 'bench', start: 0, end: 12 }];

function floor(S, col = [30, 32, 58]) {
  const c = S.L.scene, cam = S.cam;
  const a = cam.project(-40, 0, cam.z + 0.3), b = cam.project(40, 0, cam.z + 0.3), d = cam.project(-40, 0, 60), e = cam.project(40, 0, 60);
  if (!a || !b || !d || !e) return;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, d.y, 0, Math.max(a.y, d.y + 1));
  g.addColorStop(0, rgba([80, 86, 136])); g.addColorStop(1, rgba(col));
  c.fillStyle = g;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y); c.lineTo(d.x, d.y); c.closePath(); c.fill();
  c.restore();
}
const BLUE = [70, 190, 255], RED = [255, 46, 96];
const KR = { rimA: { color: BLUE, dir: { x: -1, y: -0.35 }, k: 1 }, rimB: { color: RED, dir: { x: 1, y: -0.3 }, k: 0.55 } };
const AR = { rimA: { color: BLUE, dir: { x: -1, y: -0.3 }, k: 0.6 }, rimB: { color: RED, dir: { x: 1, y: -0.35 }, k: 1 } };

export function render(S) {
  const { cam, env, t } = S;
  env.lightAC = [0.05, 0.18, 0.55]; env.lightA = [-6, 0, 12, 14];
  env.lightBC = [0.55, 0.03, 0.12]; env.lightB = [6, 0, 12, 14];
  cam.fov = 40; cam.cy = S.H * 0.5;
  const seg = Math.floor(t);
  const wK = { x: -1.6, y: -0.3 }, wA = { x: 1.6, y: -0.3 };
  if (seg === 0) { cam.x = 0.0; cam.y = -1.55; cam.z = -1.15; drawKai(S, { pose: 'stand', t, wind: wK, eyeGlow: 0.9, ...KR }); }
  else if (seg === 1) { cam.x = 0.0; cam.y = -1.48; cam.z = -1.1; drawAkane(S, { facing: -1, pose: 'stand', t, wind: wA, eyeGlow: 0.9, ...AR }); }
  else if (seg === 2) { cam.x = 0.1; cam.y = -0.95; cam.z = -1.9; cam.cy = S.H * 0.45; drawKai(S, { pose: 'iai_ready', t, wind: wK, eyeGlow: 1, bladeOut: 0.04, ...KR }); }
  else if (seg === 3) { cam.x = -0.15; cam.y = -1.25; cam.z = -1.9; drawAkane(S, { facing: -1, pose: 'cast', t, wind: wA, eyeGlow: 1, castGlow: 0.9, ...AR }); }
  else if (seg === 4) { cam.x = -0.2; cam.y = -1.3; cam.z = -3.4; floor(S); drawAkane(S, { facing: -1, y: -0.4, pose: 'blown_back', t, wind: { x: 1.2, y: -0.2 }, eyeGlow: 0.6, scarfCut: 0.35, ...AR }); }
  else if (seg === 5) { cam.x = 0; cam.y = -1.25; cam.z = -3.2; floor(S); drawAkane(S, { facing: -1, y: -0.3, pose: 'float', t, wind: { x: 0.5, y: -0.2 }, eyeGlow: 0.7, scarfCut: 0.6, ...AR }); }
  else if (seg === 6) { cam.x = 0.1; cam.y = -0.95; cam.z = -3.6; cam.cy = S.H * 0.55; floor(S); drawKai(S, { pose: 'stand', t, wind: wK, eyeGlow: 0.9, ...KR }); }
  else if (seg === 7) { cam.x = -0.2; cam.y = -0.9; cam.z = -3.6; cam.cy = S.H * 0.55; floor(S); drawAkane(S, { facing: -1, pose: 'stand', t, wind: wA, eyeGlow: 0.9, ...AR }); }
  else if (seg === 8) { cam.x = 0.0; cam.y = -1.2; cam.z = -2.2; floor(S); drawKai(S, { facing: -1, pose: 'sheath', sheathT: 0.6, t, wind: { x: 0.5, y: -0.1 }, eyeGlow: 0.6, ...KR }); }
  else if (seg === 9) { cam.x = 0.0; cam.y = -0.6; cam.z = -3.2; cam.cy = S.H * 0.55; floor(S); drawKai(S, { pose: 'dash', t, wind: wK, eyeGlow: 1, ...KR }); }
  else if (seg === 10) { cam.x = -0.1; cam.y = -0.85; cam.z = -3.4; cam.cy = S.H * 0.55; floor(S); drawKai(S, { pose: 'slash_end', sword: 'drawn', t, wind: wK, eyeGlow: 1, ...KR }); }
  else { cam.x = 0.0; cam.y = -1.48; cam.z = -1.4; drawAkane(S, { facing: 1, pose: 'cast', t, wind: { x: -2.5, y: -0.4 }, eyeGlow: 1, ...AR }); }
}
