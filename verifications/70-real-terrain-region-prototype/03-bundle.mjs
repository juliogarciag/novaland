/**
 * Builds the client and the server the way the Dockerfile does and checks
 * that the region is not in what ships: it is played by dev builds only,
 * and the world players join is still `worldMap`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, check, summarize, writeProof } from './lib.mjs';

const results = [];
const report = {};

try {
  // A stretch of one row of the region: long enough to be nowhere else.
  const regionRows = readFileSync(path.join(ROOT, 'packages/sim/src/content/world/regions/alps.ts'), 'utf8')
    .split('\n')
    .filter((line) => /^\s+"[^"]{400,}",$/.test(line));
  const needle = regionRows[150].trim().slice(100, 180);
  results.push(check('the region module holds 320 rows to look for', regionRows.length === 320, `looking for "${needle.slice(0, 24)}..."`));

  execFileSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const [name, directory] of [['client', 'packages/client/dist'], ['server', 'packages/server/dist']]) {
    // Source maps repeat the sources, the region among them: they are for debugging and are not what runs.
    const files = filesUnder(path.join(ROOT, directory)).filter((file) => /\.(js|mjs|html|css)$/.test(file));
    const holding = files.filter((file) => readFileSync(file, 'utf8').includes(needle));
    report[name] = { files: files.length, bytes: files.reduce((total, file) => total + statSync(file).size, 0) };
    results.push(check(`the ${name} bundle does not carry the region`, files.length > 0 && holding.length === 0, `${files.length} files, ${report[name].bytes} bytes${holding.length > 0 ? `, found in ${holding.map((file) => path.relative(ROOT, file)).join(', ')}` : ''}`));
  }
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
}

writeProof('03-bundle.json', { results, report });
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
}
