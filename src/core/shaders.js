// GLSL for the compositor. The "env" part (sky, nebula, stars, ray-marched cloud sea) lives
// in the same pass as the layer composite so everything lands in one HDR accumulation buffer.

export const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for(int i = 0; i < 6; i++){ s += a * vnoise(p); p = m * p; a *= 0.5; } return s; }
float fbm3o(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for(int i = 0; i < 3; i++){ s += a * vnoise(p); p = m * p; a *= 0.5; } return s / 0.875; }
vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
`;

export const COMP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCam;
uniform float uFocal;
uniform vec2 uPP;
uniform vec3 uShake;          // shakeX, shakeY, total roll
uniform float uSkyYaw, uSkyPitch;
uniform vec3 uSkyTop, uSkyMid, uSkyHor, uHorGlow;
uniform float uNebula, uStars, uGalaxy, uPlanet, uSkyGain;
uniform float uCloudOn, uCloudY, uCloudAmp, uCloudScale, uSteps;
uniform vec3 uCloudLit, uCloudShade, uCloudDeep, uCloudRim;
uniform vec3 uMoonDir;
uniform vec4 uLightA; uniform vec3 uLightAC;
uniform vec4 uLightB; uniform vec3 uLightBC;
uniform vec4 uSplit; uniform float uSplitW; uniform vec3 uSplitGlow;
uniform float uFog, uCloudDrift;
uniform sampler2D uBack, uScene, uEmit;
uniform float uBackGain, uEmitGain, uWeight, uEnvGain, uSceneGain;

// ---------- cloud height field: cauliflower cumulus from stacked worley domes ----------
float worley(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + hash22(i + g) * 0.85 + 0.075 - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
float dome(vec2 p){ float d = worley(p); return sqrt(max(0.0, 1.0 - d * d * 1.25)); }
float splitMask(vec2 xz){
  if(uSplit.w <= 0.0) return 0.0;
  vec2 dir = vec2(cos(uSplit.z), sin(uSplit.z));
  vec2 rel = xz - uSplit.xy;
  float dl = abs(rel.x * dir.y - rel.y * dir.x);
  return uSplit.w * (1.0 - smoothstep(0.0, uSplitW, dl));
}
float cloudH(vec2 xz){
  vec2 q = xz * uCloudScale + vec2(uCloudDrift, 0.0);
  float region = fbm3o(q * 0.16 + 7.3);
  float big = dome(q);
  float h = 0.68 * pow(big, 0.75) + big * (0.24 * dome(q * 2.37 + 5.3) + 0.11 * dome(q * 5.1 - 2.1)) + 0.02 * dome(q * 11.3 + 1.3);
  h = h * mix(0.62, 1.15, smoothstep(0.25, 0.7, region));
  h = clamp(h, 0.0, 1.0);
  h *= 1.0 - splitMask(xz);
  return h * uCloudAmp;
}

vec3 skyColor(vec3 rd, float pxAng){
  float el = asin(clamp(-rd.y, -1.0, 1.0)) + uSkyPitch;
  float az = atan(rd.x, rd.z) + uSkyYaw;
  vec3 col = mix(uSkyHor, uSkyMid, smoothstep(-0.02, 0.22, el));
  col = mix(col, uSkyTop, smoothstep(0.18, 0.75, el));
  // nebula band
  vec2 sp = vec2(az, el) * 3.0;
  vec2 w = sp + 0.7 * vec2(fbm(sp * 1.1 + 3.1), fbm(sp * 1.1 - 1.7));
  float n = fbm(w * 1.5);
  float band = exp(-pow(sp.y * 0.95 - sp.x * 0.42 - 0.95, 2.0) * 0.9);
  float n2 = fbm(w * 3.7 + 9.0);
  vec3 nebC = mix(vec3(0.08, 0.22, 0.95), vec3(0.32, 0.17, 0.9), smoothstep(0.35, 0.75, n));
  nebC = mix(nebC, vec3(1.0, 0.25, 0.55), smoothstep(0.62, 0.85, n2) * 0.7);
  float neb = smoothstep(0.4, 0.86, n) * band;
  float dust = smoothstep(0.5, 0.75, fbm(w * 4.3 - 2.0)) * band;
  col += nebC * neb * 0.42 * uNebula * smoothstep(0.0, 0.25, el);
  col *= 1.0 - dust * 0.45 * uNebula * smoothstep(0.0, 0.2, el);
  // bright core streak of the galactic band
  col += vec3(0.75, 0.7, 1.0) * pow(band, 6.0) * smoothstep(0.45, 0.75, n) * 0.35 * uNebula * smoothstep(0.05, 0.3, el);
  // stars: three layers, size locked to pixel footprint
  float starAcc = 0.0; vec3 starCol = vec3(0.0);
  for(int L = 0; L < 3; L++){
    float sc = 9.0 + float(L) * 9.0;
    vec2 g = sp * sc;
    vec2 cell = floor(g), f = fract(g);
    vec2 hp = hash22(cell + float(L) * 17.0);
    float hb = hash12(cell * 1.7 + float(L) * 3.1);
    float bright = pow(hb, 6.0 + float(L) * 5.0) * (1.0 - float(L) * 0.25);
    vec2 d = (f - hp) / (sc * pxAng * 3.0);   // in pixels
    float r2 = dot(d, d);
    float s = exp(-r2 * 1.6) * bright * (1.2 + band * 1.5);
    // diffraction spikes on the brightest
    float spike = bright > 0.35 ? (exp(-abs(d.x) * 0.6) * exp(-d.y * d.y * 2.0) + exp(-abs(d.y) * 0.6) * exp(-d.x * d.x * 2.0)) * 0.35 * bright : 0.0;
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + hb * 7.0) + hb * 40.0);
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.8, 0.9), hash12(cell + 9.0));
    starCol += tint * (s + spike) * tw;
  }
  col += starCol * 1.6 * uStars * smoothstep(-0.02, 0.12, el);
  // spiral galaxy
  vec2 gp = (sp - vec2(1.35, 1.25)) * mat2(0.85, -0.53, 0.53, 0.85);
  gp.y *= 2.3;
  float gr = length(gp), gth = atan(gp.y, gp.x);
  float arms = pow(0.5 + 0.5 * cos(2.0 * (gth - log(gr + 1e-3) * 2.6)), 2.0);
  float gal = exp(-gr * 9.0) * (0.35 + 0.9 * arms) + exp(-gr * 40.0) * 1.5;
  col += mix(vec3(0.6, 0.45, 1.0), vec3(1.0, 0.85, 0.95), exp(-gr * 25.0)) * gal * 0.9 * uGalaxy;
  // planet with lit crescent
  vec2 pp = sp - vec2(2.2, 1.0);
  float pr = 0.16;
  float pd = length(pp);
  if(uPlanet > 0.0){
    float disc = 1.0 - smoothstep(pr - pxAng * 9.0, pr, pd);
    vec2 ld = normalize(vec2(-0.7, 0.5));
    float lit = smoothstep(0.0, 0.06, dot(pp / pr, ld) - (1.0 - sqrt(max(0.0, 1.0 - dot(pp / pr, pp / pr)))) * 0.2 - 0.55);
    vec3 pc = mix(vec3(0.03, 0.03, 0.08), vec3(0.85, 0.75, 1.0), lit);
    col = mix(col, pc, disc * uPlanet);
    col += vec3(0.5, 0.45, 1.0) * exp(-max(pd - pr, 0.0) * 60.0) * 0.25 * uPlanet * (1.0 - disc);
  }
  // horizon glow, strongest toward the centre of the view
  col += uHorGlow * exp(-max(el, 0.0) * 18.0) * (0.55 + 0.45 * exp(-az * az * 1.5));
  return col * uSkyGain;
}

vec3 rayDir(vec2 px){
  vec2 q = px - uPP - uShake.xy;
  float r = -uShake.z; float c = cos(r), s = sin(r);
  vec2 u = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  return normalize(vec3(u / uFocal, 1.0));
}

vec3 env(vec2 px){
  vec3 rd = rayDir(px);
  float pxAng = 1.0 / uFocal;
  vec3 sky = skyColor(rd, pxAng);
  if(uCloudOn <= 0.0 || rd.y <= 1e-4) return sky;
  vec3 ro = uCam;
  float top = uCloudY - uCloudAmp;
  if(ro.y >= top) return sky;
  float t0 = (top - ro.y) / rd.y;
  float t1 = (uCloudY - ro.y) / rd.y;
  float tMax = 3000.0;
  float tEnd = min(t1, tMax);
  if(t0 > tMax) return sky;
  int N = int(uSteps);
  float dt = (tEnd - t0) / float(N);
  float t = t0, tPrev = t0;
  bool hit = false;
  for(int i = 0; i < 160; i++){
    if(i >= N) break;
    vec3 p = ro + rd * t;
    float sy = uCloudY - cloudH(p.xz);
    if(p.y >= sy){ hit = true; break; }
    tPrev = t; t += dt;
  }
  float azh = atan(rd.x, rd.z) + uSkyYaw;
  vec3 horiz = (uSkyHor + uHorGlow * (0.55 + 0.45 * exp(-azh * azh * 1.5))) * uSkyGain;
  if(!hit){
    // looking down into a gap: deep haze, lit from within by the split
    float fogd = 1.0 - exp(-tEnd * uFog);
    vec3 c = mix(uCloudDeep, horiz, fogd);
    vec3 pp = ro + rd * tEnd;
    c += uSplitGlow * splitMask(pp.xz) * 1.5;
    return c;
  }
  // refine
  for(int k = 0; k < 6; k++){
    float tm = 0.5 * (tPrev + t);
    vec3 p = ro + rd * tm;
    if(p.y >= uCloudY - cloudH(p.xz)) t = tm; else tPrev = tm;
  }
  vec3 p = ro + rd * t;
  float h = cloudH(p.xz);
  float e = max(0.02, t * 0.0025);
  float hx = cloudH(p.xz + vec2(e, 0.0)) - cloudH(p.xz - vec2(e, 0.0));
  float hz = cloudH(p.xz + vec2(0.0, e)) - cloudH(p.xz - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e), -1.0, -hz / (2.0 * e)));
  float rel = h / max(uCloudAmp, 1e-3);
  float nl = dot(n, normalize(uMoonDir));
  // anime cel ramp: shadow -> lit with a soft terminator and a crisp top highlight
  float lit = smoothstep(-0.3, 0.55, nl);
  float hi = smoothstep(0.78, 0.86, nl) * smoothstep(0.35, 0.8, rel);
  float ao = mix(0.1, 1.0, smoothstep(0.15, 0.9, rel));
  float core = smoothstep(-0.25, -0.05, nl);
  vec3 shadeDeep = uCloudShade * vec3(0.55, 0.55, 0.75);
  vec3 c = mix(mix(shadeDeep, uCloudShade, core), uCloudLit, lit) * ao + uCloudLit * hi * 0.18;
  c = mix(uCloudDeep, c, smoothstep(0.1, 0.55, rel));
  // silhouette rim (backlit by the horizon glow)
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  c += uCloudRim * fres * 0.9 * exp(-t * 0.004) * smoothstep(0.3, 0.9, rel);
  // energy lights from the two fighters
  vec3 LA = uLightA.xyz - p; float dA = length(LA);
  float attA = 1.0 / (1.0 + pow(dA / uLightA.w, 2.0));
  c += uLightAC * attA * (0.35 + 0.65 * max(dot(n, LA / dA), 0.0));
  vec3 LB = uLightB.xyz - p; float dB = length(LB);
  float attB = 1.0 / (1.0 + pow(dB / uLightB.w, 2.0));
  c += uLightBC * attB * (0.35 + 0.65 * max(dot(n, LB / dB), 0.0));
  // glowing canyon walls where the sky-slash cut the cloud sea
  float sm = splitMask(p.xz);
  c += uSplitGlow * sm * (1.0 - rel) * 2.0;
  float fogd = 1.0 - exp(-t * uFog);
  c = mix(c, horiz, clamp(fogd, 0.0, 1.0));
  // blend the far edge into the sky for a clean horizon
  float far = smoothstep(tMax * 0.45, tMax, t);
  return mix(c, sky, far);
}

void main(){
  vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
  vec3 c = env(px) * uEnvGain;
  vec4 back = texture(uBack, vUv);
  c += toLin(back.rgb) * uBackGain;
  vec4 s = texture(uScene, vUv);
  vec3 sl = s.a > 0.0 ? toLin(s.rgb / s.a) * s.a : vec3(0.0);
  c = c * (1.0 - s.a) + sl * uSceneGain;
  c += toLin(texture(uEmit, vUv).rgb) * uEmitGain;
  o = vec4(c * uWeight, uWeight);
}`;

