/**
 * Where the terrain sheet generators write their PNGs, and the command line
 * they share:
 *
 *   node tools/generate-<name>-sheet.mjs                # writes public/sprites/<key>.png
 *   node tools/generate-<name>-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './generate-player-sheet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(here, '../public/sprites');

/** Writes `sheet` into `directory` as `<key>.png` and returns the path. */
export function writeSheet({ directory, key, sheet }) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${key}.png`);
  writeFileSync(file, encodePng(sheet));
  return file;
}

/**
 * When the module at `moduleUrl` is the script Node was started with, calls
 * `writeInto(directory)` with the `--out` directory, or public/sprites
 * without the flag, and prints the path it returns. Does nothing when the
 * module was imported.
 */
export function writeSheetWhenRunDirectly(moduleUrl, writeInto) {
  if (!process.argv[1] || path.resolve(process.argv[1]) !== fileURLToPath(moduleUrl)) return;
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the sheet goes to public/sprites');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  console.log(`wrote ${writeInto(directory)}`);
}
