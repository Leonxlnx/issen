// WebGL2 compositor: env (sky + cloud sea) + canvas layers -> HDR accumulation (motion blur)
// -> dual-filter bloom -> tonemap / grade / lens fx -> 8-bit output.
import { VERT, COMP, DOWN, UP, FINAL, STREAK } from './shaders.js';

// author colours in sRGB hex, convert to linear for the shader
export const lin = (hex, k = 1) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2) * k); };

export const DEFAULT_ENV = () => ({
  skyYaw: 0, skyPitch: 0,
  skyTop: lin('#050820'), skyMid: lin('#131b52'), skyHor: lin('#7684cf'), horGlow: lin('#d2aee0', 0.5),
  nebula: 1, stars: 1, galaxy: 1, planet: 1, skyGain: 1,
  cloudOn: 1, cloudY: 45, cloudAmp: 26, cloudScale: 0.022, steps: 128,
  cloudLit: lin('#ece4f7'), cloudShade: lin('#5058aa'), cloudDeep: lin('#1c2160'), cloudRim: lin('#c8bdf5', 0.55),
  moonDir: [-0.6, -0.5, 0.6],
  lightA: [-6, 0, 20, 14], lightAC: [0.0, 0.0, 0.0],
  lightB: [6, 0, 20, 14], lightBC: [0.0, 0.0, 0.0],
  split: [0, 0, 0, 0], splitW: 6, splitGlow: [0.3, 0.7, 1.6],
  fog: 0.0016, cloudDrift: 0,
  backGain: 1, emitGain: 2.2, envGain: 1, sceneGain: 1,
});

export const DEFAULT_POST = () => ({
  exposure: 1, bloomStr: 0.9, thresh: 0.9, diffuse: 0.025, ca: 0.001, vignette: 0.35, grain: 0.035,
  sat: 1.08, contrast: 1.04, knee: 0.72,
  flash: 0, flashCol: [1, 1, 1],
  impact: 0, impactMode: 0, impactA: [0.02, 0.02, 0.03], impactB: [0.97, 0.96, 0.95], impactC: [0.85, 0.05, 0.12],
  shadowTint: [0.0, 0.0, 0.025], hiTint: [0.012, 0.0, 0.01], gainC: [1, 1, 1],
  wave: [0.5, 0.5, 0, 0], radial: [0.5, 0.5, 0], letterbox: 0,
  bloomRadius: 1.0,
  streak: 0.35, streakCol: [0.55, 0.75, 1.0], rays: [0.5, 0.5, 0],
});

