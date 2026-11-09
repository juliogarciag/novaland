/** V2: Node test clients against the real server process started the way the human starts it. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const serverDir = path.join(ROOT, 'packages/server');
const results = [];
const transcript = [];

// Boot the server exactly as `PORT=<n> pnpm --filter @novaland/server dev` does, on a free port (0) so the run never collides with a dev server.
const server = spawn('pnpm', ['--filter', '@novaland/server', 'dev'], { cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  results.push(check('the server boots and reports its port, room id and seed', boot.roomId === 'world' && boot.port > 0 && Number.isInteger(boot.seed) && boot.seats === 5, JSON.stringify(boot)));
  const clients = await run('pnpm', ['exec', 'tsx', path.join(ROOT, 'verifications/17-world-room/clients.ts'), String(boot.port)], { cwd: serverDir });
  transcript.push(`$ tsx clients.ts ${boot.port} (exit ${clients.code})\n${clients.output}`);
  const summaryLine = clients.stdout.split('\n').find((line) => line.startsWith('{'));
  const summary = summaryLine ? JSON.parse(summaryLine) : null;
  results.push(check('the test clients ran to the end', clients.code === 0 && summary !== null));
  if (summary) {
    results.push(check('five players joined by id and got seats 0..4', JSON.stringify(summary.slots) === '[0,1,2,3,4]'));
    results.push(check("the last welcome already holds every player's entity", summary.everyoneInLastWelcome === true));
    results.push(check('every player saw every other player move, and all five replicas agree', summary.everyoneSeesEveryoneMove === true && summary.replicasAgree === true));
    results.push(check('the sixth join was refused because the room is locked (full)', summary.refusal?.code === 522 && /locked/.test(summary.refusal?.message ?? ''), `${summary.refusal?.code} ${summary.refusal?.message}`));
    results.push(check('create / join / joinOrCreate / reconnect are not exposed', Object.keys(summary.otherMethods).length === 4 && Object.values(summary.otherMethods).every((message) => /invalid method/.test(message))));
    results.push(check("a leaver's seat was freed, its avatar vanished for the others, the next joiner took the seat", summary.leaver.avatarGone === true && summary.leaver.newcomerSlot === summary.leaver.slot));
    results.push(check('oversized, unknown, slot-carrying and malformed messages were dropped: neither the sender nor the named slot moved', summary.junk.junkDropped === true, `${summary.junk.senderIntent} ${summary.junk.targetIntent}`));
    results.push(check('a move flood was absorbed: the world kept running and nobody was disconnected', summary.junk.worldKeptRunning === true, `${summary.junk.flood} moves`));
    results.push(check('a frame over the transport limit closed only its own connection (1009)', summary.junk.oversizedCloseCode === 1009));
    results.push(check('every delta chained: no replica ever reported out-of-sequence or malformed', summary.chained.every((player) => player.applied)));
    results.push(check('deltas stay small next to the welcome', summary.deltaBytes.max < summary.welcomeBytes / 4, `deltas ${summary.deltaBytes.min}-${summary.deltaBytes.max} bytes, welcome ${summary.welcomeBytes} bytes`));
  }
  writeProof('02-room-clients.json', { boot: { ...boot, seed: '<random>' }, summary });
}

server.kill('SIGTERM');
const exitCode = await new Promise((resolve) => server.on('exit', (code, signal) => resolve(code ?? signal)));
transcript.push(`server output:\n${serverOutput}`);
results.push(check('SIGTERM stops the server cleanly', exitCode === 0 && serverOutput.includes('world-room-stopping'), String(exitCode)));
writeProof('02-room-clients-transcript.txt', transcript.join('\n\n'));
process.exit(summarize(results) ? 0 : 1);
