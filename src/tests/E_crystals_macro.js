// Builder E facet check: a lineup of crystals at several scales/orientations, slowly tumbling.
import { TAU } from '../core/math.js';
import { drawGem, gemGeometry, drawShards } from '../fx/crystals.js';
import { V, rotAxis } from '../fx/particles.js';

export const FPS = 60;
export const DURATION = 4;
export const shots = [{ name: 'macro', start: 0, end: 4 }];
const G = [];
export function setup() { for (let i = 0; i < 12; i++) G.push(gemGeometry(500 + i)); }

export function render(S) {
  const { cam, env, t } = S;
  env.lightAC = [0.05, 0.15, 0.5]; env.lightA = [-20, 0, 60, 30];
  env.lightBC = [0.5, 0.04, 0.1]; env.lightB = [20, 0, 60, 30];
  cam.x = 0; cam.y = -1.5; cam.z = -6; cam.fov = 40; cam.cy = S.H * 0.55;
  const tb = Math.floor(t * 24);
  // big hero crystal
  {
    const d = V.norm(rotAxis({ x: -1, y: -0.35, z: 0.25 }, { x: 0, y: 1, z: 0 }, t * 0.4));
    const B = basisOf(d, t * 0.6);
    drawGem(S, G[0], { x: -1.2, y: -1.6, z: 0 }, B, 3.0, { tb, seed: 500, tip: 0.6, width: 1.1 });
  }
  // row of medium crystals
  for (let i = 0; i < 5; i++) {
    const d = V.norm(rotAxis({ x: 1, y: -0.5, z: 0.2 }, V.norm({ x: 0.3, y: 1, z: 0.2 }), t * 0.7 + i * 1.3));
    drawGem(S, G[1 + i], { x: 1.8 + (i % 2) * 0.9, y: -3.1 + i * 0.75, z: 1 }, basisOf(d, t + i), 0.9, { tb, seed: 501 + i, tip: 0.4 });
  }
  // small ones (wide-shot scale)
  for (let i = 0; i < 6; i++) {
    const d = V.norm(rotAxis({ x: -1, y: 0.1, z: 0 }, { x: 0, y: 0, z: 1 }, i * 0.5 - 1.2 + t * 0.3));
    drawGem(S, G[6 + i], { x: -3.6 + i * 0.6, y: 0.4, z: 2 }, basisOf(d, t * 2 + i), 0.45, { tb, seed: 506 + i, tip: 0.4 });
  }
  drawShards(S, { seed: 3, box: { x0: -4, x1: 4, y0: -4, y1: 1, z0: 3, z1: 8 }, t, t0: -5, count: 24, speed: 0.2, gravity: 0, drag: 0.5, size: 0.35, life: 99, spin: 0.25, palette: 'prism', glitter: 0.5 });
}
function basisOf(d, roll) {
  const ref = Math.abs(d.y) < 0.92 ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 1 };
  const u0 = V.norm(V.cross(d, ref)), w0 = V.cross(d, u0);
  const c = Math.cos(roll), s = Math.sin(roll);
  return { d, u: V.add(V.scale(u0, c), V.scale(w0, s)), w: V.sub(V.scale(w0, c), V.scale(u0, s)) };
}
