// SIEGE PROTOCOL — entry program (Node 22, standard library only).
// Hands the game in: copies this repo's game/ and screenshots/ beside this
// file into /output (or MAKEFUN_OUTPUT_DIR outside the grader) and writes
// /output/dossier.json with the vendored make.fun library, which the sealed
// scorer rebuilds and compares byte for byte. Deterministic: same input
// files always produce the same output bytes (fixed copy order, no clock
// or random input anywhere in this program).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start from a clean output directory so stale files can never leak in.
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Copy game/ entry by entry in sorted order for a stable walk.
const gameSrc = join(here, 'game');
mkdirSync(join(out, 'game'), { recursive: true });
for (const name of readdirSync(gameSrc).sort()) {
  cpSync(join(gameSrc, name), join(out, 'game', name), { recursive: true });
}

// Screenshots: at most 4, each at most 256 KiB — the gate refuses more.
const shotsSrc = join(here, 'screenshots');
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotsSrc)) {
  const shots = readdirSync(shotsSrc).filter((n) => !n.startsWith('.')).sort().slice(0, 4);
  for (const name of shots) cpSync(join(shotsSrc, name), join(out, 'screenshots', name));
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
console.log('dossier written to ' + join(out, 'dossier.json'));
