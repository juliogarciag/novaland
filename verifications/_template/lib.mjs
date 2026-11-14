import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const PROOF = path.join(HERE, 'proof');
mkdirSync(PROOF, { recursive: true });

/** Writes a proof file. Absolute paths under the repo are relativised so proof is machine-independent. */
export function writeProof(name, data) {
  const file = path.join(PROOF, name);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  writeFileSync(file, text.split(ROOT).join('<repo>'));
  return file;
}

/** Starts a long-running command in its own process group, so `stop()` takes its children too, also when this script dies. */
export function start(command, args, { cwd = ROOT, env = {} } = {}) {
  stopEverythingOnExit();
  // No colours: the scripts look for plain text, such as a ready line, in what the command prints.
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: undefined }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const server = {
    get output() {
      return output;
    },
    stop() {
      runningServers.delete(server);
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
  runningServers.add(server);
  return server;
}

export async function waitForPort(port, timeoutMs = 20000) {
  return waitFor(`port ${port}`, { read: () => isPortOpen(port), until: Boolean, timeoutMs }).catch(() => false);
}

/** Polls `read` until `until` holds for what it returned, and returns that. Throws on timeout, naming `what`. */
export async function waitFor(what, { read, until, timeoutMs = 8000 }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (until(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${what} (last: ${String(JSON.stringify(last)).slice(0, 200)})`);
}

/** The end of what a command printed, on one line and without stack frames: why a server did not start. */
export function lastLinesOf(output) {
  const lines = output.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('    at '));
  return lines.slice(-5).join(' | ');
}

/** Prints one PASS/FAIL line and returns the result for the report. */
export function check(name, pass, details) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${details ? `  (${details})` : ''}`);
  return { name, pass, details };
}

/** Prints the closing line and says whether every check passed. */
export function summarize(results) {
  const failed = results.filter((result) => !result.pass);
  console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} OF ${results.length} CHECKS FAILED`);
  return failed.length === 0;
}

// ---- Helpers ----

const runningServers = new Set();
let stopOnExitInstalled = false;

function stopEverythingOnExit() {
  if (stopOnExitInstalled) return;
  stopOnExitInstalled = true;
  const stopAll = () => {
    for (const server of runningServers) server.stop();
  };
  process.on('exit', stopAll);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      stopAll();
      process.exit(1);
    });
  }
}

function isPortOpen(port) {
  // Vite binds "localhost", which may be ::1 or 127.0.0.1 depending on the machine.
  const answers = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
    });
  return Promise.all([answers('127.0.0.1'), answers('::1')]).then((answered) => answered.some(Boolean));
}
