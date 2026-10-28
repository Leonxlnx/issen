// Builder E look-dev: energy ribbons from the wide standoff camera (0-1 s) and an over-the-shoulder medium (1-2 s).
import { drawCrystalRibbons, makeCrystalSwarm, drawCrystals } from '../fx/crystals.js';
export const FPS = 60, DURATION = 2;
export const shots = [{ name: 'wide', start: 0, end: 1 }, { name: 'med', start: 1, end: 2 }];
let sw, sw2;
export function setup() {
  sw = makeCrystalSwarm(11, { count: 38, origin: { x: 4, y: -1.3, z: 0 }, target: { x: -4, y: -1, z: 0 }, spread: 1.3, size: 0.5, formation: 'halo' });
  sw2 = makeCrystalSwarm(5, { count: 30, origin: { x: 0.3, y: -1.4, z: 1.8 }, target: { x: -1.2, y: -1.1, z: -5.5 }, spread: 1.2, size: 0.55, formation: 'fan' });
}
export function render(S) {
  const { cam, env } = S;
  env.lightAC = [0.05, 0.15, 0.5]; env.lightA = [-4, -1, 0, 25];
  env.lightBC = [0.5, 0.04, 0.1]; env.lightB = [4, -1, 0, 25];
  const lt = S.t % 1, t = 0.3 + lt * 1.2;
  if (S.t < 1) {
    cam.x = 0.3; cam.y = -1.0; cam.z = -12.5; cam.fov = 42; cam.cy = S.H * 0.66; cam.roll = -0.03;
    drawCrystalRibbons(S, { origin: { x: 4.4, y: -1.35, z: 0.1 }, target: { x: -4, y: -1, z: 0 }, t, t0: 0.05, grow: 0.6, length: 7.5, radius: 1.1, spreadR: 0.25, turns: 0.4, count: 5, width: 0.5, spin: 2, seed: 2 });
    drawCrystals(S, sw, { t, formT0: 0.15, formDur: 0.8, launchT0: 1.35, stagger: 0.55, speed: 20 });
  } else {
    cam.x = 1.4; cam.y = -1.45; cam.z = -3.6; cam.fov = 50; cam.cy = S.H * 0.55; cam.roll = 0.04;
    drawCrystalRibbons(S, { origin: { x: 0.3, y: -1.4, z: 1.8 }, target: { x: -1.2, y: -1.1, z: -5.5 }, t, t0: 0.05, grow: 0.6, length: 6, radius: 0.9, spreadR: 0.3, turns: 0.4, count: 5, width: 0.45, spin: 2, seed: 3 });
    drawCrystals(S, sw2, { t, formT0: 0.15, formDur: 0.6, launchT0: 1.35, stagger: 0.55, speed: 20, dof: { focus: 5.4 } });
  }
}
