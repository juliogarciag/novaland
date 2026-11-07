import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const PROOF = path.join(HERE, 'proof');
mkdirSync(PROOF, { recursive: true });

export function writeProof(name, data) {
  const file = path.join(PROOF, name);
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  return file;
}

/** Runs a command to completion, capturing output. Never throws; returns { code, output }. */
export function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** Starts a long-running command in its own process group so it can be killed with its children. */
export function start(cmd, args, { cwd = ROOT, env = {} } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return {
    child,
    get output() {
      return output;
    },
    stop() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
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
