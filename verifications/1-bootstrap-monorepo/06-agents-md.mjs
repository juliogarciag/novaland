/** V6: AGENTS.md explains the rules, the layout, the commands, and how to add a feature. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, check, summarize, writeProof } from './lib.mjs';

const text = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
const results = [
  check('keeps the development process section', text.includes('**Development process**') && text.includes('verifications/{ticketNumber}-{ticketKebabTitle}')),
  check('documents the package layout', text.includes('packages/') && text.includes('sim/') && text.includes('client/') && text.includes('server/')),
  check('states the architecture rules', /single source of truth/.test(text) && /serializable commands/.test(text) && /Determinism/.test(text) && /numeric, mutable, per-entity/.test(text) && /enforced by lint/.test(text)),
  check('lists the four commands', ['pnpm dev', 'pnpm test', 'pnpm typecheck', 'pnpm lint'].every((c) => text.includes(c))),
  check('explains how to add a feature step by step', /How to add a feature/.test(text) && /features\/index\.ts/.test(text) && /defineComponent/.test(text) && /core\/commands\.ts/.test(text)),
  check('explains ports and worktrees', /PORT=/.test(text) && /worktree/.test(text)),
  check('points to the ECS decision record', text.includes('docs/decisions/0001-ecs.md')),
];
writeProof('06-agents-md.json', results);
process.exit(summarize(results) ? 0 : 1);
