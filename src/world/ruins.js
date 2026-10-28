// ISSEN — world: floating ruined architecture (builder A).
//
// Every ruin is a unique hand-"painted" Canvas2D sprite (cel-shaded stone, masonry, flutes,
// arches with see-through openings, chipped edges, cracks, stains, grain) baked once in an
// oblique 3/4 view that matches where it sits relative to the main camera. Each sprite also
// gets a "facing" map (which way each pixel faces + silhouette rims). At draw time a small
// WebGL2 renderer (own offscreen context, shared with stage/debris) lights the sprites with
// the two fighters' energy lights (blue/red fill + hard coloured rims), applies aerial fog that
// matches the sky gradient, height haze where they sink into the cloud sea, and the diagonal
// "cut" of a pillar. Results are blitted into S.L.scene (colour) and S.L.emit (rim glow).
import { RNG, clamp, lerp, smoothstep, TAU, noise2, hash1 } from '../core/math.js';
import { makeCanvas } from '../core/draw.js';

// =====================================================================================
// Shared WebGL2 helper (exported for stage.js / debris.js)
// =====================================================================================
let _G = null;
export function worldGL(W, H) {
  if (!_G) {
    const canvas = makeCanvas(W, H);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('world: WebGL2 unavailable');
    _G = { canvas, gl, W, H, aniso: gl.getExtension('EXT_texture_filter_anisotropic'), progs: {}, vao: gl.createVertexArray(), fbo: {} };
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
  }
  if (_G.W !== W || _G.H !== H) { _G.canvas.width = W; _G.canvas.height = H; _G.W = W; _G.H = H; _G.fbo = {}; }
  return _G;
}
export function glProgram(G, name, vs, fs) {
  if (G.progs[name]) return G.progs[name];
  const gl = G.gl;
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`[${name}] ` + gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[${name}] ` + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  const a = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
  return (G.progs[name] = { p, u, a, name });
}
export function glUse(G, prog) { G.gl.useProgram(prog.p); G.cur = prog; }
export function glSet(G, name, v) {
  const gl = G.gl, loc = G.cur.u[name];
  if (loc == null) return;
  if (typeof v === 'number') gl.uniform1f(loc, v);
  else if (v.length === 2) gl.uniform2fv(loc, v);
  else if (v.length === 3) gl.uniform3fv(loc, v);
  else if (v.length === 4) gl.uniform4fv(loc, v);
  else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
  else gl.uniform2fv(loc, v);
}
export function glSetI(G, name, v) { const loc = G.cur.u[name]; if (loc != null) G.gl.uniform1i(loc, v); }
export function glTex(G, name, unit, tex) {
  const gl = G.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
  const loc = G.cur.u[name]; if (loc != null) gl.uniform1i(loc, unit);
}
export function glTexture(G, src, { mips = true, aniso = 8, wrap = false, premul = true, nearest = false } = {}) {
  const gl = G.gl, t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  const wr = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
  if (mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
  else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  if (G.aniso && aniso > 1) gl.texParameterf(gl.TEXTURE_2D, G.aniso.TEXTURE_MAX_ANISOTROPY_EXT, aniso);
  return t;
}
// (re)upload a canvas into an existing texture (no mips) — used for per-frame scene reflections
export function glUpload(G, tex, src) {
  const gl = G.gl;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
}
export function glBegin(G, { clearColor = true, clearDepth = true } = {}) {
  const gl = G.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, G.W, G.H);
  gl.colorMask(true, true, true, true); gl.depthMask(true);
  gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
  gl.clear((clearColor ? gl.COLOR_BUFFER_BIT : 0) | (clearDepth ? gl.DEPTH_BUFFER_BIT : 0));
  gl.bindVertexArray(G.vao);
}
// Begin a world draw: clears colour, but keeps the shared z-buffer for the whole (sub)frame so that
// ruins, stage floor, rocks, grit and dust occlude each other correctly whatever the call order.
// The depth buffer is cleared on the first world call of every new frame state S.
export function glFrame(G, S) {
  const fresh = G.frameS !== S;
  G.frameS = S;
  glBegin(G, { clearColor: true, clearDepth: fresh });
}
// shared depth mapping (view depth dz -> clip z with w = dz); identical in every world shader
// ONE aerial-fog density shared by ruins, rocks, grit and the floor (curve 1-exp(-(d*k)^1.35))
export const FOG_DENSITY = 0.003;
export const ZN = 0.3, ZF = 3000;
export const GLSL_DEPTH = `
const float ZN = ${ZN.toFixed(2)}, ZF = ${ZF.toFixed(1)};
float clipZ(float dz){ return (dz * (ZF + ZN) - 2.0 * ZF * ZN) / (ZF - ZN); }
float winDepth(float dz){ return clamp(0.5 + 0.5 * clipZ(dz) / max(dz, 1e-3), 0.0, 1.0); }
`;
// blit the GL canvas into a 2D layer (identity transform)
export function glBlit(G, ctx, mode = 'source-over', alpha = 1) {
  G.gl.flush();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = mode; ctx.globalAlpha = alpha; ctx.filter = 'none';
  ctx.drawImage(G.canvas, 0, 0);
  ctx.restore();
}
// camera uniforms shared by all world shaders (same pinhole model as core/camera.js)
export function glCam(G, cam) {
  glSet(G, 'uRes', [G.W, G.H]);
  glSet(G, 'uCam', [cam.x, cam.y, cam.z]);
  glSet(G, 'uFocal', cam.focal);
  glSet(G, 'uPP', [cam.cx, cam.cy]);
  glSet(G, 'uShake', [cam.shakeX, cam.shakeY, cam.rollTotal]);
}
// GLSL snippets shared by the world shaders
export const GLSL_COMMON = `
vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbmN(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
// ONE aerial-perspective curve for ruins, rocks and floor: near/mid stay dark, far goes pale
float fogAmt(float d, float k){ return 1.0 - exp(-pow(max(d * k, 0.0), 1.35)); }
// sky-matched fog colour for a view ray (env colours are linear)
uniform vec3 uSkyHor, uSkyMid, uHorGlow;
vec3 fogSky(vec3 rd){ float el = asin(clamp(-rd.y, -1.0, 1.0)); vec3 c = mix(uSkyHor, uSkyMid, smoothstep(-0.02, 0.3, el));
  return c + uHorGlow * exp(-abs(el) * 9.0) * 0.8; }
`;
// screen px -> world ray (inverse of the camera projection, incl. roll + shake)
export const GLSL_RAY = `
uniform vec2 uRes; uniform vec3 uCam; uniform float uFocal; uniform vec2 uPP; uniform vec3 uShake;
vec3 rayDir(vec2 px){ vec2 q = px - uPP - uShake.xy; float r = -uShake.z; float c = cos(r), s = sin(r);
  vec2 u = vec2(q.x * c - q.y * s, q.x * s + q.y * c); return normalize(vec3(u / uFocal, 1.0)); }
vec2 projectW(vec3 p){ vec3 d = p - uCam; vec2 u = d.xy * uFocal / max(d.z, 0.05); float r = uShake.z; float c = cos(r), s = sin(r);
  return uPP + uShake.xy + vec2(u.x * c - u.y * s, u.x * s + u.y * c); }
`;
export function envSkyUniforms(G, env) {
  glSet(G, 'uSkyHor', env.skyHor.map((v) => v * (env.skyGain ?? 1)));
  glSet(G, 'uSkyMid', env.skyMid.map((v) => v * (env.skyGain ?? 1)));
  glSet(G, 'uHorGlow', env.horGlow.map((v) => v * (env.skyGain ?? 1)));
}

// ---- colour helpers ----
export function toRGB(c) {
  if (typeof c === 'string') { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return c;
}
export const lin3 = (c) => toRGB(c).map((v) => Math.pow(v / 255, 2.2));
// normalise a light option {x,y,z,color,k,range} (or fall back to env.lightA/AC style)
export function resolveLight(l, envPos, envCol) {
  if (l === null) return null;
  if (l) {
    const c = lin3(l.color || [120, 200, 255]);
    const k = l.k ?? 1;
    return { x: l.x ?? 0, y: l.y ?? -1, z: l.z ?? 0, range: l.range ?? 30, col: c.map((v) => v * k) };
  }
  if (!envPos || !envCol) return null;
  const m = Math.max(envCol[0], envCol[1], envCol[2]);
  if (m <= 1e-4) return null;
  const k = Math.min(2.5, m * 2.6);
  return { x: envPos[0], y: envPos[1], z: envPos[2], range: Math.max(10, envPos[3] * 1.4), col: envCol.map((v) => (v / m) * k) };
}

// =====================================================================================
// Painting toolkit (Canvas2D, metres, oblique 3/4 projection)
// =====================================================================================
// Values: near stone sits near-black so the values come from crisp lit edges (moon top/left) and the
// energy rims, as in the references; only the lit planes (left/top) and the moon rims are light.
const PAL = {
  front: [30, 31, 40], frontHi: [42, 44, 56], left: [84, 87, 108], right: [14, 14, 22], top: [104, 107, 130],
  topBroken: [70, 72, 90], bottom: [10, 10, 18], deep: [6, 6, 14], line: [13, 15, 34], moon: [206, 210, 236],
  reveal: [18, 18, 28], soffit: [9, 9, 18], rockLit: [72, 73, 92], rockMid: [34, 34, 44], rockDark: [14, 14, 22],
  root: [10, 9, 16], window: [5, 5, 12],
};
const N_FRONT = 'rgb(0,0,128)', N_LEFT = 'rgb(150,0,128)', N_RIGHT = 'rgb(0,150,128)', N_TOP = 'rgb(0,0,210)', N_BOT = 'rgb(0,0,46)';
const C = (c, k = 1, a = 1) => `rgba(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function pathOf(pts, closed = true) {
  const p = new Path2D();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  if (closed) p.closePath();
  return p;
}
function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a * 0.5; }
// subdivide polygon edges and bite small irregular chips inward
function roughPoly(rng, pts, amp, seg) {
  if (amp <= 0) return pts;
  const out = [], s = Math.sign(signedArea(pts)) || 1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    out.push(a);
    if (L < 1e-6) continue;
    const nx = (-dy / L) * s, ny = (dx / L) * s;
    const m = Math.max(1, Math.round(L / seg));
    for (let k = 1; k < m; k++) {
      const t = (k + (rng.next() - 0.5) * 0.6) / m;
      let d = amp * Math.pow(rng.next(), 2.2);
      if (rng.next() < 0.1) {
        // a chip: notch with a sharp V
        const w = (L / m) * 0.35;
        const tx = dx / L, ty = dy / L;
        const cx = a.x + dx * t, cy = a.y + dy * t;
        out.push({ x: cx - tx * w, y: cy - ty * w });
        out.push({ x: cx + nx * amp * (2 + rng.next() * 2), y: cy + ny * amp * (2 + rng.next() * 2) });
        out.push({ x: cx + tx * w * 0.6, y: cy + ty * w * 0.6 });
        continue;
      }
      out.push({ x: a.x + dx * t + nx * d, y: a.y + dy * t + ny * d });
    }
  }
  return out;
}
// broken top edge: from (x0) to (x1) at yTop, jagged snapped-stone profile (y down)
function brokenLine(rng, x0, x1, yTop, amp, dir = 1) {
  const pts = [];
  const w = x1 - x0;
  const n = Math.max(3, Math.round(w / Math.max(0.25, amp * 0.55)) + 2);
  // overall slant + a couple of deep bites and one tall shard
  const slant = (rng.next() - 0.5) * amp * 1.6;
  const shard = rng.next();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let y = yTop + slant * (t - 0.5) + amp * (rng.next() * 0.7);
    if (Math.abs(t - shard) < 0.12) y -= amp * (0.5 + rng.next() * 0.6) * (1 - Math.abs(t - shard) / 0.12);
    if (rng.next() < 0.18) y += amp * (0.6 + rng.next());
    const xj = (i > 0 && i < n) ? (rng.next() - 0.5) * (w / n) * 0.7 : 0;
    pts.push({ x: x0 + w * t + xj, y: dir > 0 ? y : 2 * yTop - y });
  }
  return pts;
}

// staircase fracture of a masonry wall end: points top->bottom; dir=+1 for a left end (bites go +x)
function steppedEdge(rng, yTop, yBot, xBase, dir, courseH, maxIn) {
  const pts = [];
  let y = yTop;
  let x = xBase + dir * maxIn * (0.6 + 0.4 * rng.next());
  pts.push({ x, y });
  while (y < yBot - 1e-3) {
    const yn = Math.min(yBot, y + courseH * rng.int(1, 3));
    const jit = (rng.next() - 0.5) * courseH * 0.25;
    pts.push({ x: x + dir * jit, y: yn });
    const remain = 1 - (yn - yTop) / (yBot - yTop);
    const nx = xBase + dir * maxIn * Math.max(0, remain * (0.25 + 0.75 * rng.next()));
    if (yn < yBot) pts.push({ x: nx, y: yn + (rng.next() - 0.5) * courseH * 0.15 });
    x = nx; y = yn;
  }
  return pts;
}
// ruined wall top: blocky steps of course height with a few V notches (left->right)
function steppedTop(rng, x0, x1, yTop, amp, courseH) {
  const pts = [];
  let x = x0, lvl = rng.int(0, Math.max(1, Math.round(amp / courseH)));
  pts.push({ x, y: yTop + lvl * courseH });
  while (x < x1 - 1e-3) {
    const w = Math.min(x1 - x, courseH * rng.range(0.8, 3.2));
    const y = yTop + lvl * courseH + (rng.next() - 0.5) * courseH * 0.2;
    if (rng.next() < 0.2) { pts.push({ x: x + w * 0.4, y: y + courseH * rng.range(0.4, 1.0) }); }
    pts.push({ x: x + w, y });
    x += w;
    const nl = clamp(lvl + rng.int(-2, 2), 0, Math.max(1, Math.round(amp / courseH)));
    if (x < x1) pts.push({ x, y: yTop + nl * courseH });
    lvl = nl;
  }
  return pts;
}

class Painter {
  constructor(bb, ppm, kx, ky, pad = 6) {
    this.ppm = ppm; this.kx = kx; this.ky = ky; this.px = 1 / ppm; this.pad = pad;
    this.bb = bb;
    this.W = Math.max(4, Math.ceil((bb.x1 - bb.x0) * ppm + pad * 2));
    this.H = Math.max(4, Math.ceil((bb.y1 - bb.y0) * ppm + pad * 2));
    this.ox = pad - bb.x0 * ppm; this.oy = pad - bb.y0 * ppm; // canvas px of local (0,0)
    this.cc = makeCanvas(this.W, this.H); this.c = this.cc.getContext('2d', { willReadFrequently: true });
    this.nc = makeCanvas(this.W, this.H); this.n = this.nc.getContext('2d', { willReadFrequently: true });
    this.T = [ppm, 0, 0, ppm, this.ox, this.oy];
    this.reset();
    this.stack = [];
  }
  reset() { this.c.setTransform(...this.T); this.n.setTransform(...this.T); }
  P(x, y, z = 0) { return { x: x + this.kx * z, y: y + this.ky * z }; }
  face(path, fill, code) {
    if (fill) { this.c.fillStyle = fill; this.c.fill(path); }
    if (code) { this.n.fillStyle = code; this.n.fill(path); }
  }
  // paint into a temporary layer (so destination-out cuts only affect this element)
  begin() {
    const lc = makeCanvas(this.W, this.H), ln = makeCanvas(this.W, this.H);
    this.stack.push([this.c, this.n]);
    this.c = lc.getContext('2d'); this.n = ln.getContext('2d');
    this.reset();
  }
  end() {
    const [c, n] = this.stack.pop();
    for (const [dst, src] of [[c, this.c], [n, this.n]]) { dst.save(); dst.setTransform(1, 0, 0, 1, 0, 0); dst.drawImage(src.canvas, 0, 0); dst.restore(); }
    this.c = c; this.n = n;
  }
  lw(px) { return px / this.ppm; }
}

