/**
 * `pnpm sim:headless`: proves the server package can drive the sim without a
 * browser or a network. Runs it for five simulated seconds and prints a hash.
 */
import { TICK_RATE } from '@novaland/sim';
import { runHeadless } from './headless';

const seconds = 5;
const result = await runHeadless({ ticks: TICK_RATE * seconds, seed: 1 });
console.log(JSON.stringify({ simulatedSeconds: seconds, ...result }));
