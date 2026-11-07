/**
 * Entry point of the future authoritative server. See README.md for the plan.
 * For now it proves the server package can run the sim headlessly.
 */
import { TICK_RATE } from '@novaland/sim';
import { runHeadless } from './headless';

const seconds = 5;
const result = await runHeadless({ ticks: TICK_RATE * seconds, seed: 1 });
console.log(JSON.stringify({ simulatedSeconds: seconds, ...result }));
