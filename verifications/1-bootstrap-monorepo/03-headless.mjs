/** V3: the server package drives the same sim headlessly and reproducibly, with no browser. */
import { check, run, summarize, writeProof } from './lib.mjs';

const results = [];
const runs = [];
for (let i = 0; i < 2; i += 1) {
  const { code, output } = await run('pnpm', ['sim:headless']);
  const line = output.split('\n').find((l) => l.startsWith('{'));
  runs.push({ code, line, parsed: line ? JSON.parse(line) : null });
}
results.push(check('pnpm sim:headless exits 0', runs.every((r) => r.code === 0)));
results.push(check('prints a JSON result with a hash and player position', runs.every((r) => r.parsed && r.parsed.hash && r.parsed.player)));
results.push(check('simulated 300 ticks (5s at 60Hz)', runs.every((r) => r.parsed && r.parsed.ticks === 300)));
results.push(check('player moved (right then down)', runs.every((r) => r.parsed && r.parsed.player.x > 0 && r.parsed.player.y > 0)));
results.push(check('two runs produce the same hash', runs[0].parsed && runs[1].parsed && runs[0].parsed.hash === runs[1].parsed.hash, runs[0].parsed?.hash));
writeProof('03-headless.json', runs.map((r) => r.parsed));
process.exit(summarize(results) ? 0 : 1);
