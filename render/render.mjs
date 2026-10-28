// Deterministic offline renderer: headless Chrome steps the film frame by frame,
// raw RGBA frames are piped straight into ffmpeg (no intermediate images).
//
//   node render/render.mjs --stills 0,60,120 [--film tests/sky] [--scale 0.5] [--sub 4]
//   node render/render.mjs --times 1.2,3.5          (stills at seconds)
//   node render/render.mjs --video out/preview.mp4 [--from 0 --to 300] [--scale 0.5] [--sub 1|auto]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve, ROOT } from './server.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const film = arg('film', 'film');
const scale = parseFloat(arg('scale', '1'));
const subArg = arg('sub', '1');
const shutter = parseFloat(arg('shutter', '0.5'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const server = await serve(0);
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error' || m.type() === 'warn') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?render=1&film=${encodeURIComponent(film)}&scale=${scale}`, { waitUntil: 'load' });
await page.waitForFunction('window.ISSEN_READY === true', { timeout: 300000 });
const info = await page.evaluate(() => window.ISSEN.info());
const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log(`film=${film} ${info.width}x${info.height}@${info.fps} dur=${info.duration}s frames=${info.frames} gpu=${renderer}`);

const subFor = () => (subArg === 'auto' ? 'auto' : parseInt(subArg, 10));
const t0 = Date.now();

if (arg('stills') || arg('times')) {
  let frames = [];
  if (arg('stills') && arg('stills') !== true) frames = String(arg('stills')).split(',').map((s) => parseInt(s, 10));
  if (arg('times')) frames = frames.concat(String(arg('times')).split(',').map((s) => Math.round(parseFloat(s) * info.fps)));
  const outDir = path.resolve(ROOT, arg('out', `out/stills/${film.replace(/[\\/]/g, '_')}`));
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of frames) {
    const s = subFor();
    const b64 = await page.evaluate((f, s, sh) => window.ISSEN.still(f, s === 'auto' ? -1 : s, sh), f, s, shutter);
    const file = path.join(outDir, `f${String(f).padStart(4, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(file);
  }
} else if (arg('video')) {
  const outFile = path.resolve(ROOT, arg('video'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const from = parseInt(arg('from', '0'), 10);
  const to = parseInt(arg('to', String(info.frames - 1)), 10);
  const crf = arg('crf', scale < 1 ? '20' : '14');
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${info.width}x${info.height}`, '-r', String(info.fps), '-i', '-',
    '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', arg('preset', 'slow'), '-crf', String(crf), '-tune', 'film', '-profile:v', 'high',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    // some ffmpeg builds drop the flags above from the x264 VUI; write the tags into the stream explicitly
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r)));
  for (let f = from; f <= to; f++) {
    const s = subFor();
    const b64 = await page.evaluate((f, s, sh) => window.ISSEN.frame(f, s === 'auto' ? -1 : s, sh), f, s, shutter);
    await write(Buffer.from(b64, 'base64'));
    if ((f - from) % 30 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\rframe ${f}/${to}  ${(el / (f - from + 1)).toFixed(2)} s/f  elapsed ${el.toFixed(0)}s   `);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\nwrote ${outFile}`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
server.close();
