/** V2: package boundaries and determinism rules are enforced by lint. Writes deliberate violations, expects lint to reject each one, removes them. */
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

// __violation__.ts is gitignored, so an interrupted run never pollutes a commit.
const violations = {
  'packages/sim/src/__violation__.ts': {
    source: [
      "import Phaser from 'phaser';",
      "import { boot } from '../../client/src/main';",
      "import { runHeadless } from '@novaland/server';",
      "import { Room } from 'colyseus';",
      "import { readFileSync } from 'node:fs';",
      'export const v = [Phaser, boot, runHeadless, Room, readFileSync, window, crypto, Math.random(), Date.now(), new Date()];',
    ],
    expect: [
      ['no-restricted-imports', /phaser/],
      ['no-restricted-imports', /client/],
      ['no-restricted-imports', /@novaland\/server/],
      ['no-restricted-imports', /colyseus/],
      ['no-restricted-imports', /node:fs/],
      ['no-restricted-globals', /window/],
      ['no-restricted-globals', /crypto/],
      ['no-restricted-properties', /Math\.random/],
      ['no-restricted-properties', /Date\.now/],
      ['no-restricted-syntax', /Non-deterministic/],
    ],
  },
  'packages/client/src/__violation__.ts': {
    source: [
      "import RAPIER from '@dimforge/rapier2d-deterministic-compat';",
      "import { createWorld } from 'bitecs';",
      "import { Position } from '@novaland/sim/src/core/transform';",
      "import { Body } from '../../sim/src/core/physics';",
      "import { runHeadless } from '@novaland/server';",
      'export const v = [RAPIER, createWorld, Position, Body, runHeadless];',
    ],
    expect: [
      ['no-restricted-imports', /@dimforge/],
      ['no-restricted-imports', /bitecs/],
      ['no-restricted-imports', /@novaland\/sim\/src/],
      ['no-restricted-imports', /\.\.\/\.\.\/sim/],
      ['no-restricted-imports', /@novaland\/server/],
    ],
  },
  'packages/server/src/__violation__.ts': {
    source: ["import Phaser from 'phaser';", "import { Sim } from '../../sim/src/core/sim';", 'export const v = [Phaser, Sim];'],
    expect: [
      ['no-restricted-imports', /phaser/],
      ['no-restricted-imports', /\.\.\/\.\.\/sim/],
    ],
  },
};

const files = Object.keys(violations);
const results = [];
let report;
const cleanup = () => {
  for (const file of files) rmSync(path.join(ROOT, file), { force: true });
};
process.on('exit', cleanup);
try {
  for (const file of files) writeFileSync(path.join(ROOT, file), violations[file].source.join('\n') + '\n');
  const { code, stdout } = await run('pnpm', ['exec', 'eslint', '--format', 'json', ...files]);
  results.push(check('lint fails on the violation files', code !== 0, `exit ${code}`));
  report = JSON.parse(stdout);
  for (const file of files) {
    const entry = report.find((r) => r.filePath.endsWith(file));
    const messages = entry ? entry.messages : [];
    for (const [ruleId, pattern] of violations[file].expect) {
      const hit = messages.some((m) => m.ruleId === ruleId && pattern.test(m.message));
      results.push(check(`${file}: ${ruleId} ${pattern}`, hit));
    }
  }
} finally {
  cleanup();
}
const clean = await run('git', ['status', '--porcelain', '--ignored', '--', ...files]);
results.push(check('violation files removed again', clean.stdout.trim() === ''));
writeProof('02-boundaries.json', { results, lint: report });
process.exit(summarize(results) ? 0 : 1);
