import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { clientOrigins, env } from './config';
import { HttpError } from './errors';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import paymentRoutes from './routes/payments';
import transportRoutes from './routes/transport';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(403, 'This origin is not allowed to access the API.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agrimove-api' });
});
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', transportRoutes);

const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Request validation failed.', details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })) });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'The selected image is too large.' : 'Image upload request was invalid.',
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error && typeof error === 'object' && 'type' in error) {
    const bodyError = error as { type?: unknown; status?: unknown };
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
    const duplicateError = error as { keyPattern?: Record<string, unknown> };
    if (duplicateError.keyPattern?.email) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    res.status(409).json({ error: 'A record with those unique details already exists.' });
    return;
  }
  console.error('Unhandled API error:', error);
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'The request could not be completed.' : error instanceof Error ? error.message : 'Unexpected server error.',
  });
};

app.use(handleError);

export default app;
