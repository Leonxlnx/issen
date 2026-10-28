// Builder B test film: characters over the env.
//  0.0-3.0  standoff, medium-wide low angle (~400 px tall), slow push-in
//  3.0-6.6  Kai large (~700 px): iai_ready -> dash (smear) -> slash_end (drawn blade)
//  6.6-9.6  Akane large: cast (palm glow) -> blown_back (scarf cut)
//  9.6-10.6 silhouette / impact-frame mode
// 10.6-12.6 aftermath: Kai sheath (back 3/4) + Akane float with drifting cut scarf
import { drawKai } from '../chars/kai.js';
import { drawAkane } from '../chars/akane.js';
import { rgba, clamp, smoothstep, E, prog, lerp } from '../core/math.js';

export const FPS = 60;
export const DURATION = 12.6;
export const shots = [
  { name: 'standoff', start: 0, end: 3 },
  { name: 'kai', start: 3, end: 6.6 },
  { name: 'akane', start: 6.6, end: 9.6 },
  { name: 'sil', start: 9.6, end: 10.6 },
  { name: 'after', start: 10.6, end: 12.6 },
];

function floor(S, near = [26, 28, 52], far = [84, 90, 140]) {
  const c = S.L.scene, cam = S.cam;
  const a = cam.project(-60, 0, cam.z + 0.3), b = cam.project(60, 0, cam.z + 0.3), d = cam.project(-60, 0, 80), e = cam.project(60, 0, 80);
  if (!a || !b || !d || !e) return;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, d.y, 0, Math.min(a.y, S.H * 2));
  g.addColorStop(0, rgba(far)); g.addColorStop(0.25, rgba(far.map((v, i) => lerp(v, near[i], 0.5)))); g.addColorStop(1, rgba(near));
  c.fillStyle = g;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y); c.lineTo(d.x, d.y); c.closePath(); c.fill();
  c.restore();
}
// soft energy pools on the floor (stand-in for the stage's reflections)
function pool(S, x, z, col, k = 1) {
  const p = S.cam.project(x, 0, z); if (!p) return;
  const e = S.L.emit; e.save(); e.setTransform(1, 0, 0, 1, 0, 0); e.globalCompositeOperation = 'lighter';
  const r = p.s * 1.6;
  const g = e.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, rgba(col, 0.25 * k)); g.addColorStop(1, rgba(col, 0));
  e.fillStyle = g; e.save(); e.translate(p.x, p.y); e.scale(1, 0.22); e.translate(-p.x, -p.y); e.beginPath(); e.arc(p.x, p.y, r, 0, Math.PI * 2); e.fill(); e.restore();
  e.restore();
}

const BLUE = [70, 190, 255], RED = [255, 46, 96];

