import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
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

/** Child env: `undefined` values remove the variable instead of passing the string "undefined". */
function childEnv(env) {
  const merged = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/** Runs a command to completion. Never throws; returns { code, stdout, stderr, output }. */
export function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
}

const running = new Set();
let cleanupInstalled = false;

function installCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const stopAll = () => {
    for (const server of running) server.stop();
  };
  process.on('exit', stopAll);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      stopAll();
      process.exit(1);
    });
  }
}

/** Starts a long-running command in its own process group so it can be killed with its children, also on abnormal exit. */
export function start(cmd, args, { cwd = ROOT, env = {} } = {}) {
  installCleanup();
  const child = spawn(cmd, args, { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const handle = {
    child,
    get output() {
      return output;
    },
    stop() {
      running.delete(handle);
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
  running.add(handle);
  return handle;
}

export function isPortOpen(port) {
  // Vite binds "localhost", which may be ::1 or 127.0.0.1 depending on the machine.
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

export async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Holds a TCP port open (to prove something else avoids it). Returns a function that releases it. */
export function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, 'localhost', () => resolve(() => new Promise((r) => server.close(r))));
  });
}

export function check(name, pass, details) {
  const line = `${pass ? 'PASS' : 'FAIL'}  ${name}${details ? `  (${details})` : ''}`;
  console.log(line);
  return { name, pass, details };
}

export function summarize(results) {
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} OF ${results.length} CHECKS FAILED`);
  return failed.length === 0;
}
