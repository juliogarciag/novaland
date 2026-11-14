/* global document */
/**
 * V4: the built server and the built client (`pnpm build`, `pnpm start`),
 * which is what gets deployed. A production page has no debug hooks, so
 * this only proves what can be seen from outside: the page is seated, it
 * fetches the physics chunk by itself after its own bundle (prediction needs
 * it, ADR 0011), nothing warns that prediction could not start or stopped,
 * the security headers still let the WASM run, and a key press moves the
 * view.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, lastLinesOf, run, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const PORT = 5950;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = {};

const build = await run('pnpm', ['build']);
results.push(check('pnpm build exits 0', build.code === 0, build.code === 0 ? undefined : lastLinesOf(build.output)));
const server = start('pnpm', ['start'], { env: { PORT: String(PORT) } });
let browser;
try {
  const up = (await waitForPort(PORT)) && (await waitFor("the server's boot line", { read: () => server.output.includes('world-room-listening'), until: Boolean }).catch(() => false));
  results.push(check('the built server is up, started by this run', up, up ? undefined : lastLinesOf(server.output)));
  if (!up) throw new Error('nothing to open');
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })).newPage();
  const responses = [];
  const consoleLines = [];
  const pageErrors = [];
  page.on('response', (response) => responses.push({ url: response.url().replace(`http://localhost:${PORT}`, ''), status: response.status() }));
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const document_ = await page.goto(`http://localhost:${PORT}/`);
  const policy = document_.headers()['content-security-policy'] ?? '';
  await page.waitForFunction(() => document.querySelector('canvas') !== null && document.getElementById('screen')?.hidden !== false, null, { timeout: 20000 });
  const rapier = await waitFor('the physics chunk to be fetched', { read: () => responses.find((response) => /\/assets\/rapier-.*\.js$/.test(response.url)), until: Boolean, timeoutMs: 15000 }).catch(() => undefined);
  const html = await document_.text();
  const bundleIndex = responses.findIndex((response) => /\/assets\/index-.*\.js$/.test(response.url));
  results.push(check('the production page is seated and fetches the physics chunk by itself, after its own bundle, though index.html does not name it', rapier?.status === 200 && bundleIndex >= 0 && responses.indexOf(rapier) > bundleIndex && !html.includes('rapier'), JSON.stringify(responses.filter((response) => response.url.includes('/assets/')))));
  results.push(check('the page\'s security policy still allows the WASM to run and nothing else new', policy.includes("'wasm-unsafe-eval'") && !policy.includes("'unsafe-eval'"), policy));
  await page.waitForTimeout(1500);
  const before = await page.screenshot({ path: path.join(PROOF, '04-production-before.png') });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(600);
  const after = await page.screenshot({ path: path.join(PROOF, '04-production-after.png') });
  results.push(check('holding D changes what the page draws', !before.equals(after)));
  // The page warns with a `Novaland:` line when prediction cannot start or stops. (Taking a screenshot makes the GL driver warn about ReadPixels; that is the check, not the page.)
  const warnings = consoleLines.filter((line) => line.includes('Novaland:') || line.startsWith('error:'));
  results.push(check('prediction started and kept running: nothing warned that it could not start or that it stopped, no console errors, no page errors', warnings.length === 0 && pageErrors.length === 0, [...warnings, ...pageErrors].join(' | ')));
  report.assets = responses.filter((response) => response.url.includes('/assets/'));
  report.contentSecurityPolicy = policy;
  report.console = consoleLines;
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  server.stop();
}

report.results = results;
writeProof('04-production.json', report);
process.exit(summarize(results) ? 0 : 1);
