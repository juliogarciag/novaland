/** V2: the server package still drives the tile level headlessly and reproducibly, and the scripted walk stays on open ground. */
import { check, run, summarize, writeProof } from './lib.mjs';

const results = [];
const runs = [];
for (let i = 0; i < 2; i += 1) {
  const { code, stdout } = await run('pnpm', ['sim:headless']);
  const line = stdout.split('\n').find((l) => l.startsWith('{'));
  runs.push({ code, line, parsed: line ? JSON.parse(line) : null });
}
const [first, second] = runs;
results.push(check('pnpm sim:headless exits 0', runs.every((r) => r.code === 0)));
results.push(check('prints a JSON result with a hash and player position', runs.every((r) => r.parsed && r.parsed.hash && r.parsed.player)));
results.push(check('simulated 300 ticks (5s at 60Hz)', runs.every((r) => r.parsed && r.parsed.ticks === 300)));

// The script walks right for 119 ticks then down for 60 at 5 m/s: 9.92 m right, 5 m down from the spawn.
// The expected spawn comes from the level source, not from a number typed here.
const { readFileSync } = await import('node:fs');
const source = readFileSync(new URL('../../packages/sim/src/content/levels/starter.ts', import.meta.url), 'utf8');
const rows = [...source.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
const spawnMatch = source.match(/spawn: \{ column: (\d+), row: (\d+) \}/);
const spawn = { column: Number(spawnMatch[1]), row: Number(spawnMatch[2]) };
const spawnMetres = { x: spawn.column + 0.5 - rows[0].length / 2, y: spawn.row + 0.5 - rows.length / 2 };
const expected = { x: spawnMetres.x + 5 * 119 / 60, y: spawnMetres.y + 5 * 60 / 60 };
const player = first.parsed?.player;
results.push(check('the player walked 9.92 m right then 5 m down from the spawn, unblocked', player && Math.abs(player.x - expected.x) < 0.01 && Math.abs(player.y - expected.y) < 0.01, JSON.stringify(player)));
const endTile = player && rows[Math.floor(player.y + rows.length / 2)]?.[Math.floor(player.x + rows[0].length / 2)];
results.push(check('it ended on a walkable tile', endTile === '.' || endTile === '=', `tile "${endTile}"`));
results.push(check('two separate processes produce the same hash', first.parsed && second.parsed && first.parsed.hash === second.parsed.hash, first.parsed?.hash));
writeProof('02-headless.json', { runs: runs.map((r) => r.parsed), spawn, expected, endTile });
process.exit(summarize(results) ? 0 : 1);
