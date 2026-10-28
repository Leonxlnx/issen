// Copies every sound the cue sheet uses from sfx_downloads/ into audio/sfx/, points cues.json at the
// copies, removes copies no cue uses any more and writes audio/CREDITS.md from the license audit
// (audio/candidates.json). Safe to re-run: cues may already point at audio/sfx/.
//
//   node audio/collect.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cuesPath = path.join(ROOT, 'audio/cues.json');
const sheet = JSON.parse(fs.readFileSync(cuesPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/candidates.json'), 'utf8'));
const byBase = new Map(audit.approved.map((a) => [path.basename(a.file), a]));

fs.mkdirSync(path.join(ROOT, 'audio/sfx'), { recursive: true });
const used = new Map();
for (const c of sheet.cues) {
  if (c.mute) continue;
  const base = path.basename(c.file);
  const meta = byBase.get(base);
  if (!meta) throw new Error(`no license record for ${base}`);
  if (!meta.redistributable) throw new Error(`${base} (${meta.license}) may not be redistributed`);
  const dest = `audio/sfx/${base}`;
  if (!fs.existsSync(path.join(ROOT, dest))) fs.copyFileSync(path.join(ROOT, 'sfx_downloads', meta.file.replace(/^.*sfx_downloads\//, '')), path.join(ROOT, dest));
  c.file = dest;
  if (!used.has(dest)) used.set(dest, { meta, cues: [] });
  used.get(dest).cues.push(c.id);
}
fs.writeFileSync(cuesPath, JSON.stringify(sheet, null, 2) + '\n');

const rows = [...used.entries()].sort((a, b) => a[1].meta.license.localeCompare(b[1].meta.license) || a[0].localeCompare(b[0]));
const by = rows.filter(([, u]) => !/CC0/.test(u.meta.license));
const zero = rows.filter(([, u]) => /CC0/.test(u.meta.license));
const line = ([f, u]) => `| [${u.meta.title}](${u.meta.source_page}) | ${u.meta.author} | ${u.meta.license} | \`${path.basename(f)}\` | ${u.cues.join(', ')} |`;
const md = `# Sound credits

Every sound in ISSEN is a real recording or produced sound effect found online under a free license.
None of it is synthesized by code. All clips were edited for the film: trimmed, level-matched,
some pitch/speed-shifted, filtered, faded and mixed together (\`audio/mix.mjs\`, cue sheet \`audio/cues.json\`).

## Attribution required (Creative Commons BY)

| Sound | Author | License | File | Used as |
|---|---|---|---|---|
${by.map(line).join('\n')}

${by.map(([, u]) => `- ${u.meta.attribution} (edited)`).join('\n')}

## Public domain (CC0) — credit given as thanks

| Sound | Author | License | File | Used as |
|---|---|---|---|---|
${zero.map(line).join('\n')}
`;
fs.writeFileSync(path.join(ROOT, 'audio/CREDITS.md'), md);
console.log(`${used.size} files collected (${by.length} CC-BY, ${zero.length} CC0)`);
