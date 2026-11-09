import type { Server as HttpServer } from 'node:http';
import { handleRequestsFirst } from './handleFirst';

export const HEALTH_PATH = '/healthz';

/** What `/healthz` reports. Small on purpose: a host's probe reads the status code, a human reads the rest. */
export interface HealthReport {
  readonly ok: true;
  readonly roomId: string;
  readonly seats: number;
  readonly seatsTaken: number;
  readonly tick: number;
}

/**
 * Answers `GET /healthz` with 200 and a JSON report while the process is up;
 * the host's liveness probe points here. Anything else hands over.
 */
export function answerHealthChecks(httpServer: HttpServer, report: () => HealthReport): void {
  handleRequestsFirst(httpServer, (request, response, handOver) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== HEALTH_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) {
      handOver();
      return;
    }
    const body = Buffer.from(JSON.stringify(report()));
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}
