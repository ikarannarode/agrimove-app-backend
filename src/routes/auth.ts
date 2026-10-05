import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors';
import { authenticate, authenticated } from '../middleware';
import { User } from '../models';
import * as authService from '../services/auth';
import { publishRoleChange, publishDataChange } from '../realtime';

const router = Router();
const email = z.string().email().max(254).transform((value) => value.trim().toLowerCase());
const role = z.enum(['farmer', 'vehicle_owner']);
const password = z.string().min(8).max(128);

router.post('/register', async (req, res) => {
  const body = z.object({
    fullName: z.string().trim().min(2).max(120),
    email,
    phone: z.string().trim().min(10).max(24),
    password,
    role,
  }).parse(req.body);
  const result = await authService.register(body);
  publishRoleChange(['admin'], 'users', 'created');
  res.status(201).json(result);
});

router.post('/verify-email', async (req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  res.json(await authService.verifyEmail(body.email, body.code));
});

router.post('/resend-verification', async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  res.json(await authService.resendVerification(body.email));
});

router.post('/login', async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
  res.json(await authService.login(body.email, body.password));
});

router.post('/refresh', async (req, res) => {
  const body = z.object({ refreshToken: z.string().uuid() }).parse(req.body);
  res.json(await authService.refresh(body.refreshToken));
});

router.post('/logout', async (req, res) => {
  const body = z.object({ refreshToken: z.string().uuid().optional() }).parse(req.body ?? {});
  await authService.logout(body.refreshToken);
  res.status(204).end();
});

router.post('/password/forgot', async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  res.json(await authService.requestPasswordReset(body.email));
});

router.post('/password/reset', async (req, res) => {
  const body = z.object({
    email,
    code: z.string().regex(/^\d{6}$/),
    password,
  }).parse(req.body);
  res.json(await authService.resetPassword(body.email, body.code, body.password));
});

router.get('/me', authenticate, async (req, res) => {
  const actor = authenticated(req);
  const user = await User.findById(actor.id).select('fullName email phone role upiId qrPublicId createdAt updatedAt');
  if (!user) throw new HttpError(404, 'Account was not found.');
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

router.patch('/me', authenticate, async (req, res) => {
  const actor = authenticated(req);
  const body = z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(10).max(24),
  }).strict().parse(req.body);
  const user = await User.findByIdAndUpdate(actor.id, {
    $set: { fullName: body.fullName, phone: body.phone },
  }, { new: true, runValidators: true }).select('fullName email phone role createdAt updatedAt');
  if (!user) throw new HttpError(404, 'Account was not found.');
  publishDataChange([actor.id], 'profile', 'updated');
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

export default router;
