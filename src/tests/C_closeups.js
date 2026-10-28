// Builder C test film: the three macro inserts back to back.
//   0.0–1.2  HILT    thumb pushes the tsuba, blade slides out; the arcs calm while the steel glints
//   1.2–2.2  EYE     snaps open, iris ignites cyan, lightning veins, red crystal reflections, second pulse
//   2.2–3.4  SHEATH  blade slides home, click (spark burst), held beat
import { prog, E, clamp, smoothstep } from '../core/math.js';
import { drawHiltCloseup, drawEyeCloseup, drawSheathCloseup, prepareCloseups, closeupGrade } from '../chars/closeups.js';

export const FPS = 60;
export const DURATION = 3.4;
export const shots = [
  { name: 'hilt', start: 0, end: 1.2 },
  { name: 'eye', start: 1.2, end: 2.2 },
  { name: 'sheath', start: 2.2, end: 3.4 },
];
export async function setup(engine) { prepareCloseups(engine.W); }

export function render(S) {
  const t = S.t;
  if (t < 1.2) {
    const lt = t;
    closeupGrade(S, 'hilt');
    const push = prog(lt, 0.18, 0.62, E.outCubic);
    const gleam = prog(lt, 0.6, 1.05, E.inOutQuad);
    // the arcs build with the push, then calm while the steel glints (the gleam is its own beat)
    const sparks = 0.35 + 0.65 * smoothstep(0.2, 0.55, lt) * (1 - 0.7 * smoothstep(0.6, 0.7, lt) * (1 - smoothstep(0.95, 1.1, lt)));
    drawHiltCloseup(S, { t: lt, push, gleam, sparks });
  } else if (t < 2.2) {
    const lt = t - 1.2;
    closeupGrade(S, 'eye');
    const open = prog(lt, 0.08, 0.2, E.outBack);
    // second, smaller pulse after the ignition so the held end keeps breathing
    const pulse2 = smoothstep(0.74, 0.8, lt) * (1 - smoothstep(0.8, 0.98, lt));
    const glow = prog(lt, 0.26, 0.72, E.outQuad) + 0.12 * pulse2;
    drawEyeCloseup(S, { t: lt, open, glow, reflect: prog(lt, 0.35, 0.9, E.outQuad), zoom: 1 + 0.015 * pulse2 });
  } else {
    const lt = t - 2.2;
    closeupGrade(S, 'sheath');
    // slow glide, then the last centimetres snap home ("chin")
    const x = clamp(lt / 0.62);
    const k = 0.4 * x + 0.6 * x * x * x;
    const click = lt >= 0.62 ? lt - 0.62 : -1;
    // tiny camera kick at the click (director would do this in film.js)
    if (click >= 0 && click < 0.25) { const d = Math.exp(-click * 18); S.cam.shakeX = Math.sin(click * 90) * 5 * d; S.cam.shakeY = Math.cos(click * 70) * 4 * d; }
    drawSheathCloseup(S, { t: lt, k, click });
  }
}
