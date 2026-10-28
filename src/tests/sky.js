// Env-only test: sky + cloud sea from the two main camera setups.
export const FPS = 60;
export const DURATION = 4;
export const shots = [{ name: 'low', start: 0, end: 2 }, { name: 'high', start: 2, end: 4 }];
export function render(S) {
  const { cam, env } = S;
  env.lightAC = [0.03, 0.12, 0.45]; env.lightA = [-4, -1, 0, 25];
  env.lightBC = [0.45, 0.03, 0.08]; env.lightB = [4, -1, 0, 25];
  if (S.t < 2) { cam.x = 0; cam.y = -1.2; cam.z = -14 + S.t; cam.fov = 45; cam.cy = S.H * 0.62; cam.roll = 0.03; }
  else { cam.x = 10; cam.y = -12; cam.z = -30; cam.fov = 55; cam.cy = S.H * 0.42; env.skyYaw = 0.6; }
}
