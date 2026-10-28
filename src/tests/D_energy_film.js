// Builder D debug harness: renders the real film with optional D-effect toggles (globalThis.__D_OFF, read by the
// D modules) so D effects can be checked in context. Edit OFF below between runs.
import * as F from '../film.js';
export const FPS = F.FPS, DURATION = F.DURATION, shots = F.shots;
const OFF = [];
globalThis.__D_OFF = Object.fromEntries(OFF.map((k) => [k, true]));
export async function setup(e) { if (F.setup) await F.setup(e); }
export function render(S) { F.render(S); }
