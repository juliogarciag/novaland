/** V4: no hardcoded ports. Several dev servers run side by side pinned by PORT, and an unpinned one avoids a busy 5173. */
import { check, occupyPort, start, summarize, waitForPort, writeProof } from './lib.mjs';

const results = [];
const servers = [];
const portA = 5301;
const portB = 5302;
let release = null;
try {
  servers.push(start('pnpm', ['dev'], { env: { PORT: String(portA) } }));
  servers.push(start('pnpm', ['dev'], { env: { PORT: String(portB) } }));
  results.push(check(`dev server on PORT=${portA}`, await waitForPort(portA)));
  results.push(check(`dev server on PORT=${portB}`, await waitForPort(portB)));
  for (const port of [portA, portB]) {
    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();
    results.push(check(`port ${port} serves the client page`, res.ok && html.includes('/src/main.ts')));
  }

  // Unpinned, with 5173 deliberately busy: Vite must choose another free port, not fail or clash.
  release = await occupyPort(5173);
  const free = start('pnpm', ['dev'], { env: { PORT: undefined } });
  servers.push(free);
  let chosen = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !chosen) {
    const m = free.output.match(/Local:\s+http:\/\/localhost:(\d+)\//);
    if (m) chosen = Number(m[1]);
    else await new Promise((r) => setTimeout(r, 200));
  }
  results.push(check('unpinned server picks a free port when 5173 is busy', chosen !== null && chosen !== 5173 && chosen !== portA && chosen !== portB, `port ${chosen}`));
  results.push(check('the unpinned server really serves', chosen !== null && (await waitForPort(chosen))));

  // Pinned to a busy port: must fail loudly instead of silently moving.
  const clash = start('pnpm', ['dev'], { env: { PORT: '5173' } });
  servers.push(clash);
  const clashDeadline = Date.now() + 20000;
  while (Date.now() < clashDeadline && !/already in use/.test(clash.output) && clash.child.exitCode === null) {
    await new Promise((r) => setTimeout(r, 200));
  }
  results.push(check('PORT pinned to a busy port fails instead of moving', /already in use/.test(clash.output)));
  writeProof('04-ports.json', { pinned: [portA, portB], unpinned: chosen, logs: servers.map((s) => s.output) });
} finally {
  for (const s of servers) s.stop();
  if (release) await release();
}
process.exit(summarize(results) ? 0 : 1);
