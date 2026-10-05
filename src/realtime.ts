import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { clientOrigins, env } from './config';
import { User } from './models';
import type { AppRole } from './types';

type RealtimeIdentity = {
  id: string;
  role: AppRole;
  email: string;
  fullName: string;
};

let io: Server | null = null;

export function attachRealtime(server: HttpServer) {
  if (io) throw new Error('Realtime server is already attached.');
  io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin(origin, callback) {
        if (!origin || clientOrigins.includes(origin)) callback(null, true);
        else callback(new Error('This origin is not allowed to access realtime updates.'));
      },
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 16 * 1024,
    connectTimeout: 10_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || !token) {
        next(new Error('Sign in to receive live updates.'));
        return;
      }
      const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: 'agrimove-api',
        audience: 'agrimove-client',
      }) as jwt.JwtPayload;
      if (typeof claims.sub !== 'string') {
        next(new Error('Realtime authentication is invalid.'));
        return;
      }
      const user = await User.findById(claims.sub).select('_id role email fullName isActive');
      if (!user?.isActive) {
        next(new Error('This account is unavailable.'));
        return;
      }
      socket.data.identity = {
        id: String(user._id),
        role: user.role,
        email: user.email,
        fullName: user.fullName,
      } satisfies RealtimeIdentity;
      next();
    } catch {
      next(new Error('Your session has expired. Reconnect after signing in.'));
    }
  });

  io.on('connection', (socket) => {
    const identity = socket.data.identity as RealtimeIdentity;
    socket.join(`user:${identity.id}`);
    socket.join(`role:${identity.role}`);
    const decoded = jwt.decode(socket.handshake.auth?.token) as jwt.JwtPayload | null;
    const expiresAt = decoded?.exp ? decoded.exp * 1000 : null;
    if (expiresAt) {
      const timeout = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt - Date.now()));
      timeout.unref();
      socket.once('disconnect', () => clearTimeout(timeout));
    }
  });

  return io;
}

export function publishDataChange(userIds: Array<string | undefined>, resource: string, action: string, id?: string) {
  if (!io) return;
  const payload = { resource, action, id, occurredAt: new Date().toISOString() };
  for (const userId of new Set(userIds.filter((value): value is string => Boolean(value)))) {
    io.to(`user:${userId}`).emit('data:changed', payload);
  }
  io.to('role:admin').emit('data:changed', payload);
}

export function publishRoleChange(roles: AppRole[], resource: string, action: string, id?: string) {
  if (!io) return;
  const payload = { resource, action, id, occurredAt: new Date().toISOString() };
  for (const role of new Set(roles)) io.to(`role:${role}`).emit('data:changed', payload);
  io.to('role:admin').emit('data:changed', payload);
}

export async function closeRealtime() {
  if (!io) return;
  const current = io;
  io = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}
