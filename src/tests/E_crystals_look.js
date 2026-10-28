// Builder E look-dev: hero / medium / small crystals and shard piles over the real backdrop,
// several fixed orientations (t selects the pose set) for side-by-side facet design checks.
import { TAU } from '../core/math.js';
import { drawGem, gemGeometry, drawShards } from '../fx/crystals.js';
import { V, rotAxis } from '../fx/particles.js';

export const FPS = 60;
export const DURATION = 4;
export const shots = [{ name: 'look', start: 0, end: 4 }];
const G = [];
let W = null;
export async function setup() {
  for (let i = 0; i < 16; i++) G.push(gemGeometry(500 + i));
  try {
    const [ruins] = await Promise.all([import('../world/ruins.js')]);
    W = { ruins, world: ruins.buildRuins(7) };
  } catch (e) { W = null; }
}
function basisOf(d, roll) {
  const ref = Math.abs(d.y) < 0.92 ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 1 };
  const u0 = V.norm(V.cross(d, ref)), w0 = V.cross(d, u0);
  const c = Math.cos(roll), s = Math.sin(roll);
  return { d, u: V.add(V.scale(u0, c), V.scale(w0, s)), w: V.sub(V.scale(w0, c), V.scale(u0, s)) };
}
export function render(S) {
  const { cam, env, t } = S;
  env.lightAC = [0.05, 0.15, 0.5]; env.lightA = [-20, 0, 60, 30];
  env.lightBC = [0.5, 0.04, 0.1]; env.lightB = [20, 0, 60, 30];
  cam.x = 0; cam.y = -1.5; cam.z = -6; cam.fov = 40; cam.cy = S.H * 0.55;
  if (W) W.ruins.drawRuins(S, W.world, {});
  const tb = Math.floor(t * 24);
  const set = Math.floor(t); // pose set 0..3
  const sp = t - set;          // slow motion inside a set
  // hero
  {
    const d = V.norm(rotAxis({ x: -1, y: -0.35, z: 0.25 }, { x: 0, y: 1, z: 0 }, set * 1.1 + sp * 0.15));
    drawGem(S, G[set], { x: -1.3, y: -1.7, z: 0 }, basisOf(d, set * 0.9 + sp * 0.2), 3.0, { tb, seed: 500 + set, tip: 0.6, width: 1.1 });
  }
  // medium
  for (let i = 0; i < 5; i++) {
    const d = V.norm(rotAxis({ x: 1, y: -0.5, z: 0.2 }, V.norm({ x: 0.3, y: 1, z: 0.2 }), set * 0.8 + i * 1.3 + sp * 0.3));
    drawGem(S, G[4 + i], { x: 1.7 + (i % 2) * 1.0, y: -3.1 + i * 0.75, z: 1 }, basisOf(d, set + i), 0.9, { tb, seed: 504 + i, tip: 0.4 });
  }
  // small (wide-shot scale)
  for (let i = 0; i < 7; i++) {
    const d = V.norm(rotAxis({ x: -1, y: 0.1, z: 0 }, { x: 0, y: 0, z: 1 }, i * 0.5 - 1.2 + set * 0.7));
    drawGem(S, G[9 + i], { x: -3.6 + i * 0.6, y: 0.5, z: 2 }, basisOf(d, set * 2 + i), 0.4, { tb, seed: 509 + i, tip: 0.4 });
  }
  drawShards(S, { seed: 3 + set, box: { x0: -4, x1: 4, y0: -4, y1: 1, z0: 3, z1: 8 }, t, t0: -5, count: 18, speed: 0.2, gravity: 0, drag: 0.5, size: 0.3, life: 99, spin: 0.25, palette: 'prism', glitter: 0.5 });
  drawShards(S, { seed: 7 + set, box: { x0: -4, x1: 4, y0: -4, y1: 1, z0: 2, z1: 7 }, t, t0: -5, count: 18, speed: 0.2, gravity: 0, drag: 0.5, size: 0.3, life: 99, spin: 0.25, glitter: 0.5 });
}
