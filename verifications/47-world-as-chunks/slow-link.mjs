/**
 * Stands between a browser and the world server and makes the connection
 * slow: every WebSocket message waits half the round trip in each direction.
 * HTTP (the matchmaking call) passes through untouched. Frames are relayed
 * as bytes; it knows nothing of the game.
 */
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export function startSlowLink({ listenPort, targetPort, roundTripMs }) {
  const oneWayMs = roundTripMs / 2;
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: request.method, path: request.url, headers: request.headers }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', () => response.writeHead(502).end());
    request.pipe(upstream);
  });
  const webSockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${targetPort}${request.url}`, { headers: request.headers.origin ? { origin: request.headers.origin } : {} });
      sockets.add(client).add(upstream);
      // Equal delays fire in the order they were set, so messages never overtake each other.
      const later = (action) => setTimeout(action, oneWayMs);
      const upstreamOpen = new Promise((resolve) => upstream.once('open', resolve));
      client.on('message', (data, isBinary) => later(() => void upstreamOpen.then(() => upstream.readyState === WebSocket.OPEN && upstream.send(data, { binary: isBinary }))));
      upstream.on('message', (data, isBinary) => later(() => client.readyState === WebSocket.OPEN && client.send(data, { binary: isBinary })));
      const closeBoth = () =>
        later(() => {
          for (const end of [client, upstream]) {
            if (end.readyState === WebSocket.OPEN) end.close(1000);
            else if (end.readyState === WebSocket.CONNECTING) end.terminate();
            sockets.delete(end);
          }
        });
      for (const end of [client, upstream]) end.on('close', closeBoth).on('error', closeBoth);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () =>
      resolve({
        close() {
          for (const socket of sockets) socket.terminate();
          return new Promise((done) => server.close(done));
        },
      }),
    );
  });
}