// ---- detail brushes ----
function masonry(p, rng, x0, x1, y0, y1, o = {}) {
  const { courseH = 1.0, blockW = 1.6, tone = PAL.front, v = 0.12, joint = 1, stagger = 0.5 } = o;
  const c = p.c;
  const showJ = courseH * p.ppm > 5;
  let y = y1, row = 0;
  const joints = [];
  while (y > y0 - 1e-3) {
    const h = courseH * (0.82 + 0.36 * rng.next());
    const yt = y - h;
    let x = x0 - blockW * (row % 2 ? stagger : 0) - rng.next() * blockW * 0.4;
    while (x < x1) {
      const w = blockW * (0.55 + 0.9 * rng.next());
      const k = 1 + (rng.next() - 0.5) * 2 * v * 1.6 + (rng.next() < 0.1 ? -0.22 : rng.next() < 0.06 ? 0.25 : 0);
      c.fillStyle = C(tone, k);
      c.fillRect(x, yt, w + p.px, h + p.px);
      if (showJ) {
        // inner darkening along the block's lower and right edges (worn, undercut stones)
        const e = p.px * (1 + rng.next());
        c.fillStyle = 'rgba(0,0,6,0.22)';
        c.fillRect(x + w - e, yt, e, h); c.fillRect(x, y - e, w, e);
        // tiny lit chip on the block's upper-left corner
        if (rng.next() < 0.26) {
          const s = Math.min(w, h) * (0.12 + rng.next() * 0.2);
          c.fillStyle = C(PAL.left, 1.0, 0.75);
          c.beginPath(); c.moveTo(x, yt); c.lineTo(x + s * (1 + rng.next()), yt); c.lineTo(x, yt + s); c.closePath(); c.fill();
        }
        // spalled face: a darker chipped-out patch with a lit upper lip
        if (rng.next() < 0.12 && w * p.ppm > 10) {
          const cx = x + w * rng.range(0.2, 0.8), cy = yt + h * rng.range(0.3, 0.8), r = Math.min(w, h) * rng.range(0.15, 0.32);
          c.fillStyle = C(PAL.deep, 1, 0.55);
          c.beginPath(); for (let q = 0; q < 6; q++) { const a = (q / 6) * TAU, rr = r * rng.range(0.6, 1.1); c[q ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr); } c.closePath(); c.fill();
          c.fillStyle = C(PAL.left, 0.9, 0.5); c.fillRect(cx - r * 1.1, cy - r * 0.95, r * 1.6, Math.max(p.px, r * 0.12));
        }
      }
      joints.push([x + w, yt, x + w, y]);
      x += w;
    }
    joints.push([x0, yt, x1, yt, 1]);
    row++; y = yt;
  }
  if (!showJ) return;
  const lw = Math.max(p.px * 1.1, 0.03) * joint * 1.5;
  c.lineCap = 'butt';
  c.strokeStyle = C(PAL.deep, 1, 1.0); c.lineWidth = lw;
  c.beginPath(); for (const j of joints) { c.moveTo(j[0], j[1]); c.lineTo(j[2], j[3]); } c.stroke();
  // bevel highlight just below/right of joints (moon from upper-left)
  c.strokeStyle = C(PAL.top, 1, 0.3); c.lineWidth = lw * 0.5;
  c.beginPath(); for (const j of joints) { if (j[4]) { c.moveTo(j[0], j[1] + lw * 1.2); c.lineTo(j[2], j[3] + lw * 1.2); } else { c.moveTo(j[0] + lw * 1.2, j[1]); c.lineTo(j[2] + lw * 1.2, j[3]); } } c.stroke();
}
function crack(p, rng, x, y, ang, len, w, depth = 0) {
  const c = p.c;
  const pts = [{ x, y }];
  let a = ang, L = 0;
  while (L < len) {
    const st = len * (0.07 + 0.11 * rng.next());
    a += (rng.next() - 0.5) * 1.1;
    x += Math.cos(a) * st; y += Math.sin(a) * st; L += st;
    pts.push({ x, y });
    if (depth < 2 && rng.next() < 0.16) crack(p, rng, x, y, a + rng.sign() * (0.5 + rng.next() * 0.7), (len - L) * 0.6, w * 0.6, depth + 1);
  }
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const t = i / pts.length;
    const lw = Math.max(p.px * 0.8, w * (1 - t * 0.85));
    c.strokeStyle = C(PAL.top, 1, 0.28); c.lineWidth = lw * 0.9;
    c.beginPath(); c.moveTo(pts[i - 1].x + lw * 0.8, pts[i - 1].y + lw * 0.9); c.lineTo(pts[i].x + lw * 0.8, pts[i].y + lw * 0.9); c.stroke();
    c.strokeStyle = C(PAL.deep, 1, 0.92); c.lineWidth = lw;
    c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y); c.stroke();
  }
}
function stains(p, rng, x0, x1, y0, y1, n, k = 0.22) {
  const c = p.c;
  for (let i = 0; i < n; i++) {
    const x = lerp(x0, x1, rng.next()), w = (x1 - x0) * (0.03 + rng.next() * 0.1);
    const ys = lerp(y0, y1, rng.next() * 0.6), ye = ys + (y1 - y0) * (0.15 + rng.next() * 0.5);
    const g = c.createLinearGradient(0, ys, 0, ye);
    g.addColorStop(0, C(PAL.deep, 1, k * (0.5 + rng.next()))); g.addColorStop(1, C(PAL.deep, 1, 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(x, ys); c.lineTo(x + w, ys); c.lineTo(x + w * (0.6 + rng.next() * 0.3), ye); c.lineTo(x + w * 0.2, ye); c.closePath(); c.fill();
  }
}
function shadeFace(p, x0, x1, y0, y1, top = 0.1, bot = 0.42, side = 0.0) {
  const c = p.c;
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(190,196,240,${top * 1.7})`); g.addColorStop(0.45, 'rgba(20,22,44,0)'); g.addColorStop(1, C(PAL.deep, 1, bot));
  c.fillStyle = g; c.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  if (side) {
    const h = c.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, `rgba(180,186,230,${side})`); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, C(PAL.deep, 1, side * 1.4));
    c.fillStyle = h; c.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  }
}

// ---- primitive: block (box) with optional jagged top / bottom ----
function paintBlock(p, rng, b) {
  const { x0, x1, d = 2 } = b;
  const yTop = b.yTop, yBot = b.yBot;
  const kx = p.kx, ky = p.ky;
  const tone = b.tone || PAL.front;
  const top = b.topLine || [{ x: x0, y: yTop }, { x: x1, y: yTop }];
  const bot = b.botLine || [{ x: x1, y: yBot }, { x: x0, y: yBot }];
  const amp = b.rough ?? Math.min(0.12, (x1 - x0) * 0.03);
  const c = p.c;
  // --- side face ---
  if (Math.abs(kx) > 0.012 && !b.noSide) {
    const right = kx > 0, ex = right ? x1 : x0;
    const tY = right ? top[top.length - 1].y : top[0].y;
    const bY = right ? bot[0].y : bot[bot.length - 1].y;
    const inset = right ? -amp * 2 : amp * 2;
    const pts = [p.P(ex + inset, tY, 0)];
    if (b.topLine) { for (let i = 1; i < 4; i++) pts.push(p.P(ex, tY + (rng.next() - 0.3) * (b.amp || 0.5), d * i / 4)); }
    pts.push(p.P(ex, tY + (b.topLine ? (rng.next() - 0.3) * (b.amp || 0.5) : 0), d));
    if (b.botLine) { for (let i = 3; i > 0; i--) pts.push(p.P(ex, bY - (rng.next() - 0.3) * (b.amp || 0.5), d * i / 4)); }
    pts.push(p.P(ex, bY, d));
    pts.push(p.P(ex + inset, bY, 0));
    const sp = pathOf(roughPoly(rng, pts, amp * 0.7, 0.6));
    const st = right ? PAL.right : PAL.left;
    p.face(sp, C(mixc(st, tone, 0.15)), right ? N_RIGHT : N_LEFT);
    c.save(); c.clip(sp);
    // course lines continue on the side, slanted by ky
    if (b.courseH && b.courseH * p.ppm > 5) {
      c.strokeStyle = C(PAL.deep, 1, 0.55); c.lineWidth = Math.max(p.px, 0.03);
      c.beginPath();
      for (let y = bY; y > tY; y -= b.courseH) { const a = p.P(ex, y, 0), q = p.P(ex, y, d); c.moveTo(a.x, a.y); c.lineTo(q.x, q.y); }
      c.stroke();
    }
    const g = c.createLinearGradient(0, tY, 0, bY);
    g.addColorStop(0, right ? 'rgba(150,150,210,0.10)' : 'rgba(220,220,255,0.16)'); g.addColorStop(1, C(PAL.deep, 1, 0.35));
    c.fillStyle = g; c.fill(sp);
    c.restore();
  }
  // --- top / bottom faces ---
  if (ky < -0.012 && !b.noTop) {
    let tp;
    if (b.topLine) {
      const back = top.map((q, i) => ({ x: q.x + (rng.next() - 0.5) * 0.3, y: q.y + (rng.next() - 0.4) * (b.amp || 0.5) }));
      tp = [...top.map((q) => ({ x: q.x, y: q.y + amp * 2 })), ...back.reverse().map((q) => p.P(q.x, q.y, d))];
    } else {
      tp = [p.P(x0, yTop + amp * 2, 0), p.P(x1, yTop + amp * 2, 0), p.P(x1, yTop, d), p.P(x0, yTop, d)];
    }
    const path = pathOf(roughPoly(rng, tp, amp * 0.6, 0.5));
    p.face(path, C(b.topLine ? PAL.topBroken : PAL.top), N_TOP);
    if (b.topLine && p.ppm > 6) { c.save(); c.clip(path); for (let i = 0; i < 6; i++) { c.fillStyle = C(PAL.deep, 1, 0.35); const q = p.P(lerp(x0, x1, rng.next()), yTop, d * rng.next()); c.fillRect(q.x, q.y, 0.15 + rng.next() * 0.3, 0.06); } c.restore(); }
  } else if (ky > 0.012 && b.showBottom) {
    let bp;
    if (b.botLine) {
      const back = bot.map((q) => ({ x: q.x + (rng.next() - 0.5) * 0.3, y: q.y - (rng.next() - 0.4) * (b.amp || 0.5) }));
      bp = [...bot.map((q) => ({ x: q.x, y: q.y - amp * 2 })), ...back.reverse().map((q) => p.P(q.x, q.y, d))];
    } else bp = [p.P(x0, yBot - amp * 2, 0), p.P(x1, yBot - amp * 2, 0), p.P(x1, yBot, d), p.P(x0, yBot, d)];
    const path = pathOf(roughPoly(rng, bp, amp * 0.6, 0.5));
    p.face(path, C(b.botLine ? mixc(PAL.topBroken, PAL.bottom, 0.55) : PAL.bottom), N_BOT);
  }
  // --- front face ---
  const outline = roughPoly(rng, [...top, ...bot], amp, Math.max(0.35, (x1 - x0) / 7));
  const fp = pathOf(outline);
  p.face(fp, C(tone), N_FRONT);
  c.save(); c.clip(fp);
  const yT = Math.min(...top.map((q) => q.y)), yB = Math.max(...bot.map((q) => q.y));
  if (b.courseH) masonry(p, rng, x0, x1, yT - 1, yB, { courseH: b.courseH, blockW: b.blockW || (x1 - x0) * 0.5, tone, v: b.v ?? 0.075 });
  shadeFace(p, x0, x1, yT, yB, b.shadeTop ?? 0.11, b.shadeBot ?? 0.42, b.shadeSide ?? 0.06);
  if (b.stains) stains(p, rng, x0, x1, yT, yB, b.stains);
  if (b.cracks) for (let i = 0; i < b.cracks; i++) crack(p, rng, lerp(x0, x1, rng.next()), lerp(yT, yB, rng.next() * 0.8), Math.PI * 0.5 + (rng.next() - 0.5) * 1.6, (yB - yT) * (0.1 + rng.next() * 0.25), Math.max(p.px * 1.5, 0.05));
  // moonlit top edge band (flat tops) and dark contact line at the bottom
  if (!b.topLine && !b.noTopEdge) { c.fillStyle = C(PAL.moon, 1, 0.5); c.fillRect(x0, yTop, x1 - x0, Math.max(p.px * 1.1, 0.02)); }
  if (b.ledgeShadow) { const g = c.createLinearGradient(0, yTop, 0, yTop + b.ledgeShadow); g.addColorStop(0, C(PAL.deep, 1, 0.6)); g.addColorStop(1, C(PAL.deep, 1, 0)); c.fillStyle = g; c.fillRect(x0, yTop, x1 - x0, b.ledgeShadow); }
  c.restore();
  return fp;
}

// ---- primitive: fluted column (vertical cylinder) ----
function ellArc(p, cx, y, r, th0, th1, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = lerp(th0, th1, i / n);
    pts.push({ x: cx + r * Math.cos(th) + p.kx * (r + r * Math.sin(th)), y: y + p.ky * (r + r * Math.sin(th)) });
  }
  return pts;
}
function cylBand(p, rng, cx, yTop, yBot, r, o = {}) {
  // front silhouette of a cylinder segment + cel shading + optional flutes / drums
  const kx = p.kx, c = p.c;
  const thL = Math.atan(kx) + Math.PI, thR = thL + Math.PI;
  const topArc = o.topLine || ellArc(p, cx, yTop, r, thL, thR);
  const botArc = ellArc(p, cx, yBot, r, thR, thL);
  const pts = [...topArc, ...botArc];
  const path = pathOf(o.rough ? roughPoly(rng, pts, o.rough, 0.5) : pts);
  const R = r * Math.sqrt(1 + kx * kx), xc = cx + kx * r;
  const tone = o.tone || PAL.front;
  // cel-banded horizontal shading: thin moon rim on the left limb, mid, hard shadow terminator
  const g = c.createLinearGradient(xc - R, 0, xc + R, 0);
  const lit = mixc(tone, PAL.left, 0.75), mid = tone, sh = mixc(tone, PAL.right, 0.8);
  g.addColorStop(0, C(lit, 1.12)); g.addColorStop(0.1, C(lit)); g.addColorStop(0.11, C(mixc(lit, mid, 0.5)));
  g.addColorStop(0.3, C(mid, 1.04)); g.addColorStop(0.56, C(mid, 0.96)); g.addColorStop(0.57, C(sh));
  g.addColorStop(0.9, C(sh, 0.92)); g.addColorStop(1, C(sh, 1.12));
  c.fillStyle = g; c.fill(path);
  // facing code: left half faces left, right half faces right (soft ramp)
  const gn = p.n.createLinearGradient(xc - R, 0, xc + R, 0);
  gn.addColorStop(0, 'rgb(170,0,128)'); gn.addColorStop(0.35, 'rgb(0,0,128)'); gn.addColorStop(0.65, 'rgb(0,0,128)'); gn.addColorStop(1, 'rgb(0,170,128)');
  p.n.fillStyle = gn; p.n.fill(path);
  c.save(); c.clip(path);
  if (o.flutes && R * p.ppm > 6) {
    const nf = o.flutes;
    for (let i = 0; i < nf; i++) {
      const th = thL + (i + 0.5) / nf * Math.PI;
      const x = cx + r * Math.cos(th) + kx * (r + r * Math.sin(th));
      const dxd = Math.abs(-r * Math.sin(th) + kx * r * Math.cos(th)) * (Math.PI / nf);
      const wgr = dxd * 0.42;
      if (wgr * p.ppm < 0.6) continue;
      const fx = (x - (xc - R)) / (2 * R);
      const shadowSide = fx > 0.56;
      c.fillStyle = C(PAL.deep, 1, shadowSide ? 0.32 : 0.5);
      c.fillRect(x - wgr * 0.5, yTop - 2, wgr * 0.45, yBot - yTop + 4);
      if (!shadowSide) { c.fillStyle = C(PAL.top, 1, 0.28 * (1 - fx)); c.fillRect(x + wgr * 0.05, yTop - 2, wgr * 0.35, yBot - yTop + 4); }
    }
  }
  if (o.drums && o.drums * p.ppm > 4) {
    c.lineWidth = Math.max(p.px * 1.2, 0.035);
    for (let y = yBot - o.drums * (0.8 + rng.next() * 0.4); y > yTop + 0.3; y -= o.drums * (0.8 + rng.next() * 0.5)) {
      const arc = ellArc(p, cx, y, r, thL, thR, 16);
      c.strokeStyle = C(PAL.deep, 1, 0.7); c.stroke(pathOf(arc, false));
      c.strokeStyle = C(PAL.top, 1, 0.18); c.save(); c.translate(0, c.lineWidth * 1.3); c.stroke(pathOf(arc, false)); c.restore();
    }
  }
  if (o.cracks) for (let i = 0; i < o.cracks; i++) crack(p, rng, xc + (rng.next() - 0.5) * R * 1.6, lerp(yTop, yBot, rng.next()), Math.PI / 2 + (rng.next() - 0.5) * 1.4, (yBot - yTop) * (0.08 + rng.next() * 0.18), Math.max(p.px * 1.4, 0.05));
  if (o.stains) stains(p, rng, xc - R, xc + R, yTop, yBot, o.stains, 0.18);
  const sg = c.createLinearGradient(0, yTop, 0, yBot);
  sg.addColorStop(0, 'rgba(200,205,250,0.06)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, C(PAL.deep, 1, o.shadeBot ?? 0.3));
  c.fillStyle = sg; c.fillRect(xc - R - 1, yTop - 2, 2 * R + 2, yBot - yTop + 4);
  c.restore();
  return { path, xc, R };
}
function capEllipse(p, cx, y, r, tone) {
  // visible top cap (only when looking down)
  if (p.ky >= -0.01) return;
  const pts = ellArc(p, cx, y, r, 0, TAU, 32);
  p.face(pathOf(pts), C(tone || PAL.top), N_TOP);
}

// =====================================================================================
// Structure generators. Each returns { bb:{x0,x1,y0,y1}, paint(p, ox, oy) } in local metres:
// x right, y down, base at y = 0 (structures grow to negative y), z = depth into the screen.
// =====================================================================================
const M = 1.6; // generous bounds margin factor for oblique faces

function genPier(rng, o) {
  const w = o.w ?? rng.range(2.4, 4.5), d = o.d ?? w * rng.range(0.85, 1.1), h = o.h ?? rng.range(10, 30);
  const base = o.base ?? !o.floating, cap = o.capital ?? (rng.next() < 0.5);
  const brokenTop = o.brokenTop ?? (!cap || rng.next() < 0.4);
  const floating = !!o.floating;
  const ext = w * 0.35 + d * 0.7;
  return {
    bb: { x0: -w / 2 - ext - 1, x1: w / 2 + ext + 1, y0: -h - d * 0.7 - 2.5, y1: (floating ? 2.5 : 0.5) + d * 0.7 },
    paint(p, ox = 0, oy = 0) {
      const x0 = ox - w / 2, x1 = ox + w / 2;
      let yb = oy, yt = oy - h;
      const amp = Math.min(1.6, w * 0.32);
      const courseH = rng.range(0.8, 1.3);
      if (base) {
        const bh = Math.min(1.6, h * 0.08);
        paintBlock(p, rng, { x0: x0 - w * 0.18, x1: x1 + w * 0.18, yTop: yb - bh, yBot: yb, d: d * 1.3, tone: PAL.frontHi, cracks: 1, shadeBot: 0.2 });
        paintBlock(p, rng, { x0: x0 - w * 0.09, x1: x1 + w * 0.09, yTop: yb - bh * 1.6, yBot: yb - bh + 0.01, d: d * 1.15, tone: PAL.front, noSide: false });
        yb -= bh * 1.6;
      }
      let capH = 0;
      if (cap && !brokenTop) capH = Math.min(2.2, h * 0.1);
      const topLine = brokenTop ? brokenLine(rng, x0, x1, yt + capH + amp * 0.6, amp) : null;
      const botLine = floating ? brokenLine(rng, x0, x1, yb - amp * 0.5, amp, -1).reverse() : null;
      paintBlock(p, rng, {
        x0, x1, yTop: yt + capH, yBot: yb, d, topLine, botLine, amp, courseH, blockW: w * rng.range(0.4, 0.75), stains: Math.round(h / 4), cracks: 1 + Math.round(h / 12),
        showBottom: floating, shadeSide: 0.06,
      });
      if (cap && !brokenTop) {
        const ct = yt, cb = yt + capH;
        paintBlock(p, rng, { x0: x0 - w * 0.06, x1: x1 + w * 0.06, yTop: cb - capH * 0.45, yBot: cb, d: d * 1.1, tone: PAL.front, ledgeShadow: 0 });
        paintBlock(p, rng, { x0: x0 - w * 0.2, x1: x1 + w * 0.2, yTop: ct, yBot: cb - capH * 0.45, d: d * 1.35, tone: PAL.frontHi, cracks: 1 });
        // dark shadow cast by the capital on the shaft
        const c = p.c, g = c.createLinearGradient(0, cb, 0, cb + capH * 0.9);
        g.addColorStop(0, C(PAL.deep, 1, 0.55)); g.addColorStop(1, C(PAL.deep, 1, 0));
        c.fillStyle = g; c.fillRect(x0, cb, w, capH * 0.9);
      }
      // a big missing bite out of one edge
      if (h > 12 && rng.next() < 0.6) bite(p, rng, rng.next() < 0.5 ? x0 : x1, lerp(yt + h * 0.2, yb - h * 0.15, rng.next()), w * rng.range(0.25, 0.45), h * rng.range(0.05, 0.12));
    },
  };
}
// knock a chunk out of a silhouette edge (cuts both canvases) and paint the fracture rim
function bite(p, rng, ex, ey, depth, len) {
  const side = ex < 0 ? 1 : (ex > 0 ? -1 : 1);
  const pts = [{ x: ex - side * 0.5, y: ey - len * 0.5 }];
  const n = 5;
  for (let i = 1; i < n; i++) pts.push({ x: ex + side * depth * (0.4 + rng.next() * 0.6) * Math.sin(Math.PI * i / n), y: ey - len * 0.5 + len * i / n + (rng.next() - 0.5) * len * 0.2 });
  pts.push({ x: ex - side * 0.5, y: ey + len * 0.5 });
  const path = pathOf(pts);
  for (const ctx of [p.c, p.n]) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(path); ctx.restore(); }
  // fracture rim (lighter where it faces up-left)
  const c = p.c;
  c.save(); c.globalCompositeOperation = 'source-atop';
  c.strokeStyle = C(PAL.topBroken, 1, 0.7); c.lineWidth = Math.max(p.px * 2, 0.08);
  c.stroke(path);
  c.restore();
}

function genColumn(rng, o) {
  const r = o.r ?? rng.range(0.7, 1.4), h = o.h ?? rng.range(8, 22);
  const base = o.base ?? !o.floating, cap = o.capital ?? (rng.next() < 0.45);
  const brokenTop = o.brokenTop ?? (!cap || rng.next() < 0.3);
  const floating = !!o.floating;
  const ext = r * 2.2;
  return {
    bb: { x0: -ext - 1, x1: ext + 1 + r * 1.2, y0: -h - r * 1.5 - 2, y1: (floating ? 2 : 0.5) + r * 1.5 },
    paint(p, ox = 0, oy = 0) {
      let yb = oy; const yt = oy - h;
      if (base) {
        // plinth + torus
        const ph = r * 0.55;
        paintBlock(p, rng, { x0: ox - r * 1.45, x1: ox + r * 1.45, yTop: yb - ph, yBot: yb, d: r * 2.9, tone: PAL.frontHi, cracks: 1 });
        p.kx = p.kx; // (keeps oblique)
        cylBand(p, rng, ox, yb - ph - r * 0.42, yb - ph, r * 1.2, { tone: PAL.frontHi });
        cylBand(p, rng, ox, yb - ph - r * 0.62, yb - ph - r * 0.4, r * 1.08, { tone: PAL.front });
        yb -= ph + r * 0.62;
      }
      let capH = cap && !brokenTop ? r * 1.25 : 0;
      const amp = r * 0.9;
      const thL = Math.atan(p.kx) + Math.PI;
      let topLine = null;
      if (brokenTop) {
        const arc = ellArc(p, ox, yt, r, thL, thL + Math.PI, 12); // just for limbs
        const xl = arc[0].x, xr = arc[arc.length - 1].x;
        topLine = brokenLine(rng, xl, xr, yt + amp * 0.6, amp);
        topLine[0].y = Math.max(topLine[0].y, yt + amp * 0.2); topLine[topLine.length - 1].y = Math.max(topLine[topLine.length - 1].y, yt + amp * 0.2);
      }
      const shaftTop = yt + capH;
      // shaft (cx is the cylinder's x at its front; band function handles oblique)
      const sb = cylBand(p, rng, ox, shaftTop, yb, r, { flutes: o.flutes ?? 18, drums: rng.range(1.0, 1.8), cracks: 1 + Math.round(h / 10), stains: Math.round(h / 5), topLine: topLine ? topLine : null, rough: Math.min(0.08, r * 0.05) });
      if (brokenTop && p.ky < -0.01) {
        // visible fracture surface on top
        const back = topLine.map((q) => ({ x: q.x + p.kx * r * 2, y: q.y + p.ky * r * 2 + (rng.next() - 0.5) * amp * 0.5 }));
        const fp = pathOf([...topLine, ...back.reverse()]);
        p.c.save(); p.c.globalCompositeOperation = 'destination-over'; p.face(fp, C(PAL.topBroken), null); p.c.restore();
        p.n.save(); p.n.globalCompositeOperation = 'destination-over'; p.n.fillStyle = N_TOP; p.n.fill(fp); p.n.restore();
      }
      if (cap && !brokenTop) {
        // echinus (flared) + abacus slab
        const ey0 = shaftTop, ey1 = shaftTop - capH * 0.55;
        cylBand(p, rng, ox, ey1 + capH * 0.12, ey0 + 0.02, r * 1.12, { tone: PAL.front });
        cylBand(p, rng, ox, ey1, ey1 + capH * 0.2, r * 1.3, { tone: PAL.frontHi });
        paintBlock(p, rng, { x0: ox - r * 1.55, x1: ox + r * 1.55, yTop: yt, yBot: ey1, d: r * 3.1, tone: PAL.frontHi, cracks: 1 });
        const c = p.c, g = c.createLinearGradient(0, ey0, 0, ey0 + r * 1.4);
        g.addColorStop(0, C(PAL.deep, 1, 0.5)); g.addColorStop(1, C(PAL.deep, 1, 0));
        c.save(); c.clip(sb.path); c.fillStyle = g; c.fillRect(ox - r * 2, ey0, r * 4, r * 1.4); c.restore();
      }
      if (floating) {
        // jagged bottom: cut with a broken line
        const bl = brokenLine(rng, ox - r * 2.5, ox + r * 2.5, yb - amp * 0.4, amp * 0.8, -1);
        const cut = pathOf([...bl, { x: ox + r * 3, y: yb + 3 }, { x: ox - r * 3, y: yb + 3 }]);
        for (const ctx of [p.c, p.n]) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(cut); ctx.restore(); }
      }
      if (h > 9 && rng.next() < 0.5) bite(p, rng, rng.next() < 0.5 ? ox - r * 1.05 : ox + r * 1.05, lerp(yt + h * 0.3, yb - h * 0.1, rng.next()), r * 0.5, h * 0.07);
    },
  };
}

// arch opening path (round or pointed), from ground yG up to spring yS
function archPts(cx, a, yS, yG, pointed, n = 18) {
  const pts = [{ x: cx - a, y: yG }, { x: cx - a, y: yS }];
  if (pointed) {
    const e = 0.62; // centres inside the span
    const R = a * (1 + e);
    const thTop = Math.acos(e / (1 + e));
    for (let i = 1; i <= n; i++) { const t = (i / n) * thTop; pts.push({ x: cx + a * e - R * Math.cos(t), y: yS - R * Math.sin(t) }); }
    for (let i = n - 1; i >= 0; i--) { const t = (i / n) * thTop; pts.push({ x: cx - a * e + R * Math.cos(t), y: yS - R * Math.sin(t) }); }
  } else {
    for (let i = 1; i < n * 2; i++) { const t = Math.PI - (i / (n * 2)) * Math.PI; pts.push({ x: cx + a * Math.cos(t), y: yS - a * Math.sin(t) }); }
  }
  pts.push({ x: cx + a, y: yS }, { x: cx + a, y: yG });
  return pts;
}
function archCrown(a, pointed) { return pointed ? a * (1 + 0.62) * Math.sin(Math.acos(0.62 / 1.62)) : a; }

// one arcade tier: a wall with n arched openings. Returns the outline used.
function paintTier(p, rng, t) {
  const { x0, x1, yb, yt, n, d, pointed, brokenL, brokenR, brokenTop, cornice = true } = t;
  const c = p.c;
  const W = x1 - x0;
  const pier = t.pier ?? W / n * 0.28;
  const span = (W - pier * (n + 1)) / n;
  const a = span / 2;
  const springY = t.springY ?? (yb - (yb - yt) * 0.58);
  const amp = Math.min(1.5, (yb - yt) * 0.12);
  // outline: possibly jagged ends / top
  const cH = t.courseH ?? rng.range(0.7, 1.1);
  t.courseH = cH;
  const left = brokenL ? steppedEdge(rng, yt, yb, x0, 1, cH, brokenL * 1.6) : [{ x: x0, y: yt }, { x: x0, y: yb }];
  const right = brokenR ? steppedEdge(rng, yt, yb, x1, -1, cH, brokenR * 1.6) : [{ x: x1, y: yt }, { x: x1, y: yb }];
  const topL = brokenTop ? steppedTop(rng, left[0].x, right[0].x, yt + cH * 0.5, Math.max(amp * 1.5, cH * 3), cH) : [{ x: left[0].x, y: yt }, { x: right[0].x, y: yt }];
  const outline = [...topL, ...right.slice(1), { x: right[right.length - 1].x, y: yb }, { x: left[left.length - 1].x, y: yb }, ...left.slice(1, -1).reverse()];
  const op = pathOf(roughPoly(rng, outline, Math.min(0.1, amp * 0.1), 0.6));
  // side face at a clean end + top strip
  const kx = p.kx, ky = p.ky;
  const endFace = (edge, isRight, broken) => {
    // edge: front points top->bottom; fracture/side face = edge + edge pushed back by depth
    const back = edge.map((q) => p.P(q.x + (broken ? (rng.next() - 0.5) * amp * 0.8 : 0), q.y, d)).reverse();
    const sp = pathOf([...edge.map((q) => ({ x: q.x + (isRight ? -0.15 : 0.15), y: q.y })), ...back]);
    const tone = broken ? mixc(PAL.topBroken, isRight ? PAL.right : PAL.left, 0.55) : (isRight ? PAL.right : PAL.left);
    p.face(sp, C(tone), isRight ? N_RIGHT : N_LEFT);
    if (broken && p.ppm > 4) { c.save(); c.clip(sp); const g = c.createLinearGradient(0, yt, 0, yb); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, C(PAL.deep, 1, 0.45)); c.fillStyle = g; c.fill(sp); c.restore(); }
  };
  if (kx > 0.012) endFace(right, true, !!brokenR);
  else if (kx < -0.012) endFace(left, false, !!brokenL);
  if (ky < -0.012) {
    const tp = pathOf([...topL.map((q) => ({ x: q.x, y: q.y + 0.1 })), ...topL.slice().reverse().map((q) => p.P(q.x, q.y + (brokenTop ? (rng.next() - 0.4) * amp : 0), d))]);
    p.face(tp, C(brokenTop ? PAL.topBroken : PAL.top), N_TOP);
  }
  p.begin();
  const cc = p.c;
  p.face(op, C(t.tone || PAL.front), N_FRONT);
  cc.save(); cc.clip(op);
  masonry(p, rng, x0 - 1, x1 + 1, yt - 1, yb, { courseH: t.courseH ?? rng.range(0.7, 1.1), blockW: t.blockW ?? rng.range(1.2, 2.0), tone: t.tone || PAL.front });
  shadeFace(p, x0, x1, yt, yb, 0.11, 0.45, 0.04);
  stains(p, rng, x0, x1, yt, yb, Math.round(W / 3), 0.2);
  // cornice band
  if (cornice && !brokenTop) {
    const ch = Math.min(1.2, (yb - yt) * 0.09);
    cc.fillStyle = C(PAL.frontHi, 1.05); cc.fillRect(x0 - 1, yt, W + 2, ch);
    cc.fillStyle = C(PAL.moon, 1, 0.55); cc.fillRect(x0 - 1, yt, W + 2, Math.max(p.px * 1.1, ch * 0.04));
    cc.fillStyle = C(PAL.deep, 1, 0.7); cc.fillRect(x0 - 1, yt + ch, W + 2, Math.max(p.px * 1.5, ch * 0.18));
    const g = cc.createLinearGradient(0, yt + ch, 0, yt + ch * 2.5); g.addColorStop(0, C(PAL.deep, 1, 0.35)); g.addColorStop(1, C(PAL.deep, 1, 0));
    cc.fillStyle = g; cc.fillRect(x0 - 1, yt + ch, W + 2, ch * 1.5);
  }
  // imposts + archivolts
  for (let i = 0; i < n; i++) {
    const cx = x0 + pier + a + i * (span + pier);
    const bw = Math.min(a * 0.32, 1.1);
    const outer = archPts(cx, a + bw, springY, springY, pointed).slice(1, -1);
    const inner = archPts(cx, a, springY, springY, pointed).slice(1, -1).reverse();
    const ring = pathOf([...outer, ...inner]);
    cc.fillStyle = C(PAL.frontHi, 1.02); cc.fill(ring);
    if (bw * p.ppm > 4) {
      // voussoir joints
      const nv = Math.max(7, Math.round((Math.PI * a) / (bw * 0.9)));
      cc.strokeStyle = C(PAL.deep, 1, 0.65); cc.lineWidth = Math.max(p.px, 0.03);
      cc.beginPath();
      const op2 = archPts(cx, a, springY, springY, pointed, nv).slice(1, -1), oo = archPts(cx, a + bw, springY, springY, pointed, nv).slice(1, -1);
      for (let k = 0; k < Math.min(op2.length, oo.length); k += 2) { cc.moveTo(op2[k].x, op2[k].y); cc.lineTo(oo[k].x, oo[k].y); }
      cc.stroke();
      cc.strokeStyle = C(PAL.deep, 1, 0.8); cc.lineWidth = Math.max(p.px * 1.2, 0.04); cc.stroke(pathOf(outer, false));
      cc.strokeStyle = C(PAL.top, 1, 0.35); cc.lineWidth = Math.max(p.px, 0.03);
      cc.save(); cc.translate(-0.04, -0.05); cc.stroke(pathOf(outer.slice(0, Math.ceil(outer.length * 0.55)), false)); cc.restore();
      // keystone
      const top = archCrown(a + bw, pointed);
      cc.fillStyle = C(PAL.frontHi, 1.12);
      cc.beginPath(); cc.moveTo(cx - bw * 0.42, springY - top + bw * 0.1); cc.lineTo(cx + bw * 0.42, springY - top + bw * 0.1); cc.lineTo(cx + bw * 0.3, springY - top + bw * 1.15); cc.lineTo(cx - bw * 0.3, springY - top + bw * 1.15); cc.closePath(); cc.fill();
    }
    // impost blocks
    const ih = Math.min(0.5, a * 0.14);
    for (const sx of [-1, 1]) {
      const ix = cx + sx * (a + pier * 0.25);
      cc.fillStyle = C(PAL.frontHi, 1.08); cc.fillRect(ix - pier * 0.4, springY - ih, pier * 0.8, ih);
      cc.fillStyle = C(PAL.deep, 1, 0.6); cc.fillRect(ix - pier * 0.4, springY, pier * 0.8, Math.max(p.px * 1.2, ih * 0.25));
    }
  }
  if (t.cracks !== 0) for (let i = 0; i < 1 + Math.round(W / 10); i++) crack(p, rng, lerp(x0, x1, rng.next()), lerp(yt, yb, rng.next() * 0.7), Math.PI / 2 + (rng.next() - 0.5) * 1.8, (yb - yt) * (0.12 + rng.next() * 0.25), Math.max(p.px * 1.5, 0.05));
  cc.restore();
  // openings: reveal (jamb / soffit), then see-through
  for (let i = 0; i < n; i++) {
    const cx = x0 + pier + a + i * (span + pier);
    const oPts = archPts(cx, a, springY, yb + 0.5, pointed);
    const opn = pathOf(oPts);
    cc.save(); cc.clip(op); cc.clip(opn);
    const jt = kx > 0 ? PAL.right : PAL.left;
    p.face(opn, C(mixc(jt, PAL.reveal, 0.5)), kx > 0 ? N_RIGHT : N_LEFT);
    // soffit band near the crown
    const crown = springY - archCrown(a, pointed);
    const g = cc.createLinearGradient(0, crown, 0, springY + 1);
    g.addColorStop(0, C(PAL.soffit, 1, 0.95)); g.addColorStop(1, C(PAL.soffit, 1, 0));
    cc.fillStyle = g; cc.fill(opn);
    if (a * p.ppm > 10) {
      // soffit voussoir lines seen from below
      cc.strokeStyle = C(PAL.deep, 1, 0.5); cc.lineWidth = Math.max(p.px, 0.03);
      const sh = { x: kx * d, y: ky * d };
      const arc = archPts(cx, a, springY, springY, pointed, 10).slice(1, -1);
      cc.beginPath(); for (let k = 0; k < arc.length; k += 2) { cc.moveTo(arc[k].x, arc[k].y); cc.lineTo(arc[k].x + sh.x, arc[k].y + sh.y); } cc.stroke();
    }
    cc.restore();
    // see-through: the opening shifted to the back face
    const back = oPts.map((q) => p.P(q.x, q.y, d));
    const bp = pathOf(back);
    for (const ctx of [p.c, p.n]) { ctx.save(); ctx.clip(opn); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(bp); ctx.restore(); }
    // dark line art around the opening
    cc.save(); cc.clip(op); cc.strokeStyle = C(PAL.line, 1, 0.65); cc.lineWidth = Math.max(p.px * 1.3, 0.04); cc.stroke(opn); cc.restore();
  }
  p.end();
  return { springY, a, span, pier };
}

function genArcade(rng, o) {
  // o.tiers: [{n, h, springFrac, pointed}], o.w total width, o.d depth
  const w = o.w ?? rng.range(14, 30), d = o.d ?? rng.range(2.2, 3.6);
  const tiers = o.tiers || [{ n: Math.max(1, Math.round(w / rng.range(5, 8))), h: o.h ?? rng.range(10, 18) }];
  const H = tiers.reduce((s, t) => s + t.h, 0);
  const ext = d * 0.8 + 1;
  return {
    bb: { x0: -w / 2 - ext, x1: w / 2 + ext, y0: -H - ext - 2, y1: 1 + ext },
    paint(p, ox = 0, oy = 0) {
      let yb = oy;
      const pointed = o.pointed ?? (rng.next() < 0.35);
      let bl = o.brokenL ?? 0, br = o.brokenR ?? 0;
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        const last = i === tiers.length - 1;
        const tierW = w;
        // upper tiers are broken back further (stepped ruin profile)
        const tl = bl ? bl + i * rng.range(1, 4) : (i > 0 && rng.next() < 0.4 ? rng.range(2, 6) : 0);
        const tr = br ? br + i * rng.range(1, 4) : (i > 0 && rng.next() < 0.4 ? rng.range(2, 6) : 0);
        const x0 = ox - tierW / 2, x1 = ox + tierW / 2;
        const dd = d * (1 - i * 0.12);
        paintTier(p, rng, {
          x0, x1, yb, yt: yb - t.h, n: t.n, d: dd, pointed: t.pointed ?? pointed, brokenL: tl, brokenR: tr,
          brokenTop: last ? (o.brokenTop ?? true) : false, springY: yb - t.h * (t.springFrac ?? 0.55), pier: t.pier,
          cornice: !last || !(o.brokenTop ?? true),
        });
        yb -= t.h;
      }
    },
  };
}

function genTower(rng, o) {
  const w = o.w ?? rng.range(4, 8), d = o.d ?? w, h = o.h ?? rng.range(14, 30);
  const spireH = o.spire ?? (rng.next() < 0.7 ? w * rng.range(1.6, 3.2) : 0);
  const broken = o.broken ?? (rng.next() < 0.4);
  return {
    bb: { x0: -w / 2 - w * 0.7 - d * 0.7 - 1, x1: w / 2 + w * 0.7 + d * 0.7 + 1, y0: -h - spireH - 4 - d * 0.7, y1: 1 + d * 0.7 },
    paint(p, ox = 0, oy = 0) {
      const x0 = ox - w / 2, x1 = ox + w / 2, yt = oy - h;
      const amp = w * 0.3;
      const topLine = broken && !spireH ? brokenLine(rng, x0, x1, yt + amp, amp) : null;
      // buttresses (stepped) on both sides
      for (const sx of [-1, 1]) {
        const bw = w * 0.16, bx = sx < 0 ? x0 - bw * 0.7 : x1 - bw * 0.3;
        paintBlock(p, rng, { x0: bx, x1: bx + bw, yTop: yt + h * 0.25, yBot: oy, d: d * 1.05, tone: PAL.front, courseH: 1.1, shadeSide: 0.0 });
        paintBlock(p, rng, { x0: bx + bw * 0.15, x1: bx + bw * 0.85, yTop: yt + h * 0.08, yBot: yt + h * 0.25 + 0.05, d: d, tone: PAL.front });
      }
      paintBlock(p, rng, { x0, x1, yTop: yt, yBot: oy, d, topLine, amp, courseH: rng.range(0.8, 1.2), blockW: w * 0.3, stains: Math.round(h / 4), cracks: 2, tone: PAL.front });
      const c = p.c;
      // string courses
      for (let k = 1; k <= 2; k++) {
        const y = oy - h * k / 3;
        c.fillStyle = C(PAL.frontHi, 1.08); c.fillRect(x0, y - 0.3, w, 0.3);
        c.fillStyle = C(PAL.deep, 1, 0.6); c.fillRect(x0, y, w, Math.max(p.px * 1.2, 0.08));
      }
      // lancet windows
      const rows = Math.max(1, Math.round(h / 9));
      for (let r = 0; r < rows; r++) {
        const yS = oy - h * (r + 0.55) / rows, ww = w * 0.13;
        const nW = w > 5 ? 2 : 1;
        for (let k = 0; k < nW; k++) {
          const cx = nW === 1 ? ox : ox + (k - 0.5) * w * 0.38;
          const wp = pathOf(archPts(cx, ww, yS - ww * 1.2, yS + ww * 2.2, true, 8));
          c.fillStyle = C(PAL.window); c.fill(wp);
          c.strokeStyle = C(PAL.frontHi, 1.15, 0.6); c.lineWidth = Math.max(p.px * 1.2, 0.06); c.stroke(wp);
        }
      }
      if (spireH) {
        // pinnacles + faceted spire with crockets
        for (const sx of [-1, 1]) spire(p, rng, sx < 0 ? x0 + w * 0.08 : x1 - w * 0.08, yt, w * 0.12, spireH * 0.35);
        const sp = spire(p, rng, ox, yt, w * 0.42, spireH * (broken ? rng.range(0.4, 0.7) : 1), broken);
        // parapet band
        c.fillStyle = C(PAL.frontHi, 1.1); c.fillRect(x0 - 0.2, yt - 0.6, w + 0.4, 0.7);
        c.fillStyle = C(PAL.moon, 1, 0.45); c.fillRect(x0 - 0.2, yt - 0.6, w + 0.4, Math.max(p.px * 1.1, 0.025));
      } else if (!broken) {
        // crenellations
        const nm = Math.max(3, Math.round(w / 1.2));
        for (let k = 0; k < nm; k += 2) paintBlock(p, rng, { x0: x0 + (k / nm) * w, x1: x0 + ((k + 1) / nm) * w, yTop: yt - 1.0, yBot: yt + 0.02, d: d * 0.25, tone: PAL.frontHi, noSide: true });
      }
    },
  };
}
// faceted gothic spire (front facets lighter on the left), crockets along the edges
function spire(p, rng, cx, yb, hw, h, broken = false) {
  const c = p.c;
  const tip = { x: cx + (rng.next() - 0.5) * hw * 0.1, y: yb - h };
  let L = [{ x: cx - hw, y: yb }, tip, { x: cx + hw, y: yb }];
  if (broken) {
    const k = rng.range(0.45, 0.75);
    const yb2 = yb - h * k;
    const bl = brokenLine(rng, cx - hw * (1 - k), cx + hw * (1 - k), yb2, hw * 0.5);
    L = [{ x: cx - hw, y: yb }, ...bl, { x: cx + hw, y: yb }];
  }
  const path = pathOf(L);
  p.face(path, C(PAL.front), N_FRONT);
  c.save(); c.clip(path);
  // left facet lit, right facet dark, ridge line
  c.fillStyle = C(PAL.left, 0.95);
  c.beginPath(); c.moveTo(cx - hw, yb); c.lineTo(tip.x, tip.y); c.lineTo(cx - hw * 0.15, yb); c.closePath(); c.fill();
  c.fillStyle = C(PAL.right);
  c.beginPath(); c.moveTo(cx + hw * 0.25, yb); c.lineTo(tip.x, tip.y); c.lineTo(cx + hw, yb); c.closePath(); c.fill();
  if (hw * p.ppm > 4) {
    c.strokeStyle = C(PAL.deep, 1, 0.5); c.lineWidth = Math.max(p.px, 0.03);
    for (let y = yb - h * 0.12; y > yb - h; y -= h * 0.12) { const f = (yb - y) / h; c.beginPath(); c.moveTo(cx - hw * (1 - f), y); c.lineTo(cx + hw * (1 - f), y); c.stroke(); }
  }
  c.restore();
  // crockets: small spikes along both edges
  if (hw * p.ppm > 5 && !broken) {
    c.fillStyle = C(PAL.front);
    for (let i = 1; i < 7; i++) {
      const f = i / 7;
      for (const sx of [-1, 1]) {
        const x = cx + sx * hw * (1 - f), y = yb - h * f, s = hw * 0.18 * (1 - f * 0.5);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + sx * s, y - s * 0.6); c.lineTo(x, y - s * 1.2); c.closePath(); c.fill();
      }
    }
  }
  p.n.fillStyle = N_FRONT;
  return path;
}

// floating rock island (inverted jagged cone with spikes, strata, hanging roots) + ruins on top
function genIsland(rng, o) {
  const w = o.w ?? rng.range(12, 40);
  const depth = o.depth ?? w * rng.range(0.55, 1.1);
  const children = (o.children || []).map((ch) => ({ ...ch, g: ch.gen(rng, ch.o || {}) }));
  let y0 = -2, x0 = -w / 2 - 2, x1 = w / 2 + 2;
  for (const ch of children) { y0 = Math.min(y0, ch.g.bb.y0 - 0.5); x0 = Math.min(x0, ch.x + ch.g.bb.x0); x1 = Math.max(x1, ch.x + ch.g.bb.x1); }
  const td = w * 0.45; // top surface depth
  return {
    bb: { x0: x0 - td * 0.6, x1: x1 + td * 0.6, y0: y0 - td * 0.6, y1: depth * 1.35 + 4 + td * 0.6 },
    paint(p, ox = 0, oy = 0) {
      const c = p.c;
      // top surface (visible when looking down)
      const lip = Math.max(0.8, w * 0.05);
      if (p.ky < -0.01) {
        const topPts = [];
        for (let i = 0; i <= 16; i++) { const th = Math.PI + (i / 16) * TAU; topPts.push(p.P(ox + Math.cos(th) * w * 0.5 * (0.9 + rng.next() * 0.12), oy, td * (0.5 + 0.5 * Math.sin(th)) * (0.9 + rng.next() * 0.15))); }
        const tp = pathOf(roughPoly(rng, topPts, 0.3, 1.2));
        p.face(tp, C(PAL.top, 0.82), N_TOP);
        c.save(); c.clip(tp);
        for (let i = 0; i < 18; i++) { c.fillStyle = C(PAL.deep, 1, 0.2 + rng.next() * 0.2); const q = p.P(ox + (rng.next() - 0.5) * w * 0.9, oy, td * rng.next()); c.beginPath(); c.ellipse(q.x, q.y, 0.4 + rng.next() * 1.4, 0.2 + rng.next() * 0.4, 0, 0, TAU); c.fill(); }
        c.restore();
      }
      // body contour
      const n = 22;
      const tipX = ox + (o.tipX ?? (rng.next() - 0.5) * w * 0.3);
      const pts = [{ x: ox - w / 2, y: oy - lip * 0.2 }];
      for (let i = 1; i < n; i++) {
        const t = i / n, x = ox - w / 2 + w * t;
        const dt = Math.abs(x - tipX) / (w * 0.5);
        let y = oy + lip + depth * Math.pow(Math.max(0, 1 - dt), 1.35) * (0.75 + 0.35 * rng.next());
        if (rng.next() < 0.22) y += depth * rng.range(0.12, 0.35) * (1 - dt * 0.6);
        pts.push({ x: x + (rng.next() - 0.5) * w / n * 0.8, y });
        // stalactite spike
        if (rng.next() < 0.28) { const sl = depth * rng.range(0.15, 0.45) * (1 - dt * 0.5); pts.push({ x: x + w / n * 0.25, y: y + sl }); pts.push({ x: x + w / n * 0.5, y: y + sl * 0.15 }); }
      }
      pts.push({ x: ox + w / 2, y: oy - lip * 0.2 });
      // main tip
      let mi = 0, md = 1e9;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i].x - tipX); if (d < md) { md = d; mi = i; } }
      pts.splice(mi + 1, 0, { x: tipX + w * 0.02, y: oy + depth * 1.3 }, { x: tipX + w * 0.05, y: pts[mi].y });
      const body = pathOf(roughPoly(rng, pts, 0.15, 1.0));
      p.face(body, C(PAL.rockMid), N_FRONT);
      c.save(); c.clip(body);
      // facets converging to the tip: lit on the left, dark on the right
      const nf = 9;
      for (let i = 0; i < nf; i++) {
        const xa = ox - w / 2 + w * (i / nf), xb = ox - w / 2 + w * ((i + 1) / nf);
        const f = (i + 0.5) / nf;
        const tone = f < 0.3 ? mixc(PAL.rockLit, PAL.rockMid, f / 0.3) : f < 0.62 ? PAL.rockMid : mixc(PAL.rockMid, PAL.rockDark, Math.min(1, (f - 0.62) / 0.25));
        const k = 0.9 + rng.next() * 0.2;
        c.fillStyle = C(tone, k);
        const mx = lerp(xa, xb, rng.next()), my = oy + depth * rng.range(0.25, 0.6);
        c.beginPath(); c.moveTo(xa, oy - 2); c.lineTo(xb, oy - 2); c.lineTo(lerp(xb, tipX, 0.6), oy + depth * 1.4); c.lineTo(lerp(xa, tipX, 0.6), oy + depth * 1.4); c.closePath(); c.fill();
        if (p.ppm > 3) { c.strokeStyle = C(PAL.deep, 1, 0.45); c.lineWidth = Math.max(p.px, 0.04); c.beginPath(); c.moveTo(xa, oy); c.lineTo(mx, my); c.lineTo(lerp(xa, tipX, 0.75), oy + depth * 1.2); c.stroke(); }
      }
      // strata
      if (p.ppm > 2.5) {
        for (let s = 0; s < 7; s++) {
          const y = oy + lip + depth * (0.06 + s * 0.12 + rng.next() * 0.05);
          c.strokeStyle = C(s % 2 ? PAL.deep : PAL.rockLit, 1, s % 2 ? 0.45 : 0.18); c.lineWidth = Math.max(p.px * 1.3, 0.08);
          c.beginPath();
          for (let i = 0; i <= 20; i++) { const x = ox - w / 2 + w * i / 20; const yy = y + Math.sin(i * 0.9 + s) * depth * 0.02 + (rng.next() - 0.5) * depth * 0.02; i ? c.lineTo(x, yy) : c.moveTo(x, yy); }
          c.stroke();
        }
      }
      // darken toward the tip, lip highlight at the top
      const g = c.createLinearGradient(0, oy, 0, oy + depth * 1.3);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, C(PAL.deep, 1, 0.25)); g.addColorStop(1, C(PAL.deep, 1, 0.75));
      c.fillStyle = g; c.fillRect(ox - w, oy - 2, w * 2, depth * 1.5);
      c.fillStyle = C(PAL.top, 0.9, 0.7); c.fillRect(ox - w, oy - lip * 0.2, w * 2, Math.max(p.px * 1.5, lip * 0.12));
      c.fillStyle = C(PAL.deep, 1, 0.55); c.fillRect(ox - w, oy + lip * 0.15, w * 2, Math.max(p.px * 1.5, lip * 0.25));
      c.restore();
      // hanging roots
      if (p.ppm > 2) {
        const nr = Math.round(w * rng.range(0.25, 0.5));
        c.lineCap = 'round';
        for (let i = 0; i < nr; i++) {
          const bx = ox + (rng.next() - 0.5) * w * 0.8;
          const dt = Math.abs(bx - tipX) / (w * 0.5);
          const by = oy + lip + depth * Math.pow(Math.max(0, 1 - dt), 1.35) * 0.55;
          const len = depth * rng.range(0.3, 0.9);
          let x = bx, y = by;
          const segs = 8, sw = rng.range(0.6, 1.4);
          for (let s = 0; s < segs; s++) {
            const t = s / segs;
            const nx = x + Math.sin(s * 1.3 + i) * len * 0.05 * sw, ny = y + len / segs;
            c.strokeStyle = C(PAL.root, 1, 0.95); c.lineWidth = Math.max(p.px * 1.2, 0.18 * (1 - t) * sw);
            c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny); c.stroke();
            x = nx; y = ny;
          }
        }
      }
      for (const ch of children) ch.g.paint(p, ox + ch.x, oy + (ch.y || 0));
    },
  };
}

// distant castle: spiky cluster of towers & spires on an island
function genCastle(rng, o) {
  const w = o.w ?? 70;
  const children = [];
  const nT = o.towers ?? 9;
  for (let i = 0; i < nT; i++) {
    const t = i / (nT - 1);
    const centre = 1 - Math.abs(t - 0.5) * 2;
    const tw = rng.range(4, 8) * (0.7 + centre * 0.6);
    children.push({ x: (t - 0.5) * w * 0.8 + rng.range(-2, 2), gen: genTower, o: { w: tw, h: rng.range(14, 26) + centre * 40, spire: tw * rng.range(2, 3.6) * (0.8 + centre), broken: rng.next() < 0.2 } });
  }
  // curtain walls between towers
  children.unshift({ x: 0, gen: genArcade, o: { w: w * 0.75, d: 3, tiers: [{ n: 6, h: 14 }], brokenTop: false, pointed: true } });
  // sort tallest to the back
  return genIsland(rng, { w: w * 1.05, depth: o.depth ?? w * 0.8, children });
}

// =====================================================================================
// Layout + build
// =====================================================================================
const REF_CAM = { x: 0, y: -1.2, z: -14, f: 1303 };

function defaultLayout(rng, opts = {}) {
  const L = [];
  const add = (kind, x, y, z, o = {}, extra = {}) => L.push({ kind, x, y, z, o, ...extra });
  const cloudBase = 22;
  // ---------- hero / framing pieces (z 18..60) ----------
  add('pier', -29, cloudBase, 26, { w: 4.6, h: 50, capital: false, brokenTop: true }, { rooted: 1 });
  add('column', -20.5, cloudBase, 36, { r: 1.45, h: 36, capital: false, brokenTop: true }, { rooted: 1 });
  // aqueducts run diagonally into depth, converging on the centre (yaw > 0 left side, < 0 right side)
  add('arcade', -40, cloudBase, 52, { w: 26, d: 3.2, tiers: [{ n: 3, h: 26, springFrac: 0.62 }, { n: 5, h: 10 }], brokenR: 3, brokenTop: true, pointed: false }, { yaw: 0.5, rooted: 1 });
  add('column', 22, cloudBase, 42, { r: 1.6, h: 49, capital: true, brokenTop: false, flutes: 16 }, { id: 'hero', rooted: 1 });
  add('arcade', 34, cloudBase, 34, { w: 26, d: 3.4, tiers: [{ n: 3, h: 27, springFrac: 0.6 }, { n: 6, h: 11 }], brokenL: 2, brokenTop: true }, { yaw: -0.42, rooted: 1 });
  add('pier', 25, cloudBase, 60, { w: 4.2, h: 44, capital: true, brokenTop: false }, { rooted: 1 });
  add('tower', -64, cloudBase, 82, { w: 7, h: 48, spire: 22, broken: true }, { rooted: 1 });
  add('gothic', -60, cloudBase, 100, { w: 14, h: 40 }, { rooted: 1 });
  add('gothic', 62, cloudBase, 94, { w: 15, h: 44 }, { rooted: 1 });
  // ---------- aqueduct + arcades (z 70..220) ----------
  add('arcade', 76, cloudBase, 124, { w: 90, d: 3.6, tiers: [{ n: 7, h: 26, springFrac: 0.6 }, { n: 14, h: 12 }], brokenL: 4, brokenR: 6, brokenTop: true }, { yaw: -0.6, rooted: 1 });
  add('arcade', -100, cloudBase, 156, { w: 70, d: 3.4, tiers: [{ n: 6, h: 24 }, { n: 12, h: 10 }], brokenL: 5, brokenTop: true }, { yaw: 0.58, rooted: 1 });
  add('arcade', -72, cloudBase, 214, { w: 40, d: 3, tiers: [{ n: 4, h: 22, pointed: true }], brokenR: 4, brokenTop: true, pointed: true }, { yaw: 0.5, rooted: 1 });
  // ---------- far castle ----------
  add('castle', 6, -4, 345, { w: 135, depth: 105, towers: 13 }, { id: 'castle', fogK: 1.0 });
  // ---------- floating islands carrying ruins ----------
  const isl = [
    [-40, -26, 112, 26], [48, -40, 172, 34], [-112, -52, 262, 48], [124, -24, 242, 40], [-30, -62, 322, 30], [190, -60, 380, 56], [-230, -30, 420, 60], [96, -14, 300, 28],
  ];
  for (const [x, y, z, w] of isl) {
    const ch = [];
    const k = rng.int(1, 3);
    for (let i = 0; i < k; i++) {
      const r = rng.next();
      const cx = (rng.next() - 0.5) * w * 0.6;
      if (r < 0.35) ch.push({ x: cx, gen: genColumn, o: { r: rng.range(0.8, 1.4), h: rng.range(6, 16) } });
      else if (r < 0.65) ch.push({ x: cx, gen: genArcade, o: { w: rng.range(10, w * 0.6), d: 2.4, tiers: [{ n: rng.int(1, 3), h: rng.range(8, 14) }], brokenTop: true, brokenL: rng.next() < 0.5 ? 2 : 0 } });
      else if (r < 0.85) ch.push({ x: cx, gen: genPier, o: { w: rng.range(2, 3.5), h: rng.range(6, 15) } });
      else ch.push({ x: cx, gen: genTower, o: { w: rng.range(4, 7), h: rng.range(10, 20) } });
    }
    add('island', x, y, z, { w, children: ch });
  }
  // ---------- mid / far field: rising from the cloud sea, ~40 % lifted on floating rock bases ----------
  const kinds = ['pier', 'column', 'arcade', 'tower', 'pier', 'column', 'gothic', 'tower'];
  for (let i = 0; i < 92; i++) {
    const z = lerp(70, 600, Math.pow(rng.next(), 0.8));
    const spread = 0.95 * (z + 30);
    let x = (rng.next() * 2 - 1) * spread;
    if (Math.abs(x) < z * 0.1 && z >= 300) x += Math.sign(x || 1) * z * 0.12; // keep the castle clear
    if (Math.abs(x) < z * 0.3 && z > 60 && z < 300) x = Math.sign(x || 1) * (z * 0.3 + Math.abs(x) * 0.6); // open central corridor
    const kind = rng.pick(kinds);
    const s = 0.8 + rng.next() * 0.9;
    const o = kind === 'arcade' ? { w: rng.range(14, 50) * s, tiers: rng.next() < 0.4 ? [{ n: rng.int(2, 5), h: rng.range(14, 24) * s }, { n: rng.int(4, 9), h: rng.range(7, 11) * s }] : [{ n: rng.int(2, 6), h: rng.range(14, 28) * s }], brokenL: rng.next() < 0.6 ? 3 : 0, brokenR: rng.next() < 0.6 ? 3 : 0 }
      : kind === 'tower' ? { w: rng.range(5, 9) * s, h: rng.range(20, 45) * s }
      : kind === 'gothic' ? { w: rng.range(10, 16) * s, h: rng.range(26, 42) * s }
        : kind === 'pier' ? { w: rng.range(3, 6) * s, h: rng.range(18, 50) * s }
          : { r: rng.range(1, 2) * s, h: rng.range(16, 42) * s };
    const yaw = kind === 'arcade' ? -Math.sign(x) * rng.range(0.25, 0.6) : 0;
    const lift = rng.next() < 0.4;
    if (lift) {
      const sw = kind === 'arcade' ? o.w * 0.75 : kind === 'column' ? o.r * 6 : o.w * 1.8;
      const iw = Math.max(9, sw * rng.range(1.1, 1.4) + rng.range(2, 6));
      if (o.h) o.h *= 0.7; if (o.tiers) o.tiers.forEach((t) => { t.h *= 0.7; });
      add('island', x, cloudBase - rng.range(8, 34), z, { w: iw, depth: iw * rng.range(0.5, 0.95), children: [{ x: rng.range(-0.15, 0.15) * iw, gen: GEN[kind], o }] }, { yaw: yaw * 0.5 });
    } else add(kind, x, cloudBase + rng.range(-1, 3), z, o, { yaw, rooted: 1 });
  }
  // ---------- floating broken column / pier fragments: real 3D meshes (debris renderer), tumbling slowly ----------
  L.frags = [];
  for (let i = 0; i < 64; i++) {
    const z = lerp(26, 400, Math.pow(rng.next(), 1.2));
    const spread = 0.9 * (z + 20);
    const x = (rng.next() * 2 - 1) * spread;
    const y = -rng.range(4, 18) - z * rng.range(0.04, 0.2);
    if (Math.abs(x) < 9 && z < 60 && y > -14) continue;
    const square = rng.next() < 0.4;
    const big = rng.next() < 0.3 ? 1.7 : 1;
    const len = rng.range(4, 13) * big;
    const r = square ? rng.range(0.9, 1.8) * big : rng.range(0.7, 1.4) * big;
    if (opts.spriteFragments) {
      const o = square ? { w: r * 2, h: len, floating: true, brokenTop: true, capital: rng.next() < 0.3 } : { r, h: len, floating: true, brokenTop: true, capital: false };
      add(square ? 'pier' : 'column', x, y, z, o, { rot: (rng.next() - 0.5) * 1.1, floatAmp: rng.range(0.2, 0.8) });
    } else L.frags.push({ x, y, z, len, r, square });
  }
  return L;
}

// gothic cathedral wall fragment: buttresses with pinnacles, one huge pointed window with tracery + rose
function genGothic(rng, o) {
  const w = o.w ?? rng.range(10, 16), h = o.h ?? rng.range(24, 38), d = o.d ?? rng.range(2.2, 3);
  const bw = w * 0.13;
  return {
    bb: { x0: -w / 2 - bw * 2 - d - 1, x1: w / 2 + bw * 2 + d + 1, y0: -h - h * 0.35 - d - 2, y1: 1 + d },
    paint(p, ox = 0, oy = 0) {
      const c = p.c;
      // buttresses (stepped) with pinnacles
      for (const sx of [-1, 1]) {
        const bx0 = sx < 0 ? ox - w / 2 - bw * 1.1 : ox + w / 2 - bw * 0.1, bx1 = bx0 + bw * 1.2;
        const bh = h * rng.range(0.8, 1.0);
        paintBlock(p, rng, { x0: bx0, x1: bx1, yTop: oy - bh * 0.55, yBot: oy, d: d * 1.6, tone: PAL.front, courseH: 1.0, blockW: bw, cracks: 1 });
        paintBlock(p, rng, { x0: bx0 + bw * 0.15, x1: bx1 - bw * 0.15, yTop: oy - bh, yBot: oy - bh * 0.55 + 0.05, d: d * 1.3, tone: PAL.front, courseH: 1.0, blockW: bw });
        if (rng.next() < 0.75) spire(p, rng, (bx0 + bx1) / 2, oy - bh, bw * 0.45, bh * rng.range(0.18, 0.3), rng.next() < 0.3);
      }
      const r = paintTier(p, rng, { x0: ox - w / 2, x1: ox + w / 2, yb: oy, yt: oy - h, n: 1, d, pointed: true, pier: w * 0.2, springY: oy - h * 0.52, brokenTop: true, brokenL: 0, brokenR: rng.next() < 0.5 ? 1.5 : 0, cornice: false });
      // tracery: two mullions, sub-arches, rose
      const a = r.span / 2, cx = ox, yS = oy - h * 0.52, crown = archCrown(a, true);
      const lw = Math.max(p.px * 2, a * 0.09);
      const strokeStone = (path, wdt) => {
        c.lineCap = 'butt'; c.lineJoin = 'round';
        c.strokeStyle = C(PAL.line, 1, 0.9); c.lineWidth = wdt + Math.max(p.px * 2, wdt * 0.25); c.stroke(path);
        c.strokeStyle = C(PAL.frontHi); c.lineWidth = wdt; c.stroke(path);
        c.strokeStyle = C(PAL.top, 1, 0.35); c.lineWidth = wdt * 0.25; c.save(); c.translate(-wdt * 0.25, -wdt * 0.2); c.stroke(path); c.restore();
        p.n.strokeStyle = N_FRONT; p.n.lineWidth = wdt * 1.1; p.n.stroke(path);
      };
      const tr = new Path2D();
      tr.moveTo(cx, oy); tr.lineTo(cx, yS);
      // two sub-arches springing from the mullions
      for (const sx of [-1, 1]) {
        const sc = cx + sx * a * 0.5, sa = a * 0.5;
        const pts = archPts(sc, sa, yS, yS, true, 8).slice(1, -1);
        tr.moveTo(pts[0].x, pts[0].y); for (const q of pts) tr.lineTo(q.x, q.y);
      }
      strokeStone(tr, lw);
      const rr = a * 0.42, ry = yS - crown + rr * 1.25;
      const rose = new Path2D(); rose.arc(cx, ry, rr, 0, TAU);
      for (let i = 0; i < 8; i++) { const th = (i / 8) * TAU; rose.moveTo(cx + Math.cos(th) * rr * 0.3, ry + Math.sin(th) * rr * 0.3); rose.lineTo(cx + Math.cos(th) * rr, ry + Math.sin(th) * rr); }
      rose.moveTo(cx + rr * 0.3, ry); rose.arc(cx, ry, rr * 0.3, 0, TAU);
      strokeStone(rose, lw * 0.75);
    },
  };
}
// low broken balustrade: base rail, vase balusters, top rail with gaps, end posts
function genBalustrade(rng, o) {
  const w = o.w ?? 6, h = o.h ?? 1.15, d = o.d ?? 0.5;
  return {
    bb: { x0: -w / 2 - 1.2, x1: w / 2 + 1.2, y0: -h - 0.9, y1: 0.6 },
    paint(p, ox = 0, oy = 0) {
      const x0 = ox - w / 2, x1 = ox + w / 2, c = p.c;
      const railH = 0.2, baseH = 0.24;
      paintBlock(p, rng, { x0, x1, yTop: oy - baseH, yBot: oy, d: d * 1.1, tone: PAL.frontHi, cracks: 1, rough: 0.025 });
      const nb = Math.round(w / 0.42);
      const gap0 = o.gap ? rng.range(0.2, 0.6) : 2, gap1 = gap0 + rng.range(0.15, 0.3);
      for (let i = 0; i < nb; i++) {
        const t = (i + 0.5) / nb;
        if (rng.next() < (o.missing ?? 0.12)) continue;
        const bx = lerp(x0 + 0.35, x1 - 0.35, t);
        const yb = oy - baseH, yt = oy - h + railH;
        const broken = (t > gap0 && t < gap1) || rng.next() < 0.08;
        const prof = [[0, 0.075], [0.08, 0.075], [0.12, 0.05], [0.36, 0.085], [0.55, 0.06], [0.72, 0.035], [0.84, 0.05], [0.92, 0.065], [1, 0.065]];
        const top = broken ? rng.range(0.35, 0.7) : 1;
        const L = [], R = [];
        for (const [f, r] of prof) { if (f > top) break; const y = lerp(yb, yt, f); L.push({ x: bx - r, y }); R.push({ x: bx + r, y }); }
        if (broken) { const y = lerp(yb, yt, top); L.push({ x: bx - 0.03, y: y - 0.04 }); R.push({ x: bx + 0.04, y: y + 0.02 }); }
        const path = pathOf([...L, ...R.reverse()]);
        const g = c.createLinearGradient(bx - 0.09, 0, bx + 0.09, 0);
        g.addColorStop(0, C(PAL.left, 1.05)); g.addColorStop(0.3, C(PAL.frontHi)); g.addColorStop(0.55, C(PAL.front)); g.addColorStop(0.56, C(PAL.right)); g.addColorStop(1, C(PAL.right, 1.2));
        c.fillStyle = g; c.fill(path);
        const gn = p.n.createLinearGradient(bx - 0.09, 0, bx + 0.09, 0);
        gn.addColorStop(0, 'rgb(170,0,128)'); gn.addColorStop(0.5, 'rgb(0,0,128)'); gn.addColorStop(1, 'rgb(0,170,128)');
        p.n.fillStyle = gn; p.n.fill(path);
      }
      // top rail with a broken gap
      const yt = oy - h, rx = (f) => lerp(x0, x1, f);
      const segs = o.gap ? [[0, gap0 - 0.02], [gap1 + 0.02, 1]] : [[0, 1]];
      for (const [a, b] of segs) {
        if (b - a < 0.04) continue;
        const brokenEndL = a > 0, brokenEndR = b < 1;
        const top = [{ x: rx(a), y: yt }, { x: rx(b), y: yt }];
        const bot = [{ x: rx(b) - (brokenEndR ? 0.1 : 0), y: yt + railH }, { x: rx(a) + (brokenEndL ? 0.12 : 0), y: yt + railH }];
        paintBlock(p, rng, { x0: rx(a), x1: rx(b), yTop: yt, yBot: yt + railH, d: d * 1.15, tone: PAL.frontHi, topLine: null, botLine: bot, rough: 0.02, ledgeShadow: 0 });
      }
      // end posts
      for (const ex of o.posts === false ? [] : [x0 - 0.15, x1 + 0.15]) {
        paintBlock(p, rng, { x0: ex - 0.24, x1: ex + 0.24, yTop: oy - h - 0.12, yBot: oy, d: d * 1.3, tone: PAL.front, cracks: 1, rough: 0.03 });
        paintBlock(p, rng, { x0: ex - 0.3, x1: ex + 0.3, yTop: oy - h - 0.3, yBot: oy - h - 0.1, d: d * 1.45, tone: PAL.frontHi, rough: 0.02 });
      }
    },
  };
}
const GEN = { pier: genPier, column: genColumn, arcade: genArcade, tower: genTower, island: genIsland, castle: genCastle, balustrade: genBalustrade, gothic: genGothic };

// value-noise tile for stone grain (built once)
let NT = null;
function noiseTile() {
  if (NT) return NT;
  const S = 256, a = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * 8, v = y / S * 8;
    // tileable by sampling a torus-like domain
    const base = (u, v) => noise2(u, v) * 0.6 + noise2(u * 2 + 5, v * 2 + 1) * 0.3 + noise2(u * 4 + 9, v * 4 + 3) * 0.15;
    const s = u / 8, t = v / 8; // blend 4 shifted copies -> seamless tile
    a[y * S + x] = base(u, v) * (1 - s) * (1 - t) + base(u - 8, v) * s * (1 - t) + base(u, v - 8) * (1 - s) * t + base(u - 8, v - 8) * s * t;
  }
  NT = { S, a };
  return NT;
}
function tileN(u, v) {
  const { S, a } = NT;
  const x = ((Math.floor(u) % S) + S) % S, y = ((Math.floor(v) % S) + S) % S;
  return a[y * S + x];
}

// pixel pass: grain, moon rims, facing rims (N), line-art outline, then crop to content
function finishSprite(p, o) {
  noiseTile();
  const { W, H, ppm } = p;
  const A = p.c.getImageData(0, 0, W, H), N = p.n.getImageData(0, 0, W, H);
  const a = A.data, n = N.data;
  const al = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) al[i] = a[i * 4 + 3];
  const ins = (x, y) => x >= 0 && y >= 0 && x < W && y < H && al[y * W + x] > 100;
  // exterior = transparent pixels connected to the border; other transparent pixels are holes (arch openings)
  const ext = new Uint8Array(W * H);
  {
    const st = new Int32Array(W * H); let sp = 0;
    const push = (i) => { if (!ext[i] && al[i] <= 100) { ext[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp) { const i = st[--sp], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W); }
  }
  // directional distance (px) to the nearest transparent pixel; sign bit = that pixel is a hole
  const r = Math.max(2, Math.round(0.07 * ppm)), rm = Math.max(1, Math.round(0.035 * ppm)), rm2 = Math.max(1, Math.round(0.015 * ppm));
  const dL = new Int16Array(W * H), dR = new Int16Array(W * H), dU = new Int16Array(W * H), dD = new Int16Array(W * H);
  const BIG = 32000;
  for (let y = 0; y < H; y++) {
    let d = 1, hole = 0;
    for (let x = 0; x < W; x++) { const i = y * W + x; if (al[i] <= 100) { d = 0; hole = ext[i] ? 0 : 1; } else d = Math.min(BIG, d + 1); dL[i] = hole ? -d : d; }
    d = 1; hole = 0;
    for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (al[i] <= 100) { d = 0; hole = ext[i] ? 0 : 1; } else d = Math.min(BIG, d + 1); dR[i] = hole ? -d : d; }
  }
  for (let x = 0; x < W; x++) {
    let d = 1, hole = 0;
    for (let y = 0; y < H; y++) { const i = y * W + x; if (al[i] <= 100) { d = 0; hole = ext[i] ? 0 : 1; } else d = Math.min(BIG, d + 1); dU[i] = hole ? -d : d; }
    d = 1; hole = 0;
    for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (al[i] <= 100) { d = 0; hole = ext[i] ? 0 : 1; } else d = Math.min(BIG, d + 1); dD[i] = hole ? -d : d; }
  }
  // energy-rim band: flat 255 inside a thin band (hard cel edge, no airbrushed gradient)
  const rimV = (dd) => { const a = Math.abs(dd); if (a > r) return -1; return dd < 0 ? 140 : 255; };
  const gs = 4.5 / ppm, gs2 = 17 / ppm;
  const outline = ppm >= 14;
  const lc = PAL.line, mc = PAL.moon;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  let seed = 1234567;
  // pits are spread into their right/down neighbours (2-px clusters): carry flags
  const pitCarry = new Uint8Array(W + 1);
  for (let y = 0; y < H; y++) {
    let carryR = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, j = i * 4;
      if (al[i] > 100) {
        // grain (world-scaled) + pixel noise, contrast-shaped
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const hn = (seed >>> 8) / 16777216 - 0.5;
        let g = 1 + 0.30 * tileN(x * gs * 16, y * gs * 16) + 0.18 * tileN(x * gs2 * 16 + 97, y * gs2 * 16 + 31) + hn * 0.22;
        g = Math.pow(Math.max(0.05, g), 1.4);
        // pits (dark specks, 2-px clusters) and lighter grit on the lit (left / top) faces
        const hs = (seed >>> 3) & 1023;
        // weathering mask: pitted zones vs cleaner stone (lit faces pit less)
        const wz = clamp(0.5 + 1.6 * tileN(x * gs * 3 + 51, y * gs * 3 + 17), 0, 1);
        const litF = n[j] > 100 || n[j + 2] > 170;
        const pit = hs < (litF ? 12 : 18) + 70 * wz;
        if (pit || carryR || pitCarry[x]) g *= litF ? 0.55 : 0.32;
        pitCarry[x] = pit && (seed & 1) ? 1 : 0;
        carryR = pit && (seed & 2) ? 1 : 0;
        if (hs > 1000 && litF) g *= 1.6;
        // edge wear: light chipped speckles within a few px of the silhouette
        const nearEdge = Math.abs(dL[i]) <= 3 || Math.abs(dU[i]) <= 3 || Math.abs(dR[i]) <= 3;
        if (hs > 900 && nearEdge) g *= 1.45;
        let R = a[j] * g, Gc = a[j + 1] * g, B = a[j + 2] * g;
        // moon rim: hairline highlights on top + left silhouette edges (weaker inside openings)
        const up = Math.abs(dU[i]) <= rm, lf = Math.abs(dL[i]) <= rm;
        if (up || lf) {
          const up2 = Math.abs(dU[i]) <= rm2, lf2 = Math.abs(dL[i]) <= rm2;
          let k = (up ? 0.3 : 0) + (lf ? 0.16 : 0) + (up2 ? 0.3 : 0) + (lf2 ? 0.16 : 0);
          k = Math.min(0.7, k);
          if ((up && dU[i] < 0) || (lf && dL[i] < 0)) k *= 0.45;
          R = lerp(R, mc[0], k); Gc = lerp(Gc, mc[1], k); B = lerp(B, mc[2], k);
        }
        a[j] = R; a[j + 1] = Gc; a[j + 2] = B;
        // graded facing rims for the energy lights
        const vl = rimV(dL[i]), vr = rimV(dR[i]), vu = rimV(dU[i]), vd = rimV(dD[i]);
        if (vl > 0) n[j] = Math.max(n[j], vl);
        if (vr > 0) n[j + 1] = Math.max(n[j + 1], vr);
        if (vu > 0 && (vd < 0 || vu >= vd)) n[j + 2] = 128 + (vu - 128) * 1.0; else if (vd > 0) n[j + 2] = 255 - vd;
        n[j + 3] = 255;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      } else if (outline) {
        const n4 = ins(x - 1, y) || ins(x + 1, y) || ins(x, y - 1) || ins(x, y + 1);
        if (n4 || (ppm > 12 && (ins(x - 1, y - 1) || ins(x + 1, y + 1) || ins(x + 1, y - 1) || ins(x - 1, y + 1) || ins(x + 2, y) || ins(x, y + 2)))) {
          const k = Math.min(1, (n4 ? 0.62 : 0.4) + ppm * 0.03);
          const aa = al[i] / 255;
          a[j] = lerp(lc[0], a[j], aa); a[j + 1] = lerp(lc[1], a[j + 1], aa); a[j + 2] = lerp(lc[2], a[j + 2], aa);
          a[j + 3] = Math.max(al[i], 255 * k);
          n[j] = 0; n[j + 1] = 0; n[j + 2] = 128; n[j + 3] = a[j + 3];
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
  }
  p.c.putImageData(A, 0, 0); p.n.putImageData(N, 0, 0);
  if (maxX < 0) return null;
  minX = Math.max(0, minX - 2); minY = Math.max(0, minY - 2); maxX = Math.min(W - 1, maxX + 2); maxY = Math.min(H - 1, maxY + 2);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const ca = makeCanvas(cw, ch), cn = makeCanvas(cw, ch);
  ca.getContext('2d').drawImage(p.cc, -minX, -minY);
  cn.getContext('2d').drawImage(p.nc, -minX, -minY);
  p.cc.width = p.cc.height = 1; p.nc.width = p.nc.height = 1;
  return { alb: ca, nrm: cn, w: cw, h: ch, ax: p.ox - minX, ay: p.oy - minY, ppm };
}

function buildSprite(inst, quality) {
  const rng = new RNG(inst.seed);
  const gen = GEN[inst.kind](rng, inst.o);
  const dz = Math.max(8, inst.z - REF_CAM.z);
  // oblique view factors from the reference camera (sees right side of left objects, etc.)
  const bbMidY = (gen.bb.y0 + gen.bb.y1) * 0.5;
  // oblique side factor from the (yawed) facing: seen from the reference camera, the local view angle
  // is the bearing of the object plus its yaw (yaw > 0 = right end recedes = we see the left end face)
  const yaw = inst.yaw || 0;
  const kLim = 0.55 + 0.4 * clamp(Math.abs(yaw) / 0.6, 0, 1);
  const kx = clamp(-Math.tan(Math.atan2(inst.x - REF_CAM.x, dz) + yaw), -kLim, kLim);
  const ky = clamp(-(inst.y + bbMidY * 0.6 - REF_CAM.y) / dz, -0.45, 0.45);
  const ppm = clamp(1.3 * REF_CAM.f / dz, 2.2, 44) * quality * (inst.ppmK || 1);
  const p = new Painter(gen.bb, ppm, kx, ky, 6);
  gen.paint(p, 0, 0);
  const sp = finishSprite(p, inst);
  if (sp) { sp.kx = kx; sp.ky = ky; }
  return sp;
}

/**
 * buildRuins(seed, opts) -> world
 *  opts.quality (1)   sprite resolution multiplier
 *  opts.layout        custom instance list [{kind:'pier'|'column'|'arcade'|'tower'|'gothic'|'island'|'castle'|'balustrade', x,y,z, o:{...}, id?, rot?, yaw?, floatAmp?, fogK?, ppmK?, rooted?}]
 *                     yaw (rad): turns the piece about the vertical axis (yaw > 0: its right end recedes); rooted: base dissolves into the cloud sea
 *                     (x,y,z = base-centre of the structure; y down, cloud sea ~ +22). Default layout ids: 'hero' (fluted column x=22,z=42,
 *                     49 m tall, the one to cut), 'castle' (x=6,z=345). world.items = [{id,kind,x,y,z,...}] sorted far->near.
 *  opts.extra         extra instances appended to the default layout
 *  opts.fragments     extra floating 3D column / pier fragments [{x,y,z,len,r,square?,spin?,bob?,tilt?,tone?}] (the default layout adds ~60;
 *                     they tumble slowly, are drawn by drawRuins in the same depth slice, need debris.js imported somewhere)
 *  opts.spriteFragments  true = old 2.5D sprite fragments instead of the 3D meshes
 */
export function buildRuins(seed = 1, opts = {}) {
  const rng = new RNG(seed);
  const quality = opts.quality ?? 1;
  const layout = opts.layout || defaultLayout(rng, opts);
  if (opts.extra) layout.push(...opts.extra);
  const items = [];
  let id = 0, px = 0;
  for (const L of layout) {
    const inst = { ...L, seed: (seed * 7919 + (id++) * 104729) >>> 0 };
    const sp = buildSprite(inst, quality);
    if (!sp) continue;
    px += sp.w * sp.h;
    // rooted = stands in the cloud sea: its base dissolves into the clouds (baseY); floating pieces keep their base
    const rooted = L.rooted ?? (!L.floatAmp && !L.o?.floating && L.kind !== 'island' && L.kind !== 'castle' && L.kind !== 'balustrade' && L.y > 8);
    items.push({ id: L.id || `${L.kind}${id}`, kind: L.kind, x: L.x, y: L.y, z: L.z, rot: L.rot || 0, yaw: L.yaw || 0, floatAmp: L.floatAmp || 0, fogK: L.fogK, phase: (id * 0.618) % 1, baseY: rooted ? L.y : null, num: id, sp });
  }
  items.sort((a, b) => b.z - a.z);
  // 3D fragments (built lazily at the first draw through the debris hook, so the import order does not matter)
  const frags = (layout.frags || []).concat(opts.fragments || []);
  return { items, seed, pixels: px, tex: null, fragSpec: frags, fragField: null };
}

// =====================================================================================
// GL sprite renderer
// =====================================================================================
// Sprites are real planar quads in 3D (anchor + roll + yaw): corners carry their view depth so the
// texture mapping is perspective-correct and the quads write the shared z-buffer (alpha-tested).
const VS_SPRITE = `#version 300 es
uniform vec3 uQ[4];
uniform vec2 uRes;
out vec2 vUv;
${GLSL_DEPTH}
void main(){
  int i = gl_VertexID;
  vUv = vec2(float(i & 1), float(i >> 1));
  vec3 q = uQ[i];
  float w = max(q.z, ZN * 1.01);
  gl_Position = vec4((q.x / uRes.x * 2.0 - 1.0) * w, (1.0 - q.y / uRes.y * 2.0) * w, clipZ(w), w);
}`;
const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uAlb, uNrm;
uniform vec3 uOrigin, uAxU, uAxV;  // world position of uv (0,0) and per-uv axes (metres, 3D)
uniform vec2 uSizeM;               // sprite size in metres (for the cut line)
uniform vec3 uCam;
uniform vec4 uLA, uLB; uniform vec3 uLAC, uLBC;
uniform float uFogD, uFogOn; uniform vec3 uFogC; uniform float uFogFixed;
uniform vec3 uHaze; uniform float uCloudTop, uHazeOn, uBaseY;
uniform float uMode, uFill, uFillR, uRim, uRimDist, uEmitK, uAlpha, uLift, uFogK;
uniform vec4 uSplit; // x: midpoint x, y: half width (m), z: strength 0..1
uniform vec4 uCut; uniform float uCutSide, uCutGlow, uCutW, uCutFace, uCutFaceW; uniform vec3 uCutCol;
${GLSL_COMMON}
float lightTerm(vec4 L, vec3 P, float wl, float wr, float wu, float wd, float wf, out float rimF, out float att, out float attF){
  vec3 d = L.xyz - P; float dist = length(d); vec3 dl = d / max(dist, 1e-3);
  // rims carry far (L.w), but fade out completely beyond uRimDist; the fill light is short-range (uFillR)
  att = (1.0 / (1.0 + dist * dist / (L.w * L.w))) * (1.0 - smoothstep(uRimDist * 0.55, uRimDist, dist));
  attF = 1.0 / (1.0 + dist * dist / (uFillR * uFillR));
  float side = wl * max(-dl.x, 0.0) + wr * max(dl.x, 0.0) + wu * max(-dl.y, 0.0) + wd * max(dl.y, 0.0);
  float fr = wf * (0.25 + 0.75 * max(-dl.z, 0.0));
  float sw = max(max(wl, wr), max(wu, wd));
  rimF = smoothstep(0.12, 0.5, side / max(sw, 1e-3)) * step(0.01, sw);
  return fr * 0.55 + side * 1.1;
}
void main(){
  vec4 a = texture(uAlb, vUv);
  if(a.a < 0.003) discard;
  vec2 lm = vUv * uSizeM;
  float cutD = 1e3, cutOn = 0.0;
  if(uCutSide != 0.0){
    float s = dot(lm - uCut.xy, uCut.zw);
    if(s * uCutSide < 0.0) discard;
    cutD = abs(s); cutOn = 1.0;
  }
  vec3 P = uOrigin + uAxU * vUv.x + uAxV * vUv.y;
  // cloud-rooted pieces: billowy dissolve of the bottom ~9 m + haze over the bottom 14 m
  float baseK = 1.0, hb = 0.0;
  if(uBaseY < 1e4 && uHazeOn > 0.5){
    float nb = P.y + 2.5 * (fbmN(vec2(P.x + P.z * 0.7, P.y * 1.7) * 0.13) * 2.0 - 1.0);
    baseK = 1.0 - smoothstep(uBaseY - 9.0, uBaseY - 1.0, nb);
    hb = smoothstep(uBaseY - 14.0, uBaseY - 1.0, P.y);
  }
  float alpha = a.a * uAlpha * baseK * (1.0 - smoothstep(uCloudTop - 3.0, uCloudTop + 4.0, P.y) * uHazeOn);
  if(uMode > 1.5){ if(alpha < 0.5) discard; o = vec4(0.0); return; }  // depth pass
  vec3 alb = toLin(a.rgb / a.a);
  vec4 nn = texture(uNrm, vUv);
  vec3 nc = nn.rgb / max(nn.a, 1e-3);
  float wl = nc.r, wr = nc.g, vv = nc.b * 2.0 - 1.0;
  float wu = max(vv * 1.3 - 0.3, 0.0), wd = max(-vv * 1.3 - 0.3, 0.0);
  wl = max(wl * 1.4 - 0.4, 0.0); wr = max(wr * 1.4 - 0.4, 0.0);
  float wf = clamp(1.0 - max(max(wl, wr), max(wu, wd)), 0.0, 1.0);
  float rimM = smoothstep(0.85, 1.0, max(max(nc.r, nc.g), abs(vv)));   // only the thin flat rim band
  vec3 col = alb * (1.0 + uLift);
  vec3 em = vec3(0.0);
  float rf, at, atF;
  // stylised colour split: light A owns the left side of the world, light B the right
  float sx = smoothstep(-uSplit.y, uSplit.y, P.x - uSplit.x);
  float kA = mix(1.0, 1.0 - sx, uSplit.z), kB = mix(1.0, sx, uSplit.z);
  if(uLA.w > 0.0){ float t = lightTerm(uLA, P, wl, wr, wu, wd, wf, rf, at, atF); col += alb * 2.5 * uLAC * atF * kA * t * uFill; em += uLAC * at * kA * rf * rimM; }
  if(uLB.w > 0.0){ float t = lightTerm(uLB, P, wl, wr, wu, wd, wf, rf, at, atF); col += alb * 2.5 * uLBC * atF * kB * t * uFill; em += uLBC * at * kB * rf * rimM; }
  col += em * uRim;
  // aerial perspective: fog toward the sky colour along this view ray, haze near the cloud sea
  vec3 V = P - uCam; float dist = length(V); vec3 rd = V / dist;
  vec3 fc = uFogFixed > 0.5 ? uFogC : fogSky(rd);
  float f = fogAmt(dist, uFogD * uFogK) * uFogOn;
  float hz = smoothstep(uCloudTop - 10.0, uCloudTop + 1.0, P.y) * uHazeOn * mix(0.35, 1.0, smoothstep(30.0, 180.0, dist));
  hz = max(hz, hb * 0.85);
  fc = mix(fc, uHaze, hz * 0.7);
  f = max(f, hz * 0.8);
  col = mix(col, fc, f);
  em *= (1.0 - f);
  // fresh cut: polished cut-face band + hot seam (white core, coloured falloff wider in the emit layer)
  float face = cutOn * uCutFace * smoothstep(uCutFaceW, uCutFaceW * 0.15, cutD);
  // polished stone (not a light tube): light grey, darker toward the far side of the band
  col = mix(col, vec3(0.16, 0.18, 0.25) * (1.25 - 0.5 * clamp(cutD / max(uCutFaceW, 1e-3), 0.0, 1.0)), face * 0.85 * (1.0 - f * 0.7));
  float cw = uCutW * (uMode > 0.5 ? 2.0 : 1.0);
  float halo = cutOn * exp(-cutD / max(cw, 1e-4));
  float core = cutOn * exp(-cutD / max(uCutW * 0.33, 1e-4));
  vec3 cutEm = (uCutCol * halo + vec3(1.0) * core * 0.9) * uCutGlow;
  col += uCutCol * halo * uCutGlow * 0.6;
  if(uMode < 0.5) o = vec4(toSrgb(col) * alpha, alpha);
  else o = vec4(toSrgb(em * uEmitK + cutEm) * alpha, alpha);
}`;

function ensureTextures(G, world) {
  if (world.texG === G && world.items.every((it) => it.tA)) return;
  for (const it of world.items) {
    if (it.tA) continue;
    it.tA = glTexture(G, it.sp.alb, { mips: true, aniso: 8 });
    it.tN = glTexture(G, it.sp.nrm, { mips: true, aniso: 8 });
    // free CPU canvases
    it.sp.alb.width = it.sp.alb.height = 1; it.sp.nrm.width = it.sp.nrm.height = 1;
  }
  world.texG = G;
}

/**
 * drawRuins(S, world, opts)
 *  zMin, zMax         depth slice (world z of each piece's anchor) to draw
 *  lightA, lightB     {x,y,z,color,k,range} energy lights; default: derived from S.env.lightA/AC & lightB/BC; null = off
 *  fog [r,g,b]        fixed fog colour (default: sky-matched gradient from S.env)
 *  fogDensity         default 0.0022 (curve 1-exp(-(d*k)^1.35), shared by ruins, rocks and floor: near/mid stay dark, far goes pale)
 *  haze               height haze + base dissolve into the cloud sea (default true)
 *  fill (1) fillRange (11 m)   energy fill light on faces turned to a light (short range: only pieces near the fighters get coloured)
 *  rim (0.55) emit (0.6) rimDist (40 m)   scene rim / emissive rim strength; pieces further than rimDist from a light get no rim
 *  split (0.85), splitWidth (22 m)    stylised colour split: light A owns the world left of the lights' midpoint, B the right
 *  alpha (1), lift (0)                global opacity / albedo lift
 *  t                  time for gentle bobbing of floating fragments (default S.t)
 *  occludeEmit        erase S.L.emit behind ruins (default true; pass false for the first/farthest layer = faster)
 *  hide               array of ids not to draw
 *  cut (pillar mode)  {id='hero', t 0..1 slide progress, angle=-0.35 rad, at=0.32 (fraction of sprite height from its top), glow 0..2,
 *                      glowFloor=0.6 (seam stays hot while the slide starts), width=0.18 m, faceWidth=0.6 m, slide=6 m (downhill along the cut),
 *                      open=0.6 m (top piece lifts off the line), drop=2.5 m (k^2 fall), spin=0.18 rad, color=[200,240,255], dir=1}
 *  cut (world mode)   {screen:{x0,y0,x1,y1} px, t, slide, open, drop, glow, glowFloor, widthPx=3, spin, dir}: slices EVERY ruin the
 *                      screen line crosses; upper pieces slide along x0->x1 (per-piece variation), lift off and drop.
 *  fragments (true)   draw the floating 3D column fragments of this slice (they take burst / dof / focus / lightA / lightB too)
 *  A cut with t = 0 and glow = 0 draws nothing special (safe to pass all shot long).
 *  Depth: ruins write the shared per-frame z-buffer, so rocks / dust drawn before or after are occluded correctly.
 */
export function drawRuins(S, world, opts = {}) {
  const { zMin = -Infinity, zMax = Infinity } = opts;
  const cam = S.cam;
  const G = worldGL(S.W, S.H);
  const gl = G.gl;
  ensureTextures(G, world);
  const prog = glProgram(G, 'ruins', VS_SPRITE, FS_SPRITE);
  const env = S.env;
  const LA = resolveLight(opts.lightA, env.lightA, env.lightAC);
  const LB = resolveLight(opts.lightB, env.lightB, env.lightBC);
  const t = opts.t ?? S.t;
  const cut = opts.cut || null;
  const hide = opts.hide || [];
  const kCut = cut ? clamp(cut.t ?? 0, 0, 1) : 0;
  let cutGlow = cut ? (cut.glow ?? 0) : 0;
  if (cut && kCut > 0) cutGlow = Math.max(cutGlow, (cut.glowFloor ?? 0.6) * (1 - smoothstep(0.1, 0.3, kCut)));
  const cutActive = !!cut && (kCut > 0 || cutGlow > 0.005);
  // collect visible quads
  const list = [];
  for (const it of world.items) {
    if (it.z < zMin || it.z >= zMax || hide.includes(it.id)) continue;
    if (it.z - cam.z < 1) continue;
    const sp = it.sp;
    const bob = it.floatAmp ? Math.sin(t * 0.6 + it.phase * TAU) * it.floatAmp : 0;
    const rot = it.rot + (it.floatAmp ? Math.sin(t * 0.25 + it.phase * 9) * 0.02 : 0);
    const q0 = quadFor(cam, it, sp, rot, bob, 0, 0, 0);
    if (!q0) continue;
    let cl = null;
    if (cutActive && cut.screen) cl = screenCutLine(cam, q0, sp, cut);
    else if (cutActive && it.id === (cut.id || 'hero')) {
      const ang = cut.angle ?? -0.35, dn = Math.sin(ang) >= 0 ? 1 : -1; // slide downhill along the cut
      cl = { px: sp.ax / sp.ppm, py: (sp.ay / sp.ppm) * (cut.at ?? 0.32), nx: -Math.sin(ang), ny: Math.cos(ang), w: cut.width ?? 0.18, fw: cut.faceWidth ?? 0.6,
        dx: Math.cos(ang + rot) * dn * (cut.dir ?? 1), dy: Math.sin(ang + rot) * dn * (cut.dir ?? 1) };
    }
    if (!cl) { list.push({ it, sp, q: q0, side: 0 }); continue; }
    list.push({ it, sp, q: q0, side: -1, cl });
    // upper piece: slides along the cut, lifts off it (open gap), drops and spins; varied per piece for world cuts
    const h = hash1(it.num * 13.37 + 1.1);
    const vary = cut.screen ? 0.6 + 0.8 * h : 1;
    const slide = (cut.slide ?? 6) * kCut * vary;
    const open = (cut.open ?? 0.6) * kCut * vary;
    const drop = (cut.drop ?? 2.5) * kCut * kCut * vary;
    const cr = Math.cos(rot), sr = Math.sin(rot), cy = Math.cos(it.yaw || 0), sy = Math.sin(it.yaw || 0);
    const wnx = cl.nx * cr - cl.ny * sr, wny = cl.nx * sr + cl.ny * cr; // cut normal (towards the kept lower piece), world
    const ox = -wnx * open, oy = -wny * open;
    let sx = cl.dx * slide, sz = 0;
    if (!cut.screen) { sz = sx * sy; sx *= cy; }
    const spin = (cut.spin ?? 0.18) * kCut * kCut * (cut.screen ? (0.4 + 1.2 * h) * (h < 0.3 ? -1 : 1) : 1);
    const q1 = quadFor(cam, it, sp, rot + spin, bob, sx + ox * cy, cl.dy * slide + oy + drop, sz + ox * sy);
    if (q1) list.push({ it, sp, q: q1, side: 1, cl });
  }
  if (!list.length) { drawFragments(S, world, opts); return; }
  glFrame(G, S);
  glUse(G, prog);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  glSet(G, 'uRes', [G.W, G.H]);
  glSet(G, 'uCam', [cam.x, cam.y, cam.z]);
  envSkyUniforms(G, env);
  const fogFixed = !!opts.fog;
  glSet(G, 'uFogFixed', fogFixed ? 1 : 0);
  glSet(G, 'uFogC', fogFixed ? lin3(opts.fog) : [0, 0, 0]);
  glSet(G, 'uFogD', opts.fogDensity ?? FOG_DENSITY);
  const LAx = LA ? LA.x : -4, LBx = LB ? LB.x : 4;
  glSet(G, 'uSplit', [(LAx + LBx) * 0.5, opts.splitWidth ?? 22, opts.split ?? 0.85, 0]);
  glSet(G, 'uFogOn', 1);
  const cloudTop = (env.cloudY ?? 30) - (env.cloudAmp ?? 12) * 0.55;
  glSet(G, 'uCloudTop', cloudTop);
  glSet(G, 'uHaze', env.cloudLit.map((v, i) => lerp(v, env.skyHor[i], 0.4)));
  const hazeOn = opts.haze === false ? 0 : 1;
  glSet(G, 'uHazeOn', hazeOn);
  glSet(G, 'uLA', LA ? [LA.x, LA.y, LA.z, LA.range] : [0, 0, 0, 0]); glSet(G, 'uLAC', LA ? LA.col : [0, 0, 0]);
  glSet(G, 'uLB', LB ? [LB.x, LB.y, LB.z, LB.range] : [0, 0, 0, 0]); glSet(G, 'uLBC', LB ? LB.col : [0, 0, 0]);
  const emitK = opts.emit ?? 0.6;
  glSet(G, 'uFill', opts.fill ?? 1.0); glSet(G, 'uFillR', opts.fillRange ?? 11); glSet(G, 'uRim', opts.rim ?? 0.55);
  glSet(G, 'uRimDist', opts.rimDist ?? 40); glSet(G, 'uEmitK', emitK);
  glSet(G, 'uAlpha', opts.alpha ?? 1); glSet(G, 'uLift', opts.lift ?? 0);
  const cutCol = lin3(cut?.color || [200, 240, 255]);
  const cutFace = cut ? smoothstep(0, 0.03, kCut) : 0;
  const drawAll = (mode) => {
    glSet(G, 'uMode', mode);
    for (const e of list) {
      const { it, sp, q, side } = e;
      glTex(G, 'uAlb', 0, it.tA); glTex(G, 'uNrm', 1, it.tN);
      gl.uniform3fv(prog.u.uQ, q.screen);
      glSet(G, 'uOrigin', q.origin); glSet(G, 'uAxU', q.axU); glSet(G, 'uAxV', q.axV);
      glSet(G, 'uSizeM', [sp.w / sp.ppm, sp.h / sp.ppm]);
      glSet(G, 'uFogK', it.fogK ?? 1);
      glSet(G, 'uBaseY', it.baseY != null ? it.baseY : 1e5);
      if (side !== 0) {
        // cut line in sprite metres (point + unit normal pointing to the kept "lower" side)
        const cl = e.cl;
        glSet(G, 'uCut', [cl.px, cl.py, cl.nx, cl.ny]);
        glSet(G, 'uCutSide', side < 0 ? 1 : -1);
        glSet(G, 'uCutGlow', cutGlow); glSet(G, 'uCutW', cl.w); glSet(G, 'uCutCol', cutCol);
        glSet(G, 'uCutFace', cutFace); glSet(G, 'uCutFaceW', cl.fw);
      } else { glSet(G, 'uCutSide', 0); glSet(G, 'uCutGlow', 0); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
  drawAll(0);
  // alpha-tested depth so rocks / dust / later pieces are occluded by these ruins
  gl.disable(gl.BLEND); gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.LESS);
  drawAll(2);
  gl.colorMask(true, true, true, true);
  glBlit(G, S.L.scene);
  if (opts.occludeEmit !== false) glBlit(G, S.L.emit, 'destination-out');
  if (emitK > 0 || cutGlow > 0) {
    glBegin(G, { clearDepth: false });
    glUse(G, prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    drawAll(1);
    glBlit(G, S.L.emit, 'lighter');
  }
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
  drawFragments(S, world, opts);
}
function drawFragments(S, world, opts) {
  if (opts.fragments === false || !world.fragSpec || !world.fragSpec.length || !HOOK.drawDebris) return;
  if (!world.fragField && HOOK.makeFragments) world.fragField = HOOK.makeFragments((world.seed * 31 + 7) >>> 0, world.fragSpec);
  if (!world.fragField) return;
  const { cut, hide, ruins, debris, fill, rim, ...o } = opts;
  HOOK.drawDebris(S, world.fragField, { ...o, dust: false, grit: false, emit: (opts.emit ?? 0.6) > 0 ? 0.6 : 0, dof: opts.dof ?? 1 });
}

// Late-bound hooks (debris.js registers itself here; avoids an import cycle ruins <-> debris)
const HOOK = {};
export function _registerWorldHook(name, fn) { HOOK[name] = fn; }

/**
 * drawWorld(S, world, fields = [], opts) — ruins + any number of debris fields in one call, depth-correct.
 *  fields: [field | {field, opts}] from makeDebris (requires debris.js to be imported somewhere).
 *  opts: options shared by drawRuins and drawDebris (zMin, zMax, lightA, lightB, burst, fogDensity, t, ...);
 *  opts.ruins / opts.debris: extra options for one side only (e.g. {ruins:{cut}, debris:{dof:0}}).
 *  Ruins, floor, rocks, grit and dust share one z-buffer per frame, so any interleaving with drawStage is safe;
 *  call it once for the far world (before the stage / characters) and once with zMax for foreground pieces.
 */
export function drawWorld(S, world, fields = [], opts = {}) {
  const { ruins: ro = {}, debris: dro = {}, ...shared } = opts;
  if (world) drawRuins(S, world, { ...shared, ...ro });
  const dd = HOOK.drawDebris;
  if (!dd) return;
  for (const f of fields) {
    if (!f) continue;
    const fld = f.rocks ? f : f.field;
    if (!fld) continue;
    dd(S, fld, { ...shared, ...dro, ...(f.rocks ? {} : f.opts || {}) });
  }
}

const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
// a screen-space line {x0,y0,x1,y1} (px) -> cut line in this sprite's local metres, or null if it misses the sprite
function screenCutLine(cam, q, sp, cut) {
  const L = cut.screen, s = q.screen;
  const ex = L.x1 - L.x0, ey = L.y1 - L.y0, el = Math.hypot(ex, ey) || 1;
  // corners on both sides of the line?
  let pos = 0, neg = 0;
  for (let i = 0; i < 4; i++) { const d = (s[i * 3] - L.x0) * ey - (s[i * 3 + 1] - L.y0) * ex; if (d > 0) pos++; else neg++; }
  if (!pos || !neg) return null;
  // screen px -> sprite metres: intersect the view ray with the sprite's plane (exact for yawed quads)
  const O = q.origin, U = q.axU, V = q.axV;
  const Wm = sp.w / sp.ppm, Hm = sp.h / sp.ppm;
  const toM = (X, Y) => {
    const p1 = cam.unproject(X, Y, cam.z + 1);
    const nd = [-(p1.x - cam.x), -(p1.y - cam.y), -1];
    const r = [cam.x - O[0], cam.y - O[1], cam.z - O[2]];
    const det = det3(U, V, nd);
    if (Math.abs(det) < 1e-9) return null;
    return { x: (det3(r, V, nd) / det) * Wm, y: (det3(U, r, nd) / det) * Hm };
  };
  const A = toM(L.x0, L.y0), B = toM(L.x1, L.y1);
  if (!A || !B) return null;
  let dx = B.x - A.x, dy = B.y - A.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  let nx = -dy, ny = dx;
  if (ny < 0) { nx = -nx; ny = -ny; } // normal points "down" (kept side = below the line)
  const pxPerM = Math.hypot(s[3] - s[0], s[4] - s[1]) / Wm;
  // world slide direction: along the screen line, un-rolled into the image plane
  const r = -cam.rollTotal, wx = (ex / el) * Math.cos(r) - (ey / el) * Math.sin(r), wy = (ex / el) * Math.sin(r) + (ey / el) * Math.cos(r);
  const dir = cut.dir ?? 1;
  const w = (cut.widthPx ?? 3) / pxPerM;
  return { px: A.x, py: A.y, nx, ny, w, fw: Math.max(cut.faceWidth ?? 0.6, w * 2.5), dx: wx * dir, dy: wy * dir };
}

// world quad of a sprite: anchor (base centre) + roll (rot, in the sprite plane) + yaw (about the vertical axis)
function quadFor(cam, it, sp, rot, bob, ox, oy, oz = 0) {
  const ppm = sp.ppm;
  // local metres of the sprite corners relative to the anchor (anchor = local origin)
  const lx0 = -sp.ax / ppm, ly0 = -sp.ay / ppm, lx1 = lx0 + sp.w / ppm, ly1 = ly0 + sp.h / ppm;
  const c = Math.cos(rot), s = Math.sin(rot);
  const yaw = it.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ax = it.x + ox, ay = it.y + bob + oy, az = it.z + oz;
  const W = (lx, ly) => { const X = lx * c - ly * s; return { x: ax + X * cy, y: ay + lx * s + ly * c, z: az + X * sy }; };
  const P = [W(lx0, ly0), W(lx1, ly0), W(lx0, ly1), W(lx1, ly1)];
  const scr = new Float32Array(12);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let i = 0; i < 4; i++) {
    const pr = cam.project(P[i].x, P[i].y, P[i].z);
    if (!pr) return null;
    scr[i * 3] = pr.x; scr[i * 3 + 1] = pr.y; scr[i * 3 + 2] = pr.z;
    minx = Math.min(minx, pr.x); maxx = Math.max(maxx, pr.x); miny = Math.min(miny, pr.y); maxy = Math.max(maxy, pr.y);
  }
  if (maxx < -50 || minx > cam.W + 50 || maxy < -50 || miny > cam.H + 50) return null;
  if (maxx - minx < 0.6 && maxy - miny < 0.6) return null;
  return {
    screen: scr, origin: [P[0].x, P[0].y, P[0].z],
    axU: [P[1].x - P[0].x, P[1].y - P[0].y, P[1].z - P[0].z], axV: [P[2].x - P[0].x, P[2].y - P[0].y, P[2].z - P[0].z],
  };
}

// helper for composing shots: world item lookup and screen position
export function ruinItem(world, id) { return world.items.find((it) => it.id === id) || null; }
