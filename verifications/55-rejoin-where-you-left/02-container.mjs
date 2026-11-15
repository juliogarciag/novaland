/**
 * V2: the image on a host that mounts its volume as root, which is what
 * Railway does. `docker build`, then containers of that image against a
 * Docker volume that only root can write:
 *
 * - started as the image's own user (`node`) the server cannot open its store
 *   there and refuses to boot: why such a host has to start the container as
 *   root at all;
 * - started as root (what RAILWAY_RUN_UID=0 does) the entrypoint hands the
 *   volume to `node` and the server itself runs as `node`: no process in the
 *   container is root, the store is on disk, files an earlier root deploy left
 *   are taken over, a link in the volume is not followed;
 * - a player walks in a real browser on the page the container serves, the
 *   container is stopped as a deploy stops it and replaced by a new one on
 *   the same volume, and the player stands where they were.
 *
 * The page is the production build, which has no debug API, so positions are
 * read from the authoritative world by a Node observer (observer.ts).
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { PROOF, ROOT, check, summarize, waitFor, writeProof } from './lib.mjs';

const PORT = 5957;
const IMAGE = 'novaland:55-verify';
const CONTAINER = 'novaland-55-verify';
const VOLUME = 'novaland-55-verify-data';
const BASE = `http://localhost:${PORT}`;
/** A new player's position is kept once they have held a seat this long (NEW_PLAYER_SAVE_AFTER_MS), plus a margin. */
const NEW_PLAYER_WAIT_MS = 11_000;
/** The uid and gid of `node` in the node:alpine image. */
const NODE_UID = '1000';
const results = [];
const transcript = [];
const report = {};
let browser;
let observer;
try {
  const build = docker(['build', '-t', IMAGE, '.']);
  results.push(check('docker build exits 0', build.code === 0, build.code === 0 ? undefined : build.output.split('\n').slice(-8).join(' | ')));
  if (build.code !== 0) throw new Error('no image');
  docker(['rm', '-f', CONTAINER]);
  docker(['volume', 'rm', '-f', VOLUME]);

  // ---- No volume, the image's own user: as before ----
  docker(['run', '-d', '--name', CONTAINER, '-e', `PORT=${PORT}`, '-e', `ALLOWED_ORIGINS=${BASE}`, '-p', `${PORT}:${PORT}`, IMAGE]);
  const plainHealth = await health();
  const plainUser = serverProcess();
  results.push(check('with no volume the container starts as node, the server is PID 1 as node and keeps positions in memory', plainUser.uid === NODE_UID && plainUser.isNode && plainHealth?.savedPositions === 'memory', `${plainUser.summary}, health ${JSON.stringify(plainHealth)}`));
  docker(['rm', '-f', CONTAINER]);

  // ---- A volume only root can write, as Railway mounts one ----
  docker(['volume', 'create', VOLUME]);
  const owner = docker(['run', '--rm', '--user', '0', '--entrypoint', 'stat', '-v', `${VOLUME}:/data`, IMAGE, '-c', '%U:%G %a', '/data']).output.trim();
  results.push(check('a fresh Docker volume belongs to root and nobody else may write it', /^root:root 7[0-5][0-5]$/.test(owner), owner));
  const asNode = docker(['run', '--rm', '-e', `PORT=${PORT}`, '-e', `ALLOWED_ORIGINS=${BASE}`, '-e', 'RAILWAY_VOLUME_MOUNT_PATH=/data', '-v', `${VOLUME}:/data`, IMAGE]);
  results.push(check('started as node on that volume, the server refuses to boot and says the saved positions could not be opened', asNode.code === 1 && /The saved positions could not be opened in \/data/.test(asNode.output), lastLine(asNode.output)));

  // What an earlier deploy that ran the server as root would have left, and a link that must not be followed.
  docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', '-v', `${VOLUME}:/data`, IMAGE, '-c', 'touch /data/saved-positions.sqlite && ln -s /etc/passwd /data/link && mkdir /data/other && touch /data/other/file']);

  // ---- Started as root, as RAILWAY_RUN_UID=0 starts it ----
  startAsRoot();
  const rootedHealth = await health();
  const rootedUser = serverProcess();
  results.push(check('started as root on that volume, the server boots with its positions on disk', rootedHealth?.ok === true && rootedHealth?.savedPositions === 'disk', JSON.stringify(rootedHealth)));
  results.push(check('the server is PID 1 and runs as node: uid, gid and groups are all node, none is root', rootedUser.isNode && rootedUser.uid === NODE_UID && rootedUser.gid === NODE_UID && rootedUser.groups === NODE_UID, rootedUser.summary));
  const everyProcess = docker(['top', CONTAINER, '-eo', 'uid,pid,args']).output.trim();
  const processUids = everyProcess.split('\n').slice(1).map((line) => line.trim().split(/\s+/)[0]);
  results.push(check('no process running in the container is root', processUids.length > 0 && processUids.every((uid) => uid === NODE_UID), everyProcess.split('\n').join(' | ')));
  const owners = docker(['exec', CONTAINER, 'sh', '-c', 'stat -c "%U:%G %n" /data /data/saved-positions.sqlite* /etc/passwd /data/other /data/other/file; stat -c "%U:%G %n (link)" /data/link']).output.trim();
  const ownerLines = owners.split('\n');
  const storeFiles = ownerLines.filter((line) => line.includes('/data/saved-positions.sqlite'));
  results.push(check('the volume, the file the earlier root deploy left and the write-ahead log now belong to node', ownerLines[0] === 'node:node /data' && storeFiles.length >= 2 && storeFiles.every((line) => line.startsWith('node:node ')), [ownerLines[0], ...storeFiles].join(' | ')));
  results.push(check('nothing else was handed over: a link in the volume was not followed (/etc/passwd and the link still belong to root), nor was another directory in it or the file inside', ['root:root /etc/passwd', 'root:root /data/link (link)', 'root:root /data/other', 'root:root /data/other/file'].every((line) => ownerLines.includes(line)), ownerLines.filter((line) => !line.startsWith('node:')).join(' | ')));
  const healthCheck = await waitFor('Docker to run the image health check', { read: () => docker(['inspect', '-f', '{{.State.Health.Status}}', CONTAINER]).output.trim(), until: (status) => status === 'healthy', timeoutMs: 45000 }).catch((error) => error.message);
  results.push(check("Docker's own health check passes through the entrypoint", healthCheck === 'healthy', healthCheck));
  report.startedAsRoot = { health: rootedHealth, serverProcess: rootedUser.summary, processes: everyProcess, owners };

  // ---- A player walks on the page the container serves ----
  browser = await chromium.launch();
  const profile = await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  observer = startObserver();
  await waitFor('the observer to be seated', { read: () => observer.slot, until: (slot) => slot !== undefined, timeoutMs: 20000 });
  let page = await profile.newPage();
  await page.goto(BASE);
  const seatedAt = Date.now();
  const spawned = await waitFor('the page to be seated', { read: () => playerSeenBy(observer), until: Boolean, timeoutMs: 20000 });
  const walked = await walk(page, observer, spawned);
  results.push(check('a browser on the served page is seated and its player walks east', walked.x - spawned.x > 3, `from ${show(spawned)} to ${show(walked)}`));
  await page.screenshot({ path: path.join(PROOF, '09-container-walked.png') });
  await sleep(Math.max(0, NEW_PLAYER_WAIT_MS - (Date.now() - seatedAt)));
  const left = playerSeenBy(observer);
  observer.stop();
  await page.close();

  // ---- The container is stopped as a deploy stops it and replaced ----
  const stopStarted = Date.now();
  docker(['stop', '--time', '10', CONTAINER]);
  const stopSeconds = (Date.now() - stopStarted) / 1000;
  const exitCode = docker(['inspect', '-f', '{{.State.ExitCode}}', CONTAINER]).output.trim();
  const stoppingLine = docker(['logs', CONTAINER]).output.split('\n').find((line) => line.includes('world-room-stopping'));
  results.push(check('docker stop reaches the server: it says it is stopping, exits 0, and well inside the 10 seconds Docker allows', exitCode === '0' && Boolean(stoppingLine) && stopSeconds < 5, `exit ${exitCode} after ${stopSeconds.toFixed(1)} s; ${stoppingLine ?? 'no stopping line'}`));
  transcript.push(`$ docker logs ${CONTAINER} (first container)\n${docker(['logs', CONTAINER]).output}`);
  docker(['rm', '-f', CONTAINER]);

  startAsRoot();
  await health();
  const bootLine = docker(['logs', CONTAINER]).output.split('\n').find((line) => line.includes('world-room-listening'));
  results.push(check('a new container on the same volume finds one saved player on disk in /data', Boolean(bootLine) && bootLine.includes('"savedPlayers":1') && bootLine.includes('"savedPositions":"disk"') && bootLine.includes('"dataDirectory":"/data"'), bootLine?.replace(/"seed":\d+/, '"seed":"<random>"')));
  observer = startObserver();
  await waitFor('the observer to be seated', { read: () => observer.slot, until: (slot) => slot !== undefined, timeoutMs: 20000 });
  page = await profile.newPage();
  await page.goto(BASE);
  const back = await waitFor('the page to be seated again', { read: () => playerSeenBy(observer), until: Boolean, timeoutMs: 20000 });
  results.push(check('the same browser opens the new container and its player stands where they were', Math.hypot(back.x - left.x, back.y - left.y) < 0.01 && back.x - spawned.x > 3, `left at ${show(left)}, back at ${show(back)}`));
  await page.screenshot({ path: path.join(PROOF, '10-container-replaced-same-place.png') });
  const replacement = serverProcess();
  results.push(check('the replacement also runs its server as node', replacement.isNode && replacement.uid === NODE_UID && replacement.gid === NODE_UID && replacement.groups === NODE_UID, replacement.summary));
  report.player = { spawned, left, back };
  transcript.push(`$ docker logs ${CONTAINER} (second container)\n${docker(['logs', CONTAINER]).output}`);
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
  transcript.push(`$ docker logs ${CONTAINER}\n${docker(['logs', CONTAINER]).output}`);
} finally {
  observer?.stop();
  await browser?.close();
  docker(['rm', '-f', CONTAINER]);
  docker(['volume', 'rm', '-f', VOLUME]);
}

