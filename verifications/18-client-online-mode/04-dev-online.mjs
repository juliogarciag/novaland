/* global window */
/** V4: `pnpm dev:online` runs the server and the client together on the ports given, the page joins the world, and stopping the script stops both. */
import { chromium } from 'playwright';
import { check, isPortOpen, start, summarize, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5320;
const CLIENT_PORT = 5321;
const results = [];
const report = {};
const both = start('pnpm', ['dev:online'], { env: { SERVER_PORT: String(SERVER_PORT), PORT: String(CLIENT_PORT), VITE_SERVER_URL: undefined } });
let browser;
try {
  results.push(check(`the room server listens on SERVER_PORT ${SERVER_PORT}`, await waitForPort(SERVER_PORT)));
  results.push(check(`the client listens on PORT ${CLIENT_PORT}`, await waitForPort(CLIENT_PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${CLIENT_PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.online && window.__novaland.online.status().kind === 'online', null, { timeout: 20000 });
  const status = await page.evaluate(() => ({ status: window.__novaland.online.status(), isReplica: window.__novaland.sim.isReplica }));
  results.push(check('the page joins the shared world the script started', status.status.kind === 'online' && status.isReplica === true, JSON.stringify(status)));
  report.status = status;
  report.outputHead = both.output.split('\n').slice(0, 12);
  results.push(check('the script prefixes each process\'s output', /\[server\] .*world-room-listening/.test(both.output) && /\[client\] .*(VITE|Local:)/.test(both.output)));
} catch (error) {
  results.push(check('the scenario ran to the end', false, String(error)));
} finally {
  if (browser) await browser.close();
  both.stop();
}
const deadline = Date.now() + 5000;
let serverOpen = true;
let clientOpen = true;
while (Date.now() < deadline && (serverOpen || clientOpen)) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  serverOpen = await isPortOpen(SERVER_PORT);
  clientOpen = await isPortOpen(CLIENT_PORT);
}
results.push(check('stopping the script stops both the server and the client', !serverOpen && !clientOpen, `server open ${serverOpen}, client open ${clientOpen}`));
report.stopped = { serverOpen, clientOpen };
writeProof('04-dev-online.json', report);
process.exit(summarize(results) ? 0 : 1);
