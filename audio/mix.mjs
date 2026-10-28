// Sound mixer: places downloaded SFX on the timeline (audio/cues.json) with ffmpeg,
// then loudness-normalises the mix for social (-14 LUFS integrated, <= -1.5 dBTP).
//
//   node audio/mix.mjs                 -> audio/soundtrack.wav + audio/soundtrack.m4a
//   node audio/mix.mjs --mux out/film_picture.mp4 out/ISSEN.mp4
//
// cue fields: file, at (film s), trim, dur, rate (pitch+speed), filters, fadeIn, fadeOut, pan,
//   level  — target max momentary loudness (LUFS) of the processed clip; gain is measured, not guessed
//   gain   — extra dB on top of level (or absolute dB when level is absent)
//   env    — [[filmTime, dB], ...] piecewise-linear volume automation in film time
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sheet = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/cues.json'), 'utf8'));
const DUR = sheet.duration;
const SR = 48000;

function ff(args, opts = {}) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) { console.error(r.stderr.slice(-4000)); throw new Error('ffmpeg failed'); }
  return r.stderr;
}

// clip processing up to (not including) gain / automation / pan / placement
function shapeChain(c) {
  const f = [`aresample=${SR}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
  if (c.trim != null || c.dur != null) f.push(`atrim=start=${c.trim || 0}${c.dur != null ? `:duration=${c.dur}` : ''}`, 'asetpts=PTS-STARTPTS');
  if (c.rate) f.push(`asetrate=${Math.round(SR * c.rate)}`, `aresample=${SR}`);   // pitch+speed (slow-mo drops pitch)
  if (c.filters) f.push(c.filters);
  if (c.fadeIn) f.push(`afade=t=in:st=0:d=${c.fadeIn}`);
  if (c.fadeOut) {
    const len = c.dur != null ? c.dur / (c.rate || 1) : null;
    if (len != null) f.push(`afade=t=out:st=${Math.max(0, len - c.fadeOut)}:d=${c.fadeOut}`);
  }
  return f;
}

// max momentary loudness (400 ms window) of the shaped clip
const cache = new Map();
function measure(file, chain) {
  const key = file + '|' + chain.join(',');
  if (cache.has(key)) return cache.get(key);
  const log = ff(['-i', file, '-af', `${chain.join(',')},apad=pad_dur=0.5,ebur128`, '-f', 'null', '-']);
  let m = -120;
  for (const x of log.matchAll(/M:\s*(-?[\d.]+)/g)) m = Math.max(m, +x[1]);
  cache.set(key, m);
  return m;
}

// piecewise-linear dB automation -> ffmpeg volume expression in clip-local time
function envExpr(env, at) {
  const p = env.map(([t, db]) => [Math.max(0, t - at), db]).sort((a, b) => a[0] - b[0]);
  let e = `${p[p.length - 1][1]}`;
  for (let i = p.length - 2; i >= 0; i--) {
    const [t0, d0] = p[i], [t1, d1] = p[i + 1];
    const seg = t1 > t0 ? `${d0}+(${d1 - d0})*(t-${t0.toFixed(3)})/${(t1 - t0).toFixed(3)}` : `${d1}`;
    e = `if(lt(t,${t1.toFixed(3)}),${seg},${e})`;
  }
  e = `if(lt(t,${p[0][0].toFixed(3)}),${p[0][1]},${e})`;
  return `volume='pow(10,(${e})/20)':eval=frame`;
}

const inputs = [];
const chains = [];
const report = [];
sheet.cues.forEach((c) => {
  if (c.mute) return;
  const file = path.join(ROOT, c.file);
  if (!fs.existsSync(file)) { console.warn('missing', c.file); return; }
  inputs.push('-i', file);
  const n = inputs.length / 2 - 1;
  const f = shapeChain(c);
  let gain = c.gain || 0;
  if (c.level != null) {
    const m = measure(file, f);
    gain += c.level - m;
    report.push(`${(c.id || path.basename(c.file)).padEnd(28)} at ${c.at.toFixed(2).padStart(6)}  M ${m.toFixed(1).padStart(6)} -> ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`);
  }
  f.push(`volume=${gain.toFixed(2)}dB`);
  if (c.env) f.push(envExpr(c.env, c.at));
  if (c.pan != null) { const l = Math.min(1, 1 - c.pan), r = Math.min(1, 1 + c.pan); f.push(`pan=stereo|c0=${l.toFixed(3)}*c0|c1=${r.toFixed(3)}*c1`); }
  const ms = Math.max(0, Math.round(c.at * 1000));
  f.push(`adelay=${ms}|${ms}`);
  chains.push(`[${n}:a]${f.join(',')}[a${n}]`);
});
if (report.length) console.log(report.join('\n'));
const count = inputs.length / 2;
const mixIn = Array.from({ length: count }, (_, i) => `[a${i}]`).join('');
const master = sheet.master || {};
const graph = `${chains.join(';')};${mixIn}amix=inputs=${count}:normalize=0:dropout_transition=0,apad=whole_dur=${DUR},atrim=duration=${DUR},` +
  `${master.filters ? master.filters + ',' : ''}afade=t=out:st=${DUR - (master.tailFade || 0.6)}:d=${master.tailFade || 0.6}[mix]`;

const raw = path.join(ROOT, 'audio/_premix.wav');
const gfile = path.join(ROOT, 'audio/_graph.txt');
fs.writeFileSync(gfile, graph);
ff([...inputs, '-filter_complex_script', gfile, '-map', '[mix]', '-ar', String(SR), '-c:a', 'pcm_f32le', raw]);

// two-pass loudnorm
const target = master.lufs ?? -14, tp = master.tp ?? -1.5;
const pass1 = ff(['-i', raw, '-af', `loudnorm=I=${target}:TP=${tp}:LRA=${master.lra ?? 20}:print_format=json`, '-f', 'null', '-']);
const js = JSON.parse(pass1.slice(pass1.lastIndexOf('{'), pass1.lastIndexOf('}') + 1));
const outWav = path.join(ROOT, 'audio/soundtrack.wav');
ff(['-i', raw, '-af', `loudnorm=I=${target}:TP=${tp}:LRA=${master.lra ?? 20}:measured_I=${js.input_i}:measured_TP=${js.input_tp}:measured_LRA=${js.input_lra}:measured_thresh=${js.input_thresh}:offset=${js.target_offset}:linear=true,aresample=${SR}`,
  '-ar', String(SR), '-c:a', 'pcm_s24le', outWav]);
ff(['-i', outWav, '-c:a', 'aac', '-b:a', '256k', path.join(ROOT, 'audio/soundtrack.m4a')]);
const check = ff(['-i', outWav, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const sum = check.slice(check.lastIndexOf('Summary:'));
console.log('premix', js.input_i, 'LUFS', js.input_tp, 'dBTP ->', js.normalization_type);
console.log(sum.replace(/\s+/g, ' ').trim());
fs.unlinkSync(raw); fs.unlinkSync(gfile);

const mi = process.argv.indexOf('--mux');
if (mi > 0) {
  const pic = path.resolve(ROOT, process.argv[mi + 1]), out = path.resolve(ROOT, process.argv[mi + 2]);
  ff(['-i', pic, '-i', outWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', String(SR), '-shortest', '-movflags', '+faststart', out]);
  console.log('muxed', out);
}
