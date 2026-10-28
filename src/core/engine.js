// Frame driver. A "film" module exports { FPS, DURATION, shots:[{name,start,end}], setup?(engine), render(S) }.
// render(S) is called once per (sub)frame with a fresh state S:
//   S.t (seconds, global), S.L = { back, scene, emit, ui } 2D contexts, S.cam, S.env, S.post, S.W, S.H, S.frame
// and must be a pure function of S.t.
import { Camera } from './camera.js';
import { Compositor, DEFAULT_ENV, DEFAULT_POST } from './gl.js';
import { makeCanvas } from './draw.js';

export class Engine {
  constructor(outCanvas, film, W = 1920, H = 1080) {
    this.W = W; this.H = H; this.film = film;
    this.gl = new Compositor(outCanvas, W, H);
    this.canvases = {};
    this.L = {};
    for (const n of ['back', 'scene', 'emit', 'ui']) {
      const c = makeCanvas(W, H);
      this.canvases[n] = c;
      this.L[n] = c.getContext('2d', { willReadFrequently: false });
    }
    this.cam = new Camera(W, H);
  }
  async init() { if (this.film.setup) await this.film.setup(this); }
  shotAt(t) {
    const shots = this.film.shots || [];
    for (const s of shots) if (t >= s.start && t < s.end) return s;
    return shots.length ? (t < shots[0].start ? shots[0] : shots[shots.length - 1]) : null;
  }
  clearLayers() {
    const { W, H } = this;
    for (const n in this.L) {
      const c = this.L[n];
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
      if (n === 'back' || n === 'emit') { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); }
      else c.clearRect(0, 0, W, H);
    }
  }
  evalAt(t, frame) {
    this.clearLayers();
    this.cam.reset();
    const S = { t, frame, W: this.W, H: this.H, L: this.L, cam: this.cam, env: DEFAULT_ENV(), post: DEFAULT_POST(), engine: this, shot: this.shotAt(t) };
    this.film.render(S);
    for (const n in this.L) this.L[n].setTransform(1, 0, 0, 1, 0, 0);
    return S;
  }
  // Render one output frame with `sub` motion-blur samples over `shutter` (fraction of a frame).
  renderFrame(frame, sub = 1, shutter = 0.5) {
    const fps = this.film.FPS;
    const tc = frame / fps;
    const shot = this.shotAt(tc);
    const lo = shot ? shot.start : -1e9, hi = shot ? shot.end - 1e-4 : 1e9;
    const subs = sub < 0 ? (typeof this.film.subframes === 'function' ? this.film.subframes(tc) : 1) : sub;
    const n = Math.max(1, subs | 0);
    this.gl.beginAccum();
    let postS = null;
    for (let i = 0; i < n; i++) {
      let t = n === 1 ? tc : tc + ((i + 0.5) / n - 0.5) * shutter / fps;
      t = Math.min(hi, Math.max(lo, t));
      const S = this.evalAt(t, frame);
      for (const k of ['back', 'scene', 'emit']) this.gl.upload(k, this.canvases[k]);
      this.gl.composite(this.cam, S.env, t, 1 / n);
      if (i === Math.floor(n / 2)) { postS = S; this.gl.upload('ui', this.canvases.ui); }
    }
    this.gl.finish(postS.post, frame, true);
    return postS;
  }
}
