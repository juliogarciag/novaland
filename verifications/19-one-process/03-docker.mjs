/**
 * V3: the image. `docker build` at the repository root, `docker run` with
 * only PORT, then from the served URL in Chromium: two browser contexts get
 * seats and each one's key presses move its avatar in the authoritative world
 * (seen through a Node observer) while the other page receives the deltas
 * that carry the movement; /health answers and Docker's own health check
 * turns healthy; the bundle and the sprites are served with correct paths;
 * window.__novaland is absent; no console errors (the CSP lets the game run);
 * the process runs as `node` with production dependencies only; a foreign
 * origin cannot open the socket; `docker stop` ends it at once.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, run, summarize, writeProof } from './lib.mjs';
import { framesBetween, mean, openPlayer, othersSeenBy, rawStatusLine, requestsColyseusCannotSurvive, startObserver, upgradeStatus, waitFor, waitSeated, walk, writeAndHangUp } from './browser.mjs';

const PORT = 5419;
const IMAGE = 'novaland:19-verify';
const CONTAINER = 'novaland-19-verify';
const results = [];
const transcript = [];
const report = {};
let observer;
let browser;
let containerStarted = false;
try {
  const build = await run('docker', ['build', '-t', IMAGE, '.']);
  transcript.push(`$ docker build -t ${IMAGE} . (exit ${build.code})\n${build.output.split('\n').slice(-30).join('\n')}`);
  results.push(check('docker build exits 0', build.code === 0));
  await run('docker', ['rm', '-f', CONTAINER]);
  const base = `http://localhost:${PORT}`;
  // The image is production: without the origin players open, it must refuse to start.
  const unconfigured = await run('docker', ['run', '--rm', '-e', `PORT=${PORT}`, IMAGE]);
  transcript.push(`$ docker run --rm -e PORT=${PORT} ${IMAGE} (exit ${unconfigured.code})\n${unconfigured.output}`);
  results.push(check('docker run without ALLOWED_ORIGINS exits 1 and says what to set', unconfigured.code === 1 && /ALLOWED_ORIGINS must name the origin players open/.test(unconfigured.output), unconfigured.output.trim()));
  const started = await run('docker', ['run', '-d', '--rm', '--name', CONTAINER, '-e', `PORT=${PORT}`, '-e', `ALLOWED_ORIGINS=${base}`, '-p', `${PORT}:${PORT}`, IMAGE]);
  transcript.push(`$ docker run -d --rm --name ${CONTAINER} -e PORT=${PORT} -e ALLOWED_ORIGINS=${base} -p ${PORT}:${PORT} ${IMAGE} (exit ${started.code})\n${started.output}`);
  containerStarted = started.code === 0;
  results.push(check(`docker run with PORT=${PORT} and ALLOWED_ORIGINS=${base} starts`, containerStarted));
  const health = await waitFor(() => fetch(`${base}/health`).then((response) => response.json()).catch(() => undefined), (body) => body?.ok === true, '/health to answer', 30000);
  results.push(check('/health answers from the container', health.ok === true && health.roomId === 'world' && health.seats === 5, JSON.stringify(health)));
  const logs = await run('docker', ['logs', CONTAINER]);
  const bootLine = logs.output.split('\n').find((line) => line.includes('world-room-listening'));
  const boot = bootLine ? JSON.parse(bootLine.slice(bootLine.indexOf('{'))) : undefined;
  results.push(check('the container boot line serves /app/packages/client/dist, allows only the origin it was told and no loopback pages', boot?.port === PORT && boot?.clientDirectory === '/app/packages/client/dist' && JSON.stringify(boot?.allowedOrigins) === JSON.stringify([base]) && boot?.loopbackOrigins === false, bootLine));
  report.boot = boot ? { ...boot, seed: '<random>' } : undefined;
  report.health = health;

  const inside = await run('docker', ['exec', CONTAINER, 'sh', '-c', 'whoami; echo NODE_ENV=$NODE_ENV; node --version; echo "server deps: $(ls packages/server/node_modules packages/server/node_modules/@colyseus | tr "\\n" " ")"; echo "store: $(ls node_modules/.pnpm | sed "s/@[0-9].*//" | sort -u | tr "\\n" " ")"; echo "files: $(ls packages packages/client/dist packages/server/dist | tr "\\n" " ")"']);
  transcript.push(`$ docker exec ${CONTAINER} sh -c ... (exit ${inside.code})\n${inside.output}`);
  const serverDeps = inside.output.split('\n').find((line) => line.startsWith('server deps:')) ?? '';
  const store = inside.output.split('\n').find((line) => line.startsWith('store:')) ?? '';
  results.push(check('the process runs as the unprivileged node user, NODE_ENV=production, Node 24', /^node\n/.test(inside.output) && /NODE_ENV=production/.test(inside.output) && /v24\./.test(inside.output), inside.output.split('\n').slice(0, 3).join(' | ')));
  results.push(check('the runtime image holds the server runtime dependencies (Colyseus core, transport, express, helmet, compression) and no build tools: no vite, tsx, vitest or phaser in the store (typescript is a peer of @colyseus/schema)', /core/.test(serverDeps) && /ws-transport/.test(serverDeps) && /express/.test(serverDeps) && /helmet/.test(serverDeps) && /compression/.test(serverDeps) && !/@novaland/.test(serverDeps) && !/\b(vite|tsx|vitest|phaser)\b/.test(store), `${serverDeps} || ${store}`));
  report.inside = inside.output;

  const spriteListing = await run('docker', ['exec', CONTAINER, 'ls', 'packages/client/dist/sprites']);
  const spriteNames = spriteListing.stdout.split('\n').filter((name) => name.endsWith('.png'));
  const sprites = [];
  for (const name of spriteNames) {
    const response = await fetch(`${base}/sprites/${name}`);
    sprites.push({ name, status: response.status, contentType: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength });
  }
  results.push(check(`the container serves every sprite in its client build as image/png (${spriteNames.length}: ${spriteNames.join(', ')})`, spriteNames.length >= 8 && sprites.every((sprite) => sprite.status === 200 && sprite.contentType === 'image/png' && sprite.bytes > 0), JSON.stringify(sprites.filter((sprite) => sprite.status !== 200))));
  report.sprites = sprites;

  const upgrades = {
    foreign: await upgradeStatus(PORT, 'https://evil.example.com'),
    reboundDomain: await upgradeStatus(PORT, `http://rebound.example.net:${PORT}`, `rebound.example.net:${PORT}`),
    otherLoopbackPage: await upgradeStatus(PORT, 'http://localhost:5218'),
    listedBehindProxy: await upgradeStatus(PORT, base, 'internal:8080'),
  };
  results.push(check('from the container: a WebSocket upgrade is refused with 403 from a foreign origin, from a domain pointed at the server (Origin equal to its own Host) and from another loopback page; the listed origin is taken whatever Host a proxy presents', upgrades.foreign === 403 && upgrades.reboundDomain === 403 && upgrades.otherLoopbackPage === 403 && upgrades.listedBehindProxy === 101, JSON.stringify(upgrades)));
  report.upgrades = upgrades;
  const hostile = [];
  for (const [what, lines] of requestsColyseusCannotSurvive(PORT)) hostile.push({ what, answer: await rawStatusLine(PORT, lines) });
  const aliveAfterHostile = await fetch(`${base}/health`).then((response) => response.status, () => 'down');
  const stillRunning = await run('docker', ['inspect', '--format', '{{.State.Running}}', CONTAINER]);
  results.push(check('the container answers 400 to every request that ends a bare Colyseus process, and is still running after all of them', hostile.every((request) => request.answer === 'HTTP/1.1 400 Bad Request') && aliveAfterHostile === 200 && stillRunning.output.trim() === 'true', JSON.stringify({ hostile, aliveAfterHostile, running: stillRunning.output.trim() })));
  report.hostile = hostile;

  // The three ways a client left files or sockets open for good, replayed against the container: its open descriptors come back to where they were.
  const openDescriptors = async () => Number((await run('docker', ['exec', CONTAINER, 'sh', '-c', 'ls /proc/1/fd | wc -l'])).stdout.trim());
  const assetListing = await run('docker', ['exec', CONTAINER, 'ls', 'packages/client/dist/assets']);
  const largeAsset = `/assets/${assetListing.stdout.split('\n').find((name) => name.startsWith('rapier-'))}`;
  const descriptorsBefore = await openDescriptors();
  const getLargeAsset = `GET ${largeAsset} HTTP/1.1\r\nHost: localhost:${PORT}\r\nAccept-Encoding: gzip\r\n\r\n`;
  const refusedUpgrade = `GET /world HTTP/1.1\r\nHost: localhost:${PORT}\r\nOrigin: https://evil.example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
  for (let round = 0; round < 5; round += 1) await writeAndHangUp(PORT, { bytes: getLargeAsset.repeat(500), hangUpAfterMs: 300 });
  await Promise.all(Array.from({ length: 200 }, () => writeAndHangUp(PORT, { bytes: `GET / HTTP/1.1\r\n\r\n${getLargeAsset}`, hangUpAfterMs: 300 })));
  await Promise.all(Array.from({ length: 200 }, () => writeAndHangUp(PORT, { bytes: refusedUpgrade, thenWrite: 'x', hangUpAfterMs: 300 })));
  const descriptorsAfter = await waitFor(openDescriptors, (count) => count <= descriptorsBefore + 2, 'the container to close what the attacks opened', 15000).catch(openDescriptors);
  const aliveAfterBursts = await fetch(`${base}/health`).then((response) => response.status, () => 'down');
  results.push(check('the container holds no more open descriptors after 2500 pipelined requests for a large file that hang up, 200 bursts behind a request Node answers itself, and 200 refused upgrades that send more and leave', largeAsset.startsWith('/assets/rapier-') && descriptorsAfter <= descriptorsBefore + 2 && aliveAfterBursts === 200, JSON.stringify({ largeAsset, descriptorsBefore, descriptorsAfter, aliveAfterBursts })));
  report.descriptors = { largeAsset, descriptorsBefore, descriptorsAfter };

  // Two browser contexts, a Node observer as the authoritative witness.
  observer = startObserver(`ws://127.0.0.1:${PORT}`);
  await waitFor(() => observer.latest, (latest) => latest !== undefined, 'the observer to be welcomed', 30000);
  browser = await chromium.launch();
  const a = await openPlayer(browser, 'A', `${base}/`);
  const b = await openPlayer(browser, 'B', `${base}/`);
  const aSeated = await waitSeated(a.page);
  const bSeated = await waitSeated(b.page);
  const both = await waitFor(() => othersSeenBy(observer), (players) => players.length === 2, 'the observer to see two seated pages');
  results.push(check('two browser contexts served by the container are seated in two different seats (observer), screens hidden, canvases drawing', aSeated.screen === null && bSeated.screen === null && aSeated.canvas && bSeated.canvas && new Set(both.map((player) => player.slot)).size === 2, JSON.stringify({ aSeated, bSeated, both })));
  results.push(check('window.__novaland is absent on both pages (production build)', aSeated.hasDebugApi === false && bSeated.hasDebugApi === false));
  await a.page.waitForTimeout(1500); // the drawn frame catches up; the two avatars, spawned on one tile, finish being pushed apart

  // A walks east: the world moves A's avatar; B receives deltas carrying it meanwhile, bigger than the empty ones of a quiet world right after.
  const walkFrom = Date.now();
  const aWalk = await walk(a.page, 'KeyD', { x: 1, y: 0 }, observer);
  const walkTo = Date.now();
  await b.page.screenshot({ path: path.join(PROOF, '03-docker-B-sees-A-after-walk.png') });
  await a.page.screenshot({ path: path.join(PROOF, '03-docker-A-after-walk.png') });
  await b.page.waitForTimeout(1500);
  const quietFrames = framesBetween(b, Date.now() - 1000, Date.now());
  const walkingFrames = framesBetween(b, walkFrom, walkTo);
  results.push(check("holding D on page A moves one player east in the authoritative world: A's avatar", aWalk.start && aWalk.end && aWalk.end.x - aWalk.start.x > 0.5 && Math.abs(aWalk.end.y - aWalk.start.y) < 0.3, JSON.stringify(aWalk)));
  results.push(check(`page B receives world deltas carrying A's movement meanwhile: ${walkingFrames.length} frames of mean ${mean(walkingFrames).toFixed(0)} bytes while A walks, against ${quietFrames.length} frames of mean ${mean(quietFrames).toFixed(0)} bytes once everyone stands still`, walkingFrames.length >= 5 && quietFrames.length >= 5 && mean(walkingFrames) > mean(quietFrames) * 1.3));

  // B walks south: the other seat moves; A receives it.
  const bWalkFrom = Date.now();
  const bWalk = await walk(b.page, 'KeyS', { x: 0, y: 1 }, observer);
  const bWalkTo = Date.now();
  await a.page.waitForTimeout(1500);
  const aQuietFrames = framesBetween(a, Date.now() - 1000, Date.now());
  const aFramesDuringBWalk = framesBetween(a, bWalkFrom, bWalkTo);
  results.push(check("holding S on page B moves the other player south: B's avatar, a different seat from A's", bWalk.slot !== aWalk.slot && bWalk.start && bWalk.end && bWalk.end.y - bWalk.start.y > 0.5, JSON.stringify(bWalk)));
  results.push(check(`page A receives the deltas carrying B's movement (${aFramesDuringBWalk.length} frames of mean ${mean(aFramesDuringBWalk).toFixed(0)} bytes, against ${aQuietFrames.length} quiet frames of mean ${mean(aQuietFrames).toFixed(0)} bytes)`, aFramesDuringBWalk.length >= 5 && aQuietFrames.length >= 5 && mean(aFramesDuringBWalk) > mean(aQuietFrames) * 1.3));
  await a.page.screenshot({ path: path.join(PROOF, '03-docker-A-sees-B-after-walk.png') });
  await b.page.screenshot({ path: path.join(PROOF, '03-docker-B-after-walk.png') });

  const assetResponses = [...a.responses, ...b.responses].map((response) => ({ url: response.url.replace(base, ''), status: response.status, contentType: response.contentType }));
  results.push(check('every asset both pages requested came back 200/304 from the container with a correct path and type (bundle as JavaScript, sprites as PNG)', a.failedResponses.length === 0 && b.failedResponses.length === 0 && assetResponses.some((response) => response.url.startsWith('/assets/') && /javascript/.test(response.contentType)) && assetResponses.some((response) => response.url.startsWith('/sprites/') && /image\/png/.test(response.contentType)), JSON.stringify(a.failedResponses.concat(b.failedResponses))));
  results.push(check('no console errors and no page errors on either page (the CSP lets the game run)', a.consoleErrors.length + a.pageErrors.length + b.consoleErrors.length + b.pageErrors.length === 0, JSON.stringify([...a.consoleErrors, ...a.pageErrors, ...b.consoleErrors, ...b.pageErrors])));
  report.pages = { aSeated, bSeated, both, aWalk, bWalk, quietFrames: { count: quietFrames.length, meanBytes: mean(quietFrames) }, walkingFrames: { count: walkingFrames.length, meanBytes: mean(walkingFrames) }, aQuietFrames: { count: aQuietFrames.length, meanBytes: mean(aQuietFrames) }, aFramesDuringBWalk: { count: aFramesDuringBWalk.length, meanBytes: mean(aFramesDuringBWalk) }, responses: assetResponses.filter((response, index, all) => all.findIndex((other) => other.url === response.url) === index), consoleErrors: [...a.consoleErrors, ...b.consoleErrors], pageErrors: [...a.pageErrors, ...b.pageErrors] };
  await a.context.close();
  await b.context.close();
  await waitFor(() => othersSeenBy(observer), (players) => players.length === 0, 'the seats to be freed when the pages close');
  results.push(check('closing both pages frees their seats (observer sees nobody else)', othersSeenBy(observer).length === 0));

  // Docker's own health check (HEALTHCHECK in the Dockerfile) turns healthy.
  const dockerHealth = await waitFor(() => run('docker', ['inspect', '--format', '{{.State.Health.Status}}', CONTAINER]).then((result) => result.stdout.trim()), (status) => status === 'healthy', "Docker's health status", 90000);
  results.push(check("Docker's HEALTHCHECK reports healthy", dockerHealth === 'healthy', dockerHealth));
  report.dockerHealth = dockerHealth;

  // SIGTERM: docker stop ends the process at once, with its stopping line.
  observer.stop();
  observer = undefined;
  const stopStarted = Date.now();
  const logsBeforeStop = await run('docker', ['logs', CONTAINER]);
  const stopped = await run('docker', ['stop', CONTAINER]);
  const stopSeconds = (Date.now() - stopStarted) / 1000;
  containerStarted = false;
  results.push(check(`docker stop ends the process on SIGTERM in ${stopSeconds.toFixed(1)} s (no 10 s kill)`, stopped.code === 0 && stopSeconds < 5));
  report.stopSeconds = stopSeconds;
  transcript.push(`container logs before stop:\n${logsBeforeStop.output}`);
} catch (error) {
  results.push(check('script ran to the end', false, String(error?.stack ?? error)));
} finally {
  if (browser) await browser.close();
  observer?.stop();
  if (containerStarted) await run('docker', ['stop', CONTAINER]);
}
writeProof('03-docker.json', report);
writeProof('03-docker-output.txt', transcript.join('\n\n'));
process.exit(summarize(results) ? 0 : 1);