const passed = summarize(results);
writeProof('02-container.json', { passed, results, report });
writeProof('02-container-output.txt', transcript.join('\n\n').replace(/"seed":\d+/g, '"seed":"<random>"'));
process.exit(passed ? 0 : 1);

// ---- Helpers ----

function docker(args) {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** The container as Railway starts it on a service with a volume and RAILWAY_RUN_UID=0: as root, the mount path in RAILWAY_VOLUME_MOUNT_PATH. */
function startAsRoot() {
  const started = docker(['run', '-d', '--name', CONTAINER, '--user', '0', '-e', 'RAILWAY_RUN_UID=0', '-e', 'RAILWAY_VOLUME_MOUNT_PATH=/data', '-e', `PORT=${PORT}`, '-e', `ALLOWED_ORIGINS=${BASE}`, '-v', `${VOLUME}:/data`, '-p', `${PORT}:${PORT}`, IMAGE]);
  if (started.code !== 0) throw new Error(`the container did not start: ${lastLine(started.output)}`);
}

async function health() {
  return waitFor('/health to answer', { read: () => fetch(`${BASE}/health`).then((response) => response.json()).catch(() => undefined), until: (body) => body?.ok === true, timeoutMs: 30000 }).catch(() => undefined);
}

/** Who PID 1 of the container is, read from the kernel, not from what the container's shell says about itself. */
function serverProcess() {
  const status = docker(['exec', CONTAINER, 'sh', '-c', 'cat /proc/1/status; echo "Cmdline: $(tr "\\0" " " < /proc/1/cmdline)"']).output;
  const field = (name) => (status.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim();
  // Uid and Gid list real, effective, saved and filesystem ids: all four must be the same one.
  const only = (ids) => (new Set(ids.split(/\s+/)).size === 1 ? ids.split(/\s+/)[0] : `mixed(${ids})`);
  const uid = only(field('Uid'));
  const gid = only(field('Gid'));
  const groups = only(field('Groups'));
  const command = field('Cmdline');
  return { uid, gid, groups, isNode: command.startsWith('node packages/server/dist/index.mjs'), summary: `PID 1 is "${command}" with uid ${uid}, gid ${gid}, groups ${groups}` };
}

/** Joins the world from Node and reports every player's position (observer.ts). */
function startObserver() {
  const child = spawn('pnpm', ['exec', 'tsx', path.join(ROOT, 'verifications/55-rejoin-where-you-left/observer.ts'), `ws://localhost:${PORT}`], { cwd: path.join(ROOT, 'packages/server'), stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { slot: undefined, latest: undefined, stop: () => child.kill('SIGTERM') };
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      const event = JSON.parse(line);
      if (event.event === 'welcomed') state.slot = event.slot;
      if (event.event === 'world') state.latest = event;
    }
  });
  return state;
}

/** The one player in the world that is not the observer: the page's. */
function playerSeenBy(state) {
  const player = state.latest?.players.find((candidate) => candidate.slot !== state.slot);
  return player && { x: player.x, y: player.y };
}

/** Holds D until the player is well east of `from`, then waits for it to stand still. The first key press can be lost while the page takes focus, so it is retried. */
async function walk(page, state, from) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.click('canvas');
    await page.keyboard.down('d');
    await sleep(1500);
    await page.keyboard.up('d');
    if ((playerSeenBy(state)?.x ?? from.x) - from.x > 3) break;
  }
  let previous;
  return waitFor('the player to stand still', {
    read: async () => {
      const before = playerSeenBy(state);
      await sleep(300);
      previous = before;
      return playerSeenBy(state);
    },
    until: (now) => now !== undefined && previous !== undefined && now.x === previous.x && now.y === previous.y,
  });
}

function show(point) {
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`;
}

function lastLine(output) {
  return output.trim().split('\n').pop();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