export function render(S) {
  const { cam, env, post, t } = S;
  env.lightAC = [0.05, 0.18, 0.55]; env.lightA = [-6, 0, 12, 14];
  env.lightBC = [0.55, 0.03, 0.12]; env.lightB = [6, 0, 12, 14];
  cam.fov = 40;
  if (t < 3) {
    // 1. standoff
    const k = E.inOutSine(t / 3);
    cam.x = 0; cam.y = -0.75; cam.z = -7.2 + k * 0.6; cam.cy = S.H * 0.64;
    floor(S);
    pool(S, -2.4, 0.2, BLUE); pool(S, 2.4, 0.2, RED);
    drawKai(S, { x: -2.4, y: 0, z: 0, facing: 1, pose: 'stand', t, wind: { x: -1.6, y: -0.3 }, eyeGlow: 0.85, aura: 0.25, rimA: { color: BLUE, dir: { x: -1, y: -0.3 }, k: 1 }, rimB: { color: RED, dir: { x: 1, y: -0.2 }, k: 0.55 } });
    drawAkane(S, { x: 2.4, y: 0, z: 0, facing: -1, pose: 'stand', t, wind: { x: 1.6, y: -0.3 }, eyeGlow: 0.85, aura: 0.25, rimA: { color: BLUE, dir: { x: -1, y: -0.2 }, k: 0.55 }, rimB: { color: RED, dir: { x: 1, y: -0.3 }, k: 1 } });
  } else if (t < 6.6) {
    // 2. Kai large
    const lt = t - 3;
    cam.x = 0.15; cam.y = -0.85; cam.z = -3.9; cam.cy = S.H * 0.6;
    let pose = 'iai_ready', smear = 0, sword = 'sheathed', bladeOut = 0, glow = 0.9;
    if (lt < 1.2) { pose = 'iai_ready'; bladeOut = smoothstep(0.7, 1.15, lt) * 0.04; glow = lerp(0.6, 1, smoothstep(0.3, 0.9, lt)); }
    else if (lt < 2.3) { const k = smoothstep(1.2, 1.35, lt); pose = { a: 'iai_ready', b: 'dash', k }; smear = smoothstep(1.25, 1.5, lt) * (1 - smoothstep(2.1, 2.3, lt)); cam.y = -0.7; bladeOut = 0.04; }
    else { const k = E.outCubic(smoothstep(2.3, 2.55, lt)); pose = { a: 'dash', b: 'slash_end', k }; sword = 'drawn'; smear = (1 - k) * 0.8; cam.y = lerp(-0.7, -0.85, k); }
    floor(S);
    pool(S, 0, 0.2, BLUE, 1.2);
    drawKai(S, { x: 0, y: 0, z: 0, facing: 1, pose, t, wind: { x: -1.2, y: -0.2 }, eyeGlow: glow, aura: 0.35 + smear * 0.4, smear, sword, bladeOut, bladeGlow: sword === 'drawn' ? 1 : 0.6,
      rimA: { color: BLUE, dir: { x: -1, y: -0.35 }, k: 1 }, rimB: { color: [120, 220, 255], dir: { x: 1, y: -0.4 }, k: 0.5 } });
  } else if (t < 9.6) {
    // 3. Akane large
    const lt = t - 6.6;
    cam.x = -0.15; cam.y = -0.95; cam.z = -3.9; cam.cy = S.H * 0.6;
    let pose = 'cast', castGlow = 0, scarfCut = 0, x = 0, y = 0;
    if (lt < 1.6) { const k = E.outBack(smoothstep(0.0, 0.35, lt)); pose = { a: 'stand', b: 'cast', k: clamp(k, 0, 1.08) }; castGlow = smoothstep(0.3, 0.8, lt) * (0.8 + 0.2 * Math.sin(lt * 20)); }
    else { const k = E.outCubic(smoothstep(1.6, 1.85, lt)); pose = { a: 'cast', b: 'blown_back', k }; castGlow = (1 - k) * 0.8; scarfCut = smoothstep(1.7, 3.0, lt); x = k * 0.6 + (lt - 1.6) * 0.25; y = -k * 0.5; }
    floor(S);
    pool(S, 0, 0.2, RED, 1.2);
    drawAkane(S, { x, y, z: 0, facing: -1, pose, t, wind: { x: 1.2, y: -0.2 }, eyeGlow: 0.9, castGlow, scarfCut, aura: 0.3,
      rimA: { color: [255, 120, 160], dir: { x: -1, y: -0.35 }, k: 0.5 }, rimB: { color: RED, dir: { x: 1, y: -0.35 }, k: 1 } });
  } else if (t < 10.6) {
    // 4. silhouettes / impact frames: alternate inverted frames every 3 frames
    const lt = t - 9.6;
    const flip = Math.floor(lt * 20) % 2;
    cam.x = 0; cam.y = -1.0; cam.z = -5.5; cam.cy = S.H * 0.55;
    const c = S.L.scene; c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = flip ? '#f4f1ea' : '#0b0a12'; c.fillRect(0, 0, S.W, S.H);
    c.restore();
    const silColor = flip ? [10, 8, 18] : [245, 240, 235];
    drawKai(S, { x: -0.7, y: -0.1, z: 0, facing: 1, pose: 'slash_end', sword: 'drawn', t: 9.6, silhouette: 1, silColor });
    drawAkane(S, { x: 1.4, y: -0.5, z: 0.5, facing: -1, pose: 'blown_back', t: 9.6, silhouette: 1, silColor: flip ? [200, 10, 40] : [245, 240, 235] });
  } else {
    // 5. aftermath: back to back, slow lateral dolly; sheathing + floating with cut scarf drifting
    const lt = t - 10.6;
    cam.x = -0.4 + lt * 0.25; cam.y = -1.0; cam.z = -6.2; cam.cy = S.H * 0.6;
    floor(S);
    pool(S, -1.6, 0.2, BLUE, 0.8); pool(S, 1.8, 0.2, RED, 0.6);
    drawAkane(S, { x: 1.8, y: -0.25, z: 0.8, facing: 1, pose: 'float', t, wind: { x: 0.6, y: -0.2 }, eyeGlow: 0.5, scarfCut: 0.4 + lt * 0.3, aura: 0.15 });
    // back to back: Kai (left) faces away from Akane, 3/4 from behind, sliding the blade home
    drawKai(S, { x: -1.6, y: 0, z: 0, facing: -1, pose: 'sheath', sheathT: smoothstep(0.2, 1.9, lt), t, wind: { x: -0.5, y: -0.1 }, eyeGlow: 0.6, aura: 0.2 });
  }
}
