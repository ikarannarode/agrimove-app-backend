"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const errors_1 = require("../errors");
const middleware_1 = require("../middleware");
const models_1 = require("../models");
const authService = __importStar(require("../services/auth"));
const realtime_1 = require("../realtime");
const router = (0, express_1.Router)();
const email = zod_1.z.string().email().max(254).transform((value) => value.trim().toLowerCase());
const role = zod_1.z.enum(['farmer', 'vehicle_owner']);
const password = zod_1.z.string().min(8).max(128);
router.post('/register', async (req, res) => {
    const body = zod_1.z.object({
        fullName: zod_1.z.string().trim().min(2).max(120),
        email,
        phone: zod_1.z.string().trim().min(10).max(24),
        password,
        role,
    }).parse(req.body);
    const result = await authService.register(body);
    (0, realtime_1.publishRoleChange)(['admin'], 'users', 'created');
    res.status(201).json(result);
});
router.post('/verify-email', async (req, res) => {
    const body = zod_1.z.object({ email, code: zod_1.z.string().regex(/^\d{6}$/) }).parse(req.body);
    res.json(await authService.verifyEmail(body.email, body.code));
});
router.post('/resend-verification', async (req, res) => {
    const body = zod_1.z.object({ email }).parse(req.body);
    res.json(await authService.resendVerification(body.email));
});
router.post('/login', async (req, res) => {
    const body = zod_1.z.object({ email, password: zod_1.z.string().min(1).max(128) }).parse(req.body);
    res.json(await authService.login(body.email, body.password));
});
router.post('/refresh', async (req, res) => {
    const body = zod_1.z.object({ refreshToken: zod_1.z.string().uuid() }).parse(req.body);
    res.json(await authService.refresh(body.refreshToken));
});
router.post('/logout', async (req, res) => {
    const body = zod_1.z.object({ refreshToken: zod_1.z.string().uuid().optional() }).parse(req.body ?? {});
    await authService.logout(body.refreshToken);
    res.status(204).end();
});
router.post('/password/forgot', async (req, res) => {
    const body = zod_1.z.object({ email }).parse(req.body);
    res.json(await authService.requestPasswordReset(body.email));
});
router.post('/password/reset', async (req, res) => {
    const body = zod_1.z.object({
        email,
        code: zod_1.z.string().regex(/^\d{6}$/),
        password,
    }).parse(req.body);
    res.json(await authService.resetPassword(body.email, body.code, body.password));
});
router.get('/me', middleware_1.authenticate, async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const user = await models_1.User.findById(actor.id).select('fullName email phone role upiId qrPublicId createdAt updatedAt');
    if (!user)
        throw new errors_1.HttpError(404, 'Account was not found.');
    res.json({
        id: String(user._id),
        full_name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        upi_id: user.upiId,
        has_qr: Boolean(user.qrPublicId),
    });
});
router.patch('/me', middleware_1.authenticate, async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        fullName: zod_1.z.string().trim().min(2).max(120),
        phone: zod_1.z.string().trim().min(10).max(24),
    }).strict().parse(req.body);
    const user = await models_1.User.findByIdAndUpdate(actor.id, {
        $set: { fullName: body.fullName, phone: body.phone },
    }, { new: true, runValidators: true }).select('fullName email phone role createdAt updatedAt');
    if (!user)
        throw new errors_1.HttpError(404, 'Account was not found.');
    (0, realtime_1.publishDataChange)([actor.id], 'profile', 'updated');
    res.json({
        id: String(user._id),
        full_name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
    });
});
exports.default = router;
