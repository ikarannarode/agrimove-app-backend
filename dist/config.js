"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientOrigins = exports.env = void 0;
exports.assertProductionConfiguration = assertProductionConfiguration;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: zod_1.z.string().min(1),
    CLIENT_ORIGINS: zod_1.z.string().default('http://localhost:8081,http://localhost:5173'),
    JWT_ACCESS_SECRET: zod_1.z.string().min(32),
    JWT_REFRESH_SECRET: zod_1.z.string().min(32),
    ACCESS_TOKEN_MINUTES: zod_1.z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_DAYS: zod_1.z.coerce.number().int().min(1).max(90).default(30),
    EMAIL_VERIFICATION_MINUTES: zod_1.z.coerce.number().int().min(5).max(1440).default(30),
    PASSWORD_RESET_MINUTES: zod_1.z.coerce.number().int().min(5).max(120).default(20),
    EMAIL_FROM: zod_1.z.string().default('Smart Krushi <no-reply@example.com>'),
    BREVO_API_KEY: zod_1.z.string().default(''),
    CLOUDINARY_CLOUD_NAME: zod_1.z.string().default(''),
    CLOUDINARY_API_KEY: zod_1.z.string().default(''),
    CLOUDINARY_API_SECRET: zod_1.z.string().default(''),
    PAYMENT_SCREENSHOT_RETENTION_HOURS: zod_1.z.coerce.number().int().min(1).max(720).default(24),
});
exports.env = envSchema.parse(process.env);
exports.clientOrigins = exports.env.CLIENT_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
function assertProductionConfiguration() {
    if (exports.env.NODE_ENV !== 'production')
        return;
    const missing = [];
    if (!exports.env.BREVO_API_KEY)
        missing.push('BREVO_API_KEY');
    if (!exports.env.CLOUDINARY_CLOUD_NAME || !exports.env.CLOUDINARY_API_KEY || !exports.env.CLOUDINARY_API_SECRET) {
        missing.push('CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
    }
    if (missing.length)
        throw new Error(`Required production configuration missing: ${missing.join(', ')}`);
}
