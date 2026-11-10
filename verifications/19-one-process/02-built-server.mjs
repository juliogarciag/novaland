/* global window */
/**
 * V2: `pnpm build` then `PORT=<n> pnpm start`, with no VITE_SERVER_URL anywhere:
 * the built server serves the built client and the world room on that one
 * port, a production page connects to its own origin and gets a seat (seen
 * from a Node observer of the world), the dev debug API is gone, the health
 * check answers, a foreign-origin upgrade is refused while a same-origin one
 * is taken, and the dev flow still works: a Vite dev client on another
 * loopback port joins the built server with nothing configured. A bad
 * ALLOWED_ORIGINS stops the boot.
 *
 * Rapier loads on demand: the page's bundle carries no physics WASM, the
 * production page (which only holds a replica) never requests the Rapier
 * chunk, and a solo dev page still loads it and runs its own sim. (Vite dev
 * pre-bundles Rapier, so that page proves solo still works, not the split.)
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, run, start, summarize, waitForPort, writeProof } from './lib.mjs';
import { openPlayer, othersSeenBy, rawStatus, startObserver, upgradeStatus, waitFor, waitSeated } from './browser.mjs';

const SERVER_PORT = 5420;
const DEV_CLIENT_PORT = 5421;
const SOLO_CLIENT_PORT = 5422;
const results = [];
const transcript = [];
const report = {};
let server;
let devClient;
let soloClient;
let observer;
let browser;
try {
  const build = await run('pnpm', ['build']);
  transcript.push(`$ pnpm build (exit ${build.code})\n${build.output}`);
  results.push(check('pnpm build exits 0 and writes packages/client/dist/index.html and packages/server/dist/index.mjs', build.code === 0 && exists('packages/client/dist/index.html') && exists('packages/server/dist/index.mjs')));
  const indexHtml = readFileSync(path.join(ROOT, 'packages/client/dist/index.html'), 'utf8');
  const assetPaths = [...indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
  results.push(check('the built index.html references its bundle by an absolute /assets/ path', assetPaths.length > 0 && assetPaths.every((assetPath) => assetPath.startsWith('/assets/')), assetPaths.join(', ')));
  const builtAssets = readdirSync(path.join(ROOT, 'packages/client/dist/assets')).map((name) => ({ name, bytes: readFileSync(path.join(ROOT, 'packages/client/dist/assets', name)).byteLength }));
  const rapierChunks = builtAssets.filter((asset) => /^rapier-.*\.js$/.test(asset.name));
  const pageBundles = assetPaths.map((assetPath) => readFileSync(path.join(ROOT, 'packages/client/dist', assetPath), 'utf8'));
  const longestInlineBinary = Math.max(0, ...pageBundles.flatMap((bundle) => [...bundle.matchAll(/[A-Za-z0-9+/=]{20000,}/g)].map((match) => match[0].length)));
  results.push(check('Rapier is a chunk of its own that index.html does not reference, and the bundle the page loads inlines no WASM', rapierChunks.length === 1 && !assetPaths.some((assetPath) => assetPath.includes('rapier')) && longestInlineBinary === 0, JSON.stringify({ builtAssets, pageAssets: assetPaths, longestInlineBinary })));
  report.builtAssets = builtAssets;

  // The built server, started the way the host would (pnpm start → node dist/index.mjs), with nothing but PORT.
  server = start('pnpm', ['start'], { env: { PORT: String(SERVER_PORT), VITE_SERVER_URL: undefined, ALLOWED_ORIGINS: undefined, CLIENT_DIR: undefined } });
  results.push(check(`PORT=${SERVER_PORT} pnpm start listens`, await waitForPort(SERVER_PORT)));
  const bootLine = await waitFor(() => server.output.split('\n').find((line) => line.includes('world-room-listening')), (line) => line !== undefined, 'the boot line');
  const boot = JSON.parse(bootLine.slice(bootLine.indexOf('{')));
  results.push(check('the boot line names the client directory it serves and an empty allow-list', boot.port === SERVER_PORT && /packages\/client\/dist$/.test(boot.clientDirectory ?? '') && Array.isArray(boot.allowedOrigins) && boot.allowedOrigins.length === 0, JSON.stringify({ ...boot, seed: '<random>' })));

  const base = `http://localhost:${SERVER_PORT}`;
  const health = await fetch(`${base}/healthz`);
  const healthBody = await health.json();
  results.push(check('/healthz answers 200 with ok, the room id, the seats and the tick', health.status === 200 && healthBody.ok === true && healthBody.roomId === 'world' && healthBody.seats === 5 && Number.isInteger(healthBody.tick), JSON.stringify(healthBody)));
  const index = await fetch(`${base}/`);
  const indexHeaders = Object.fromEntries(index.headers.entries());
  results.push(check('/ is the built index.html with nosniff, a CSP, DENY framing and no long cache', index.status === 200 && /text\/html/.test(indexHeaders['content-type']) && indexHeaders['x-content-type-options'] === 'nosniff' && /default-src 'self'/.test(indexHeaders['content-security-policy'] ?? '') && indexHeaders['x-frame-options'] === 'DENY' && indexHeaders['cache-control'] === 'no-cache' && (await index.text()) === indexHtml));
  const assets = [];
  for (const assetPath of assetPaths) {
    const response = await fetch(`${base}${assetPath}`);
    assets.push({ path: assetPath, status: response.status, contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'), bytes: (await response.arrayBuffer()).byteLength });
  }
  results.push(check('every asset the page references is served as JavaScript, immutable for a year, with its full size', assets.every((asset) => asset.status === 200 && /text\/javascript/.test(asset.contentType) && asset.cacheControl === 'public, max-age=31536000, immutable' && asset.bytes > 100000), JSON.stringify(assets)));
  const spriteNames = readdirSync(path.join(ROOT, 'packages/client/dist/sprites')).filter((name) => name.endsWith('.png'));
  const sprites = [];
  for (const name of spriteNames) {
    const response = await fetch(`${base}/sprites/${name}`);
    sprites.push({ name, status: response.status, contentType: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength });
  }
  results.push(check(`every sprite the build ships is served as image/png (${spriteNames.length}: ${spriteNames.join(', ')})`, spriteNames.length > 0 && sprites.every((sprite) => sprite.status === 200 && sprite.contentType === 'image/png' && sprite.bytes > 0), JSON.stringify(sprites.filter((sprite) => sprite.status !== 200))));
  const traversal = { dotdot: await rawStatus(SERVER_PORT, '/../package.json'), encoded: await rawStatus(SERVER_PORT, '/assets/..%2f..%2f..%2fpackage.json'), dotfile: await rawStatus(SERVER_PORT, '/.env') };
  results.push(check('a path cannot leave the client directory, and dotfiles are not served', Object.values(traversal).every((status) => status !== 200), JSON.stringify(traversal)));
  const upgrades = { foreign: await upgradeStatus(SERVER_PORT, 'https://evil.example.com'), sameOrigin: await upgradeStatus(SERVER_PORT, base), noOrigin: await upgradeStatus(SERVER_PORT, undefined) };
  results.push(check('a WebSocket upgrade from a foreign origin is refused with 403; same origin and no origin are taken (101)', upgrades.foreign === 403 && upgrades.sameOrigin === 101 && upgrades.noOrigin === 101, JSON.stringify(upgrades)));
  const foreignMatchmake = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
  results.push(check('a matchmaking preflight from a foreign origin is refused with 403 and no CORS headers', foreignMatchmake.status === 403 && foreignMatchmake.headers.get('access-control-allow-origin') === null));
  report.boot = { ...boot, seed: '<random>' };
  report.health = healthBody;
  report.indexHeaders = indexHeaders;
  report.assets = assets;
  report.sprites = sprites;
  report.traversal = traversal;
  report.upgrades = upgrades;

  // A production page served by the process joins the process's own world: the observer sees it seated, and the page has no debug API.
  observer = startObserver(`ws://127.0.0.1:${SERVER_PORT}`);
  await waitFor(() => observer.latest, (latest) => latest !== undefined, 'the observer to be welcomed', 30000);
  browser = await chromium.launch();
  const production = await openPlayer(browser, 'production page', `${base}/`);
  const seated = await waitSeated(production.page);
  const seenByObserver = await waitFor(() => othersSeenBy(observer), (players) => players.length === 1, 'the observer to see the page seated');
  await production.page.waitForTimeout(500);
  await production.page.screenshot({ path: path.join(PROOF, '02-built-server-production-page.png') });
  results.push(check('a page served by the built process, with no VITE_SERVER_URL, joins the world on its own origin: the screen is hidden, the canvas draws, the observer sees a seated player', seated.screen === null && seated.canvas && seenByObserver.length === 1, JSON.stringify({ seated, seenByObserver })));
  results.push(check('the production page has no window.__novaland', seated.hasDebugApi === false));
  const pageResponses = production.responses.map((response) => ({ url: response.url.replace(base, ''), status: response.status }));
  results.push(check('every request the page made to its origin succeeded (no missing asset, no wrong path)', production.failedResponses.length === 0 && pageResponses.some((response) => response.url.startsWith('/assets/')), JSON.stringify(production.failedResponses.length ? production.failedResponses : pageResponses)));
  results.push(check('the production page never requests the Rapier chunk: a replica needs no physics', !pageResponses.some((response) => response.url.includes('rapier')), JSON.stringify(pageResponses.map((response) => response.url))));
  results.push(check('no console errors and no page errors on the production page (the CSP lets the bundle run)', production.consoleErrors.length === 0 && production.pageErrors.length === 0, JSON.stringify([...production.consoleErrors, ...production.pageErrors])));
  report.productionPage = { seated, seenByObserver, responses: pageResponses, consoleErrors: production.consoleErrors, pageErrors: production.pageErrors };

  // The dev flow: a Vite dev client on another loopback port, pointed at the built server, still joins with nothing configured (loopback to loopback).
  devClient = start('pnpm', ['dev'], { env: { PORT: String(DEV_CLIENT_PORT), VITE_SERVER_URL: base } });
  results.push(check(`a Vite dev client on ${DEV_CLIENT_PORT} with VITE_SERVER_URL=${base} starts`, await waitForPort(DEV_CLIENT_PORT)));
  const dev = await openPlayer(browser, 'dev page', `http://localhost:${DEV_CLIENT_PORT}/`);
  const devSeated = await waitSeated(dev.page);
  const devStatus = await dev.page.evaluate(() => window.__novaland?.online?.status());
  await waitFor(() => othersSeenBy(observer), (players) => players.length === 2, 'the observer to see both pages seated');
  results.push(check('the dev page on another loopback port is online against the built server (same-origin check lets loopback reach loopback) and keeps its debug API', devSeated.screen === null && devSeated.hasDebugApi === true && devStatus?.kind === 'online', JSON.stringify({ devSeated, devStatus })));
  results.push(check('no console errors on the dev page', dev.consoleErrors.length === 0 && dev.pageErrors.length === 0, JSON.stringify([...dev.consoleErrors, ...dev.pageErrors])));
  report.devPage = { devSeated, devStatus, consoleErrors: dev.consoleErrors, pageErrors: dev.pageErrors };
  await production.context.close();
  await dev.context.close();

  // Solo is unchanged: a dev client with no server loads Rapier on demand and runs its own sim, where a walk moves the player.
  soloClient = start('pnpm', ['dev'], { env: { PORT: String(SOLO_CLIENT_PORT), VITE_SERVER_URL: undefined } });
  results.push(check(`a solo Vite dev client on ${SOLO_CLIENT_PORT} with no VITE_SERVER_URL starts`, await waitForPort(SOLO_CLIENT_PORT)));
  const solo = await openPlayer(browser, 'solo page', `http://localhost:${SOLO_CLIENT_PORT}/`);
  await solo.page.waitForFunction(() => window.__novaland?.camera() !== undefined && window.__novaland.snapshot().entities.some((entity) => entity.components.Player), undefined, { timeout: 30000 });
  const soloBefore = await solo.page.evaluate(() => ({ online: window.__novaland.online !== undefined, playerX: window.__novaland.snapshot().entities.find((entity) => entity.components.Player).components.Position.x }));
  await solo.page.keyboard.down('KeyD');
  await solo.page.waitForTimeout(800);
  await solo.page.keyboard.up('KeyD');
  const soloAfter = await solo.page.evaluate(() => window.__novaland.snapshot().entities.find((entity) => entity.components.Player).components.Position.x);
  await solo.page.screenshot({ path: path.join(PROOF, '02-built-server-solo-page.png') });
  const soloRapier = solo.responses.filter((response) => response.url.includes('rapier')).map((response) => ({ url: response.url.replace(`http://localhost:${SOLO_CLIENT_PORT}`, ''), status: response.status }));
  results.push(check('the solo dev page loads Rapier, runs its own sim (not online) and walking right moves the player right', soloBefore.online === false && soloRapier.length > 0 && soloRapier.every((response) => response.status === 200) && soloAfter > soloBefore.playerX + 0.5, JSON.stringify({ soloBefore, soloAfter, soloRapier })));
  results.push(check('no console errors on the solo page', solo.consoleErrors.length === 0 && solo.pageErrors.length === 0, JSON.stringify([...solo.consoleErrors, ...solo.pageErrors])));
  report.soloPage = { soloBefore, soloAfter, soloRapier, consoleErrors: solo.consoleErrors, pageErrors: solo.pageErrors };
  await solo.context.close();

  // A malformed allow-list stops the boot.
  const badBoot = await run('node', ['packages/server/dist/index.mjs'], { env: { PORT: '0', ALLOWED_ORIGINS: 'play.example.com' } });
  results.push(check('ALLOWED_ORIGINS with a bare host (no scheme) stops the boot with a message naming the variable', badBoot.code === 1 && /ALLOWED_ORIGINS must list origins/.test(badBoot.output), badBoot.output.trim()));
  const missingClient = await run('node', ['packages/server/dist/index.mjs'], { env: { PORT: '0', CLIENT_DIR: '/nonexistent/client' } });
  results.push(check('a CLIENT_DIR without an index.html stops the boot', missingClient.code === 1 && /CLIENT_DIR/.test(missingClient.output), missingClient.output.trim()));
  report.badBoots = { allowedOrigins: badBoot.output.trim(), clientDir: missingClient.output.trim() };
} catch (error) {
  results.push(check(`script ran to the end`, false, String(error?.stack ?? error)));
} finally {
  if (browser) await browser.close();
  observer?.stop();
  devClient?.stop();
  soloClient?.stop();
  server?.stop();
}
transcript.push(`server output:\n${server?.output ?? ''}`);
transcript.push(`observer output (last lines):\n${(observer?.output ?? '').split('\n').slice(-5).join('\n')}`);
writeProof('02-built-server.json', report);
writeProof('02-built-server-output.txt', transcript.join('\n\n'));
process.exit(summarize(results) ? 0 : 1);

function exists(relative) {
  try {
    readFileSync(path.join(ROOT, relative));
    return true;
  } catch {
    return false;
  }
}
