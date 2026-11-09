/**
 * `pnpm dev:online`: the world server and the client together, for local
 * multiplayer play. The client is started with `VITE_SERVER_URL` pointing at
 * the server, so opening its URL joins the shared world.
 *
 *   SERVER_PORT=5118 PORT=5218 pnpm dev:online
 *
 * SERVER_PORT pins the server (default 2567, Colyseus's conventional port);
 * PORT pins the client like `pnpm dev` does (unset, Vite picks a free one);
 * VITE_SERVER_URL overrides the address the client is given (a tunnel, say).
 * Stopping this script (Ctrl-C) stops both; if one of them exits, so does the other.
 */
import { spawn } from 'node:child_process';

const serverPort = process.env.SERVER_PORT ?? '2567';
const serverUrl = process.env.VITE_SERVER_URL ?? `ws://localhost:${serverPort}`;

const serverEnv = { ...process.env, PORT: serverPort };
const clientEnv = { ...process.env, VITE_SERVER_URL: serverUrl };
delete serverEnv.SERVER_PORT;
delete clientEnv.SERVER_PORT;

const children = [
  start('server', ['--filter', '@novaland/server', 'dev'], serverEnv),
  start('client', ['--filter', '@novaland/client', 'dev'], clientEnv),
];

let stopping = false;
function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Each child is its own process group, so pnpm's own children (tsx, vite) go with it.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(exitCode), 200).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stopAll(0));

function start(name, args, env) {
  const child = spawn('pnpm', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const prefix = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.length > 0) process.stdout.write(`[${name}] ${line}\n`);
    }
  };
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code, signal) => {
    process.stdout.write(`[${name}] exited (${signal ?? code})\n`);
    stopAll(code ?? 0);
  });
  return child;
}
