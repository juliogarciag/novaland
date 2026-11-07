/** V4: no hardcoded ports. Several dev servers run side by side, pinned by PORT, and an unpinned one still finds a free port. */
import { check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const results = [];
const servers = [];
const portA = 5301;
const portB = 5302;
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
  // Unpinned: Vite must choose a free port, not fail or clash.
  const free = start('pnpm', ['dev'], { env: { PORT: '' } });
  servers.push(free);
  let chosen = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !chosen) {
    const m = free.output.match(/Local:\s+http:\/\/localhost:(\d+)\//);
    if (m) chosen = Number(m[1]);
    else await new Promise((r) => setTimeout(r, 200));
  }
  results.push(check('unpinned server picks its own free port', chosen !== null && chosen !== portA && chosen !== portB, `port ${chosen}`));
  writeProof('04-ports.json', { pinned: [portA, portB], unpinned: chosen, logs: servers.map((s) => s.output) });
} finally {
  for (const s of servers) s.stop();
}
process.exit(summarize(results) ? 0 : 1);
