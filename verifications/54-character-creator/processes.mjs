/** Process helpers this ticket's scripts need on top of the template's lib: a command run to completion, and whether a port answers. */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { ROOT } from './lib.mjs';

/** Runs a command to completion. Never throws; resolves with its exit code and everything it printed. */
export function run(command, args, { cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, output: stdout + stderr }));
  });
}

/** True when something listens on `port`. Vite binds "localhost", which may be ::1 or 127.0.0.1 depending on the machine. */
export function isPortOpen(port) {
  const answers = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
    });
  return Promise.all([answers('127.0.0.1'), answers('::1')]).then((answered) => answered.some(Boolean));
}
