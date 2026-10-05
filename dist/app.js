"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const config_1 = require("./config");
const errors_1 = require("./errors");
const admin_1 = __importDefault(require("./routes/admin"));
const auth_1 = __importDefault(require("./routes/auth"));
const payments_1 = __importDefault(require("./routes/payments"));
const transport_1 = __importDefault(require("./routes/transport"));
const app = (0, express_1.default)();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin(origin, callback) {
        if (!origin || config_1.clientOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new errors_1.HttpError(403, 'This origin is not allowed to access the API.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
}));
app.use(express_1.default.json({ limit: '1mb' }));
app.use(express_1.default.urlencoded({ extended: false, limit: '16kb' }));
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agrimove-api' });
});
app.use('/api/auth', authLimiter, auth_1.default);
app.use('/api/payments', payments_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api', transport_1.default);
const handleError = (error, _req, res, _next) => {
    if (error instanceof zod_1.ZodError) {
        res.status(400).json({ error: 'Request validation failed.', details: error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })) });
        return;
    }
    if (error instanceof multer_1.default.MulterError) {
        res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
            error: error.code === 'LIMIT_FILE_SIZE' ? 'The selected image is too large.' : 'Image upload request was invalid.',
        });
        return;
    }
    if (error instanceof errors_1.HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error && typeof error === 'object' && 'type' in error) {
        const bodyError = error;
        if (bodyError.type === 'entity.parse.failed') {
            res.status(400).json({ error: 'Request body must contain valid JSON.' });
            return;
        }
        if (bodyError.type === 'entity.too.large') {
            res.status(413).json({ error: 'Request body is too large.' });
            return;
        }
    }
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
        res.status(400).json({ error: 'The provided data did not pass validation.' });
        return;
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        res.status(409).json({ error: 'A record with those unique details already exists.' });
        return;
    }
    console.error('Unhandled API error:', error);
    res.status(500).json({
        error: config_1.env.NODE_ENV === 'production' ? 'The request could not be completed.' : error instanceof Error ? error.message : 'Unexpected server error.',
    });
};
app.use(handleError);
exports.default = app;
