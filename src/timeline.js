// Single source of truth for timing: shots, story beats and sound cues.
export const FPS = 60;
export const DURATION = 13.0;

export const SHOTS = [
  { name: 'standoff', start: 0.0, end: 2.2 },
  { name: 'hilt', start: 2.2, end: 3.0 },
  { name: 'eye', start: 3.0, end: 3.9 },
  { name: 'barrage', start: 3.9, end: 5.16 },
  { name: 'flashstep', start: 5.16, end: 6.0 },
  { name: 'impact', start: 6.0, end: 6.35 },
  { name: 'issen', start: 6.35, end: 7.9 },
  { name: 'aftermath', start: 7.9, end: 9.5 },
  { name: 'chin', start: 9.5, end: 10.2 },
  { name: 'skysplit', start: 10.2, end: 13.0 },
];

// story beats (seconds) — picture and sound both read these
export const B = {
  clash: 0.3,            // the two energies collide between the fighters (hook)
  koiguchi: 2.47,        // thumb pushes tsuba (click)
  gleam: 2.62,
  eyeOpen: 3.16,
  eyeIgnite: 3.34,
  akaneCast: 4.02,
  crystalsForm: 4.08,
  crystalsLaunch: 4.62,
  vanish: 5.47,          // Kai flash-steps (thunder crack)
  breath: 5.84,          // everything hangs before the hit
  impact: 6.0,           // first impact frame
  slash: 6.35,           // the great crescent
  shatter: 6.4,
  waveOut: 6.5,
  issenWide: 7.05,       // cut from the hero two-shot to the wide
  slowmo: 7.9,
  sheathClick: 9.98,
  skyBurst: 10.46,
  title: 11.35,
};
