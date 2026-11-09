/** V2: against the real server process with a 3 second idle timeout set through the environment: an idle client is kicked with 4100 "idle", a playing one stays, the kicked one rejoins into its seat. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const IDLE_TIMEOUT_SECONDS = 3;
const serverDir = path.join(ROOT, 'packages/server');
const results = [];
const transcript = [];

// A bad timeout must stop the boot, like a bad PORT does: a typo must not silently become ten minutes.
const badBoot = await run('pnpm', ['--filter', '@novaland/server', 'dev'], { env: { PORT: '0', IDLE_TIMEOUT_SECONDS: 'soon' } });
transcript.push(`$ IDLE_TIMEOUT_SECONDS=soon PORT=0 pnpm --filter @novaland/server dev (exit ${badBoot.code})\n${badBoot.output}`);
results.push(check('IDLE_TIMEOUT_SECONDS=soon stops the boot with a message instead of picking a default', badBoot.code !== 0 && /IDLE_TIMEOUT_SECONDS must be a positive number/.test(badBoot.output)));

// Boot the server exactly as `IDLE_TIMEOUT_SECONDS=3 PORT=<n> pnpm --filter @novaland/server dev` does, on a free port (0) so the run never collides with a dev server.
const server = spawn('pnpm', ['--filter', '@novaland/server', 'dev'], { cwd: ROOT, env: { ...process.env, PORT: '0', IDLE_TIMEOUT_SECONDS: String(IDLE_TIMEOUT_SECONDS) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
const listening = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not report listening')), 30000);
  const onData = (chunk) => {
    serverOutput += chunk;
    const line = serverOutput.split('\n').find((candidate) => candidate.includes('world-room-listening'));
    if (line) {
      clearTimeout(timer);
      resolve(JSON.parse(line.slice(line.indexOf('{'))));
    }
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', (chunk) => (serverOutput += chunk));
  server.on('exit', (code) => reject(new Error(`server exited early with ${code}`)));
});
let boot;
try {
  boot = await listening;
} catch (error) {
  transcript.push(`server output:\n${serverOutput}`);
  results.push(check('the server boots and reports its port', false, String(error)));
}

if (boot) {
  results.push(check(`the server boots with the ${IDLE_TIMEOUT_SECONDS} s idle timeout from the environment`, boot.roomId === 'world' && boot.port > 0 && boot.idleTimeoutSeconds === IDLE_TIMEOUT_SECONDS, JSON.stringify(boot)));
  const clients = await run('pnpm', ['exec', 'tsx', path.join(ROOT, 'verifications/22-idle-seats/idleClients.ts'), String(boot.port), String(IDLE_TIMEOUT_SECONDS)], { cwd: serverDir });
  transcript.push(`$ tsx idleClients.ts ${boot.port} ${IDLE_TIMEOUT_SECONDS} (exit ${clients.code})\n${clients.output}`);
  const summaryLine = clients.stdout.split('\n').find((line) => line.startsWith('{'));
  const summary = summaryLine ? JSON.parse(summaryLine) : null;
  results.push(check('the test clients ran to the end', clients.code === 0 && summary !== null));
  if (summary) {
    const { idler, walker, rejoin } = summary;
    results.push(check('the idle client was closed with code 4100 and reason "idle"', idler.leftWith.code === 4100 && idler.leftWith.reason === 'idle', JSON.stringify(idler.leftWith)));
    results.push(check(`the kick came at the timeout: ${IDLE_TIMEOUT_SECONDS} s after the join, within one second`, idler.kickedAfterSeconds >= IDLE_TIMEOUT_SECONDS - 0.2 && idler.kickedAfterSeconds <= IDLE_TIMEOUT_SECONDS + 1, `${idler.kickedAfterSeconds} s`));
    results.push(check('the client that kept sending moves was still seated when the idle one was kicked, and still seated twice the timeout after its own join', walker.stillSeatedWhenIdlerKicked === true && walker.stillSeatedTwiceTheTimeout === true && walker.secondsSeatedWhileMoving > IDLE_TIMEOUT_SECONDS * 1.5, `${walker.secondsSeatedWhileMoving} s`));
    results.push(check("the kicked player's avatar left the world: player/leave reached the sim", idler.avatarGoneForWalker === true));
    results.push(check('the kicked client rejoined and got its seat back, and the survivor sees two players again', rejoin.slot === idler.slot && rejoin.seatsTakenAfter === 2, `slot ${rejoin.slot}, ${rejoin.seatsTakenAfter} players seen`));
    results.push(check('once the playing client stopped, it was kicked too, measured from its last move, not from its join', walker.leftWith.code === 4100 && walker.kickedAfterLastMoveSeconds >= IDLE_TIMEOUT_SECONDS - 0.2 && walker.kickedAfterLastMoveSeconds <= IDLE_TIMEOUT_SECONDS + 1, `${walker.kickedAfterLastMoveSeconds} s after its last move`));
    results.push(check('every delta the survivors applied chained', summary.allApplied === true));
  }
  writeProof('02-idle-kick.json', { boot: { ...boot, seed: '<random>' }, summary });
}

server.kill('SIGTERM');
const exitCode = await new Promise((resolve) => server.on('exit', (code, signal) => resolve(code ?? signal)));
transcript.push(`server output:\n${serverOutput}`);
const stoppingLine = serverOutput.split('\n').find((line) => line.includes('world-room-stopping'));
const stopping = stoppingLine ? JSON.parse(stoppingLine.slice(stoppingLine.indexOf('{'))) : null;
const kickLines = serverOutput.split('\n').filter((line) => line.includes('world-room-idle-kick'));
results.push(check('SIGTERM stops the server cleanly', exitCode === 0 && stopping !== null, String(exitCode)));
results.push(check('the server logged one idle-kick line per kick and counts them at stop', kickLines.length >= 2 && stopping?.idleSeatsFreed === kickLines.length, `${kickLines.length} kicks, idleSeatsFreed ${stopping?.idleSeatsFreed}`));
writeProof('02-idle-kick-transcript.txt', transcript.join('\n\n'));
process.exit(summarize(results) ? 0 : 1);
