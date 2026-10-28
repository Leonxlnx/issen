// Builder E debug: close shot swarm only, toggles via time window (A: as is, B: no DOF, C: no streak)
import { makeCrystalSwarm, drawCrystals } from '../fx/crystals.js';
export const FPS = 60, DURATION = 3;
export const shots = [{ name: 'a', start: 0, end: 1 }, { name: 'b', start: 1, end: 2 }, { name: 'c', start: 2, end: 3 }];
let swB;
export function setup() { swB = makeCrystalSwarm(23, { count: 30, origin: { x: 2.4, y: -1.4, z: 2 }, target: { x: -2.4, y: -1.2, z: -4.6 }, spread: 1.5, size: 0.6, targetSpread: 1.7, formation: 'cloud', curve: 0.8 }); }
export function render(S) {
  const { cam } = S;
  const mode = Math.floor(S.t), t = 4.6;
  cam.x = -1.4 + 1.2 * 0.15; cam.y = -1.15; cam.z = -5.2; cam.fov = 48; cam.cy = S.H * 0.6; cam.roll = 0.05;
  drawCrystals(S, swB, { t, formT0: 3.45, formDur: 0.45, launchT0: 4.15, stagger: 0.7, speed: 18, dof: mode === 1 ? null : { focus: 7.5, aperture: 0.03 }, streak: mode === 2 ? 0 : 1, shatterAt: (c) => (c.i % 5 === 0 ? c.timeAt(0.62) : null) });
}