export class Compositor {
  constructor(canvas, W, H) {
    this.W = W; this.H = H;
    canvas.width = W; canvas.height = H;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    gl.getExtension('OES_texture_float_linear');
    this.progs = {
      comp: this.program(COMP), down: this.program(DOWN), up: this.program(UP), final: this.program(FINAL), streak: this.program(STREAK),
    };
    this.vao = gl.createVertexArray();
    this.layerTex = {};
    for (const n of ['back', 'scene', 'emit', 'ui']) this.layerTex[n] = this.makeTex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.accum = this.makeTarget(W, H);
    this.mips = [];
    let w = W, h = H;
    for (let i = 0; i < 7; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); this.mips.push(this.makeTarget(w, h)); }
    this.streakA = this.makeTarget(this.mips[1].w, this.mips[1].h);
    this.streakB = this.makeTarget(this.mips[1].w, this.mips[1].h);
    this.out = this.makeTarget(W, H, true);
    this.readBuf = new Uint8Array(W * H * 4);
  }
  program(fsSrc) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  makeTex(w, h, ifmt, fmt, type) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  makeTarget(w, h, ldr = false) {
    const gl = this.gl;
    const tex = ldr ? this.makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE) : this.makeTex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  upload(name, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex[name]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }
  bindTarget(t) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : this.W, t ? t.h : this.H); }
  use(prog) { this.gl.useProgram(prog.p); this.cur = prog; }
  set(name, v) {
    const gl = this.gl, loc = this.cur.u[name];
    if (loc == null) return;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
  }
  tex(name, unit, t) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); const loc = this.cur.u[name]; if (loc != null) gl.uniform1i(loc, unit); }
  draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  beginAccum() {
    const gl = this.gl;
    this.bindTarget(this.accum);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  // one sub-frame: layers must be uploaded already
  composite(cam, env, time, weight) {
    const gl = this.gl;
    this.bindTarget(this.accum);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    this.use(this.progs.comp);
    this.set('uRes', [this.W, this.H]);
    this.set('uTime', time);
    this.set('uCam', [cam.x, cam.y, cam.z]);
    this.set('uFocal', cam.focal);
    this.set('uPP', [cam.cx, cam.cy]);
    this.set('uShake', [cam.shakeX, cam.shakeY, cam.rollTotal]);
    const e = env;
    const map = {
      uSkyYaw: e.skyYaw, uSkyPitch: e.skyPitch, uSkyTop: e.skyTop, uSkyMid: e.skyMid, uSkyHor: e.skyHor, uHorGlow: e.horGlow,
      uNebula: e.nebula, uStars: e.stars, uGalaxy: e.galaxy, uPlanet: e.planet, uSkyGain: e.skyGain,
      uCloudOn: e.cloudOn, uCloudY: e.cloudY, uCloudAmp: e.cloudAmp, uCloudScale: e.cloudScale, uSteps: e.steps,
      uCloudLit: e.cloudLit, uCloudShade: e.cloudShade, uCloudDeep: e.cloudDeep, uCloudRim: e.cloudRim, uMoonDir: e.moonDir,
      uLightA: e.lightA, uLightAC: e.lightAC, uLightB: e.lightB, uLightBC: e.lightBC,
      uSplit: e.split, uSplitW: e.splitW, uSplitGlow: e.splitGlow, uFog: e.fog, uCloudDrift: e.cloudDrift,
      uBackGain: e.backGain, uEmitGain: e.emitGain, uEnvGain: e.envGain, uSceneGain: e.sceneGain, uWeight: weight,
    };
    for (const k in map) this.set(k, map[k]);
    this.tex('uBack', 0, this.layerTex.back);
    this.tex('uScene', 1, this.layerTex.scene);
    this.tex('uEmit', 2, this.layerTex.emit);
    this.draw();
    gl.disable(gl.BLEND);
  }
  bloom(post) {
    const gl = this.gl;
    let src = this.accum;
    this.use(this.progs.down);
    for (let i = 0; i < this.mips.length; i++) {
      const dst = this.mips[i];
      this.bindTarget(dst);
      this.set('uTexel', [1 / src.w, 1 / src.h]);
      this.set('uPrefilter', i === 0 ? 1 : 0);
      this.set('uThresh', post.thresh);
      this.set('uDiffuse', post.diffuse);
      this.tex('uSrc', 0, src.tex);
      this.draw();
      src = dst;
    }
    // anamorphic streak from the quarter-res bright pass (before upsampling touches it)
    if (post.streak > 0) {
      this.use(this.progs.streak);
      const passes = [[this.mips[1], this.streakA, 1.5], [this.streakA, this.streakB, 5], [this.streakB, this.streakA, 14]];
      for (const [s, d, step] of passes) {
        this.bindTarget(d);
        this.set('uTexel', [1 / s.w, 1 / s.h]);
        this.set('uStep', step);
        this.tex('uSrc', 0, s.tex);
        this.draw();
      }
    }
    this.use(this.progs.up);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i], d = this.mips[i - 1];
      this.bindTarget(d);
      this.set('uTexel', [1 / s.w, 1 / s.h]);
      this.set('uRadius', post.bloomRadius);
      this.set('uGain', 1.0);
      this.tex('uSrc', 0, s.tex);
      this.draw();
    }
    gl.disable(gl.BLEND);
  }
  finish(post, frame, toScreen = true) {
    this.bloom(post);
    const gl = this.gl;
    this.use(this.progs.final);
    const p = post;
    const map = {
      uRes: [this.W, this.H], uFrame: frame, uExposure: p.exposure, uBloomStr: p.bloomStr / this.mips.length * 2.0, uCA: p.ca,
      uVignette: p.vignette, uGrain: p.grain, uSat: p.sat, uContrast: p.contrast, uKnee: p.knee,
      uFlash: p.flash, uFlashCol: p.flashCol, uImpact: p.impact, uImpactMode: p.impactMode,
      uImpactA: p.impactA, uImpactB: p.impactB, uImpactC: p.impactC,
      uShadowTint: p.shadowTint, uHiTint: p.hiTint, uGainC: p.gainC, uWave: p.wave, uRadial: p.radial, uLetterbox: p.letterbox,
      uStreak: p.streak, uStreakCol: p.streakCol, uRays: p.rays,
    };
    for (const k in map) this.set(k, map[k]);
    this.tex('uHdr', 0, this.accum.tex);
    this.tex('uBloom', 1, this.mips[0].tex);
    this.tex('uUi', 2, this.layerTex.ui);
    this.tex('uStreakT', 3, this.streakA.tex);
    this.bindTarget(this.out);
    this.draw();
    if (toScreen) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.out.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
  }
  read() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fb);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, this.readBuf);
    return this.readBuf;
  }
}