// Jimenez 13-tap downsample (first pass also applies the bright/diffusion prefilter)
export const DOWN = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uPrefilter, uThresh, uDiffuse;
vec3 S(vec2 d){ return texture(uSrc, vUv + d * uTexel).rgb; }
void main(){
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2));
  vec3 d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0));
  vec3 g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2));
  vec3 j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if(uPrefilter > 0.5){
    float br = max(col.r, max(col.g, col.b));
    float knee = uThresh * 0.5;
    float soft = clamp(br - uThresh + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, br - uThresh) / max(br, 1e-4);
    col = col * contrib + col * uDiffuse;
    col = min(col, vec3(64.0));
  }
  o = vec4(col, 1.0);
}`;

export const UP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uRadius, uGain;
vec3 S(vec2 d){ return texture(uSrc, vUv + d * uTexel * uRadius).rgb; }
void main(){
  vec3 c = S(vec2(0)) * 4.0 + (S(vec2(-1, 0)) + S(vec2(1, 0)) + S(vec2(0, -1)) + S(vec2(0, 1))) * 2.0
         + S(vec2(-1, -1)) + S(vec2(1, -1)) + S(vec2(-1, 1)) + S(vec2(1, 1));
  o = vec4(c / 16.0 * uGain, 1.0);
}`;

