import { Engine } from './core/engine.js';

const params = new URLSearchParams(location.search);
const filmName = params.get('film') || 'film';
const renderMode = params.has('render');
const scale = parseFloat(params.get('scale') || '1');

const out = document.getElementById('out');
const film = await import(`./${filmName}.js`);
const W = Math.round(1920 * scale), H = Math.round(1080 * scale);
const engine = new Engine(out, film, W, H);
await engine.init();

const FPS = film.FPS, FRAMES = Math.round(film.DURATION * FPS);

function blobToBase64(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.slice(r.result.indexOf(',') + 1)); r.readAsDataURL(blob); });
}

window.ISSEN = {
  info: () => ({ fps: FPS, duration: film.DURATION, frames: FRAMES, width: W, height: H, shots: film.shots || [], cues: film.CUES || [] }),
  // returns raw RGBA (bottom-up rows) as base64
  async frame(f, sub = 1, shutter = 0.5) {
    engine.renderFrame(f, sub, shutter);
    const px = engine.gl.read();
    return blobToBase64(new Blob([px]));
  },
  // returns PNG (top-down) as base64 — used for stills
  async still(f, sub = 1, shutter = 0.5) {
    engine.renderFrame(f, sub, shutter);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    return blobToBase64(blob);
  },
};
window.ISSEN_READY = true;

if (!renderMode) {
  // live player
  const ui = document.getElementById('ui');
  ui.hidden = false;
  const scrub = document.getElementById('scrub');
  const playBtn = document.getElementById('play');
  const label = document.getElementById('label');
  scrub.max = FRAMES - 1;
  let playing = true, t0 = performance.now(), base = 0, audio = null, actx = null, src = null, audioBuf = null;
  try {
    const res = await fetch('audio/soundtrack.m4a');
    if (res.ok) { actx = new AudioContext(); audioBuf = await actx.decodeAudioData(await res.arrayBuffer()); }
  } catch (e) { /* silent */ }
  const startAudio = (at) => {
    if (!audioBuf) return;
    if (src) { try { src.stop(); } catch (e) {} }
    src = actx.createBufferSource(); src.buffer = audioBuf; src.connect(actx.destination);
    src.start(0, at);
  };
  const stopAudio = () => { if (src) { try { src.stop(); } catch (e) {} src = null; } };
  playBtn.onclick = () => {
    playing = !playing;
    if (playing) { t0 = performance.now(); if (actx) actx.resume(); startAudio(base); } else { base = cur; stopAudio(); }
    playBtn.textContent = playing ? '❚❚' : '▶';
  };
  scrub.oninput = () => { base = scrub.value / FPS; t0 = performance.now(); if (playing) startAudio(base); };
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); playBtn.onclick(); } });
  document.body.addEventListener('click', (e) => { if (actx && actx.state !== 'running' && e.target !== playBtn) { actx.resume(); startAudio(cur); } }, { once: true });
  let cur = 0;
  const loop = () => {
    if (playing) { cur = base + (performance.now() - t0) / 1000; if (cur >= film.DURATION) { base = 0; cur = 0; t0 = performance.now(); startAudio(0); } }
    const f = Math.min(FRAMES - 1, Math.floor(cur * FPS));
    engine.renderFrame(f, 1);
    scrub.value = f;
    label.textContent = `${(f / FPS).toFixed(2)}s · ${engine.shotAt(f / FPS)?.name || ''}`;
    requestAnimationFrame(loop);
  };
  if (audioBuf) startAudio(0);
  loop();
}
