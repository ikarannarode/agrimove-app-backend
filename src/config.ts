import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  CLIENT_ORIGINS: z.string().default('http://localhost:8081,http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EMAIL_VERIFICATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  PASSWORD_RESET_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  EMAIL_FROM: z.string().default('Smart Krushi <no-reply@example.com>'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  PAYMENT_SCREENSHOT_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
});

export const env = envSchema.parse(process.env);
export const clientOrigins = env.CLIENT_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
export function assertProductionConfiguration() {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) missing.push('SMTP_HOST/SMTP_USER/SMTP_PASSWORD');
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    missing.push('CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
  }
  if (missing.length) throw new Error(`Required production configuration missing: ${missing.join(', ')}`);
}