export const FINAL = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
${COMMON}
uniform sampler2D uHdr, uBloom, uUi, uStreakT;
uniform float uStreak; uniform vec3 uStreakCol;
uniform vec3 uRays;     // centre uv (y down), strength
uniform vec2 uRes;
uniform float uFrame;
uniform float uExposure, uBloomStr, uCA, uVignette, uGrain, uSat, uContrast, uKnee;
uniform float uFlash; uniform vec3 uFlashCol;
uniform float uImpact, uImpactMode;
uniform vec3 uImpactA, uImpactB, uImpactC;
uniform vec3 uShadowTint, uHiTint, uGainC;
uniform vec4 uWave;     // centre uv (y down), radius (in height units), strength
uniform vec3 uRadial;   // centre uv (y down), strength
uniform float uLetterbox;
vec3 sampleHdr(vec2 uv){ return texture(uHdr, uv).rgb + texture(uBloom, uv).rgb * uBloomStr; }
vec3 tonemap(vec3 c){
  // keep the authored canvas colours linear up to the knee, compress only emissive highlights,
  // and push over-bright cores toward white (anime "white-hot" energy look)
  vec3 k = vec3(uKnee);
  vec3 over = max(c - k, 0.0);
  vec3 comp = k + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
  vec3 r = mix(c, comp, step(k, c));
  float mx = max(c.r, max(c.g, c.b));
  float wo = smoothstep(1.0, 5.0, mx);
  return mix(r, vec3(1.0), wo * 0.85);
}
void main(){
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 uvd = vec2(uv.x, 1.0 - uv.y);           // y-down uv for the centre params
  // shockwave refraction ring
  if(abs(uWave.w) > 0.0){
    vec2 d = (uvd - uWave.xy) * vec2(aspect, 1.0);
    float r = length(d);
    float k = exp(-pow((r - uWave.z) / 0.045, 2.0));
    vec2 off = normalize(d + 1e-5) * k * uWave.w;
    off.x /= aspect;
    uv += vec2(-off.x, off.y);
  }
  vec2 ctr = vec2(uRadial.x, 1.0 - uRadial.y);
  vec2 dirC = uv - vec2(0.5);
  vec3 col;
  if(uRadial.z > 0.0){
    vec3 acc = vec3(0.0); float wsum = 0.0;
    for(int i = 0; i < 24; i++){
      float f = float(i) / 23.0;
      vec2 suv = mix(uv, ctr, f * uRadial.z);
      float w = 1.0 - f * 0.6;
      vec2 ca = (suv - 0.5) * uCA;
      acc += vec3(sampleHdr(suv - ca).r, sampleHdr(suv).g, sampleHdr(suv + ca).b) * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    vec2 ca = dirC * uCA * (0.4 + 0.6 * dot(dirC, dirC) * 4.0);
    col = vec3(sampleHdr(uv - ca).r, sampleHdr(uv).g, sampleHdr(uv + ca).b);
  }
  col += texture(uStreakT, uv).rgb * uStreak * uStreakCol;
  if(uRays.z > 0.0){
    vec2 rc = vec2(uRays.x, 1.0 - uRays.y);
    vec3 acc = vec3(0.0);
    for(int i = 0; i < 32; i++){
      float f = float(i) / 32.0;
      acc += texture(uBloom, mix(uv, rc, f * 0.85)).rgb * (1.0 - f);
    }
    col += acc / 16.0 * uRays.z;
  }
  col *= uExposure;
  col = tonemap(col);
  vec3 disp = toSrgb(col);
  // grade
  float l = dot(disp, vec3(0.2126, 0.7152, 0.0722));
  disp = mix(vec3(l), disp, uSat);
  disp = (disp - 0.5) * uContrast + 0.5;
  disp += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) * 0.6 + uHiTint * smoothstep(0.5, 1.0, l) * 0.6;
  disp *= uGainC;
  // vignette
  vec2 vq = (uvd - 0.5) * vec2(aspect, 1.0);
  disp *= 1.0 - uVignette * pow(clamp(length(vq) * 0.95, 0.0, 1.0), 2.4);
  // impact frame: inverted, posterised manga look
  if(uImpact > 0.0){
    float lum = dot(clamp(disp, 0.0, 1.0), vec3(0.299, 0.587, 0.114));
    vec3 ic;
    if(uImpactMode < 0.5){
      float v = 1.0 - lum;
      ic = mix(uImpactA, uImpactB, smoothstep(0.42, 0.5, v));
      ic = mix(ic, uImpactC, 1.0 - smoothstep(0.08, 0.14, v));
    } else {
      float v = lum;
      ic = mix(uImpactA, uImpactC, smoothstep(0.30, 0.36, v));
      ic = mix(ic, uImpactB, smoothstep(0.72, 0.78, v));
    }
    disp = mix(disp, ic, uImpact);
  }
  disp = mix(disp, uFlashCol, clamp(uFlash, 0.0, 1.0));
  vec4 ui = texture(uUi, vUv);
  disp = disp * (1.0 - ui.a) + ui.rgb;
  // letterbox
  float lb = uLetterbox * 0.5;
  if(uvd.y < lb || uvd.y > 1.0 - lb) disp = vec3(0.0);
  // grain (midtone weighted) + dither
  float g = hash12(gl_FragCoord.xy + vec2(uFrame * 37.0, uFrame * 91.0)) - 0.5;
  float g2 = hash12(gl_FragCoord.xy * 0.5 + vec2(uFrame * 13.0, uFrame * 7.0)) - 0.5;
  float mw = 1.0 - abs(l - 0.5) * 1.4;
  disp += (g * 0.7 + g2 * 0.3) * uGrain * mw;
  disp += (hash12(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
  o = vec4(clamp(disp, 0.0, 1.0), 1.0);
}`;

// anamorphic horizontal streak (separable, run twice with growing step)
export const STREAK = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uStep;
void main(){
  vec3 c = vec3(0.0); float ws = 0.0;
  for(int i = -16; i <= 16; i++){
    float x = float(i);
    float w = exp(-x * x / 90.0);
    c += texture(uSrc, vUv + vec2(x * uStep * uTexel.x, 0.0)).rgb * w;
    ws += w;
  }
  o = vec4(c / ws, 1.0);
}`;
