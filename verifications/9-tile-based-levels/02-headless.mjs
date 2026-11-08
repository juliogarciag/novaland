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

// The server's script (packages/server/src/headless.ts) walks right from tick 1 to 120, then down to 180, at the
// player def's 5 m/s and 60 ticks/s, so 9.92 m right and 5 m down. Those four numbers are typed here because this
// script runs outside the workspace; the server's own test derives them from the sim. The spawn and the tiles come
// from the level source: the rows block of starter.ts, one quoted row per line, and one metre per tile.
const { readFileSync } = await import('node:fs');
const source = readFileSync(new URL('../../packages/sim/src/content/levels/starter.ts', import.meta.url), 'utf8');
const rowsBlock = source.match(/rows: \[([\s\S]*?)\n {2}\]/)[1];
const rows = [...rowsBlock.matchAll(/^\s+'([^']+)',\s*$/gm)].map((m) => m[1]);
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
