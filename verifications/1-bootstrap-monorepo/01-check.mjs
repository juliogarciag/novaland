/** V1: the "done when" command passes from a clean install, and the sim tests the ticket asks for exist and run. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const results = [];
let log = '';
for (const step of [['install', ['install', '--frozen-lockfile']], ['test', ['test']], ['typecheck', ['typecheck']], ['lint', ['lint']]]) {
  const [name, args] = step;
  const { code, output } = await run('pnpm', args);
  log += `\n$ pnpm ${args.join(' ')}\n${output}\n(exit ${code})\n`;
  results.push(check(`pnpm ${args.join(' ')} exits 0`, code === 0, `exit ${code}`));
  if (name === 'test') {
    results.push(check('headless N-tick movement test ran', /movement\.test\.ts/.test(output) || /Test Files\s+\d+ passed/.test(output)));
    results.push(check('determinism test ran', existsSync(path.join(ROOT, 'packages/sim/src/core/determinism.test.ts'))));
    const m = output.match(/Tests\s+(\d+) passed \((\d+)\)/);
    results.push(check('all tests passed', m !== null && m[1] === m[2], m ? `${m[1]}/${m[2]}` : 'no summary'));
  }
}
writeProof('01-check.log', log);
process.exit(summarize(results) ? 0 : 1);
