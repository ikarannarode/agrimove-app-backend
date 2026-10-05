"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRealtime = attachRealtime;
exports.publishDataChange = publishDataChange;
exports.publishRoleChange = publishRoleChange;
exports.closeRealtime = closeRealtime;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const socket_io_1 = require("socket.io");
const config_1 = require("./config");
const models_1 = require("./models");
let io = null;
function attachRealtime(server) {
    if (io)
        throw new Error('Realtime server is already attached.');
    io = new socket_io_1.Server(server, {
        path: '/socket.io',
        cors: {
            origin(origin, callback) {
                if (!origin || config_1.clientOrigins.includes(origin))
                    callback(null, true);
                else
                    callback(new Error('This origin is not allowed to access realtime updates.'));
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
            const claims = jsonwebtoken_1.default.verify(token, config_1.env.JWT_ACCESS_SECRET, {
                issuer: 'agrimove-api',
                audience: 'agrimove-client',
            });
            if (typeof claims.sub !== 'string') {
                next(new Error('Realtime authentication is invalid.'));
                return;
            }
            const user = await models_1.User.findById(claims.sub).select('_id role email fullName isActive');
            if (!user?.isActive) {
                next(new Error('This account is unavailable.'));
                return;
            }
            socket.data.identity = {
                id: String(user._id),
                role: user.role,
                email: user.email,
                fullName: user.fullName,
            };
            next();
        }
        catch {
            next(new Error('Your session has expired. Reconnect after signing in.'));
        }
    });
    io.on('connection', (socket) => {
        const identity = socket.data.identity;
        socket.join(`user:${identity.id}`);
        socket.join(`role:${identity.role}`);
        const decoded = jsonwebtoken_1.default.decode(socket.handshake.auth?.token);
        const expiresAt = decoded?.exp ? decoded.exp * 1000 : null;
        if (expiresAt) {
            const timeout = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt - Date.now()));
            timeout.unref();
            socket.once('disconnect', () => clearTimeout(timeout));
        }
    });
    return io;
}
function publishDataChange(userIds, resource, action, id) {
    if (!io)
        return;
    const payload = { resource, action, id, occurredAt: new Date().toISOString() };
    for (const userId of new Set(userIds.filter((value) => Boolean(value)))) {
        io.to(`user:${userId}`).emit('data:changed', payload);
    }
    io.to('role:admin').emit('data:changed', payload);
}
function publishRoleChange(roles, resource, action, id) {
    if (!io)
        return;
    const payload = { resource, action, id, occurredAt: new Date().toISOString() };
    for (const role of new Set(roles))
        io.to(`role:${role}`).emit('data:changed', payload);
    io.to('role:admin').emit('data:changed', payload);
}
async function closeRealtime() {
    if (!io)
        return;
    const current = io;
    io = null;
    await new Promise((resolve) => current.close(() => resolve()));
}
