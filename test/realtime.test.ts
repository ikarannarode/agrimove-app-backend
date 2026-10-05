import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { io as createClient, type Socket } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/agrimove-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters';
process.env.CLIENT_ORIGINS = 'http://localhost:5173';

let closeRealtime: (() => Promise<void>) | undefined;
let client: Socket | undefined;
let httpServer: ReturnType<typeof createServer> | undefined;

test('unauthenticated sockets cannot join live update rooms', async () => {
  const realtime = await import('../src/realtime');
  closeRealtime = realtime.closeRealtime;
  httpServer = createServer();
  realtime.attachRealtime(httpServer);
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const address = httpServer.address();
  assert.ok(address && typeof address !== 'string');

  client = createClient(`http://127.0.0.1:${address.port}`, {
    auth: {},
    autoConnect: false,
    reconnection: false,
    timeout: 2_000,
    transports: ['websocket'],
  });
  const connectError = new Promise<Error>((resolve, reject) => {
    client?.once('connect_error', resolve);
    client?.once('connect', () => reject(new Error('Unauthenticated socket unexpectedly connected.')));
  });
  client.connect();
  const error = await connectError;
  assert.match(error.message, /Sign in to receive live updates/);
});

after(async () => {
  client?.disconnect();
  await closeRealtime?.();
  if (httpServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer?.close((error) => error ? reject(error) : resolve());
    });
  }
});
