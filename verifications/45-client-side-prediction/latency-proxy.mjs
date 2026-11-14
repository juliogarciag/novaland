/**
 * A proxy that stands between a browser and the world server and makes the
 * connection slow: every WebSocket message waits half the round trip in each
 * direction, so a round trip through it takes `roundTripMs` longer than
 * without. HTTP (the matchmaking call) is passed through untouched. It can
 * also lose one of the client's room messages on request, which is how the
 * checks make the server and the client disagree.
 *
 * It knows nothing of the game: frames are relayed as bytes. The only thing
 * it reads is the first byte of a client frame, to tell a room message
 * (Colyseus `Protocol.ROOM_DATA`, 13) from a ping.
 *
 * In a script:   const proxy = await startLatencyProxy({ listenPort, targetPort, roundTripMs })
 * By hand:       LISTEN_PORT=5146 TARGET_PORT=5147 ROUND_TRIP_MS=150 node latency-proxy.mjs
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

const ROOM_DATA = 13;
const PROTOCOL_CODE_MASK = 0x1f;

export function startLatencyProxy({ listenPort, targetPort, roundTripMs }) {
  let oneWayMs = roundTripMs / 2;
  const counts = { toServer: 0, toClient: 0, dropped: 0 };
  let roomMessagesToDrop = 0;
  const sockets = new Set();

  const server = http.createServer((request, response) => {
    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: request.method, path: request.url, headers: request.headers }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', () => {
      response.writeHead(502).end();
    });
    request.pipe(upstream);
  });

  const webSockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (client) => {
      const headers = request.headers.origin ? { origin: request.headers.origin } : {};
      const upstream = new WebSocket(`ws://127.0.0.1:${targetPort}${request.url}`, { headers });
      sockets.add(client).add(upstream);
      // One timer queue per direction: equal delays fire in the order they were set, so messages never overtake each other.
      const later = (action) => setTimeout(action, oneWayMs);
      const whenOpen = new Promise((resolve) => upstream.once('open', resolve));
      client.on('message', (data, isBinary) => {
        const isRoomMessage = isBinary && data.length > 0 && (data[0] & PROTOCOL_CODE_MASK) === ROOM_DATA;
        if (isRoomMessage && roomMessagesToDrop > 0) {
          roomMessagesToDrop -= 1;
          counts.dropped += 1;
          return;
        }
        counts.toServer += 1;
        later(() => void whenOpen.then(() => upstream.readyState === WebSocket.OPEN && upstream.send(data, { binary: isBinary })));
      });
      upstream.on('message', (data, isBinary) => {
        counts.toClient += 1;
        later(() => client.readyState === WebSocket.OPEN && client.send(data, { binary: isBinary }));
      });
      const closeBoth = (code, reason) => {
        const safeCode = code >= 1000 && code !== 1005 && code !== 1006 ? code : 1000;
        later(() => {
          for (const end of [client, upstream]) {
            if (end.readyState === WebSocket.OPEN) end.close(safeCode, reason);
            else if (end.readyState === WebSocket.CONNECTING) end.terminate();
            sockets.delete(end);
          }
        });
      };
      client.on('close', closeBoth);
      upstream.on('close', closeBoth);
      client.on('error', () => closeBoth(1011, ''));
      upstream.on('error', () => closeBoth(1011, ''));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () => {
      resolve({
        counts,
        /** Changes the delay for messages relayed from now on. Only while nothing is connected: a shorter delay would let a new message overtake one already waiting. */
        setRoundTripMs(milliseconds) {
          oneWayMs = milliseconds / 2;
        },
        /** The next `count` room messages the client sends never reach the server. */
        dropNextRoomMessages(count = 1) {
          roomMessagesToDrop += count;
        },
        close() {
          for (const socket of sockets) socket.terminate();
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const listenPort = Number(process.env.LISTEN_PORT);
  const targetPort = Number(process.env.TARGET_PORT);
  const roundTripMs = Number(process.env.ROUND_TRIP_MS ?? 150);
  if (!Number.isInteger(listenPort) || !Number.isInteger(targetPort) || !(roundTripMs >= 0)) {
    console.error('usage: LISTEN_PORT=<n> TARGET_PORT=<m> ROUND_TRIP_MS=<ms> node latency-proxy.mjs');
    process.exit(2);
  }
  await startLatencyProxy({ listenPort, targetPort, roundTripMs });
  console.log(`latency proxy on ${listenPort} -> ${targetPort}, adding ${roundTripMs} ms to every round trip`);
}
