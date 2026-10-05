import { createHash, randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { HttpError } from '../errors';
import { AuthToken, User } from '../models';
import { sendOneTimeCode } from './mail';
import type { AppRole } from '../types';

const customerRoles: AppRole[] = ['farmer', 'vehicle_owner'];

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const oneTimeCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

async function storeCode(userId: string, code: string, purpose: 'verify_email' | 'reset_password', minutes: number) {
  await AuthToken.deleteMany({ userId, purpose });
  await AuthToken.create({
    userId,
    tokenHash: digest(code),
    purpose,
    expiresAt: new Date(Date.now() + minutes * 60_000),
  });
}

async function issueSession(user: { _id: unknown; role: AppRole; email: string; fullName: string }) {
  const accessToken = jwt.sign({
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    expiresIn: `${env.ACCESS_TOKEN_MINUTES}m`,
    issuer: 'agrimove-api',
    audience: 'agrimove-client',
  });
  const refreshToken = randomUUID();
  await AuthToken.create({
    userId: user._id,
    tokenHash: digest(refreshToken),
    purpose: 'refresh',
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000),
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_MINUTES * 60,
    user: { id: String(user._id), email: user.email, fullName: user.fullName, role: user.role },
  };
}

export async function register(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: AppRole;
}) {
  if (!customerRoles.includes(input.role)) throw new HttpError(400, 'Choose a valid mobile account role.');
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) throw new HttpError(409, 'An account with this email already exists.');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    fullName: input.fullName.trim(),
    email,
    phone: input.phone.trim(),
    passwordHash,
    role: input.role,
  });
  const code = oneTimeCode();
  try {
    await storeCode(String(user._id), code, 'verify_email', env.EMAIL_VERIFICATION_MINUTES);
    await sendOneTimeCode(email, code, 'verify');
  } catch (error) {
    await AuthToken.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    throw error;
  }
  return { message: 'Account created. Check your email for the verification code.' };
}

export async function verifyEmail(email: string, code: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) throw new HttpError(400, 'The verification code is invalid or expired.');
  const token = await AuthToken.findOneAndDelete({
    userId: user._id,
    purpose: 'verify_email',
    tokenHash: digest(code),
    expiresAt: { $gt: new Date() },
  });
  if (!token) throw new HttpError(400, 'The verification code is invalid or expired.');
  user.emailVerifiedAt = new Date();
  await user.save();
  return { message: 'Email verified. You can now sign in.' };
}

export async function resendVerification(email: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || user.emailVerifiedAt) return { message: 'If verification is needed, a code will be sent.' };
  const code = oneTimeCode();
  await storeCode(String(user._id), code, 'verify_email', env.EMAIL_VERIFICATION_MINUTES);
  await sendOneTimeCode(user.email, code, 'verify');
  return { message: 'If verification is needed, a code will be sent.' };
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
  if (!user?.isActive || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  if (!user.emailVerifiedAt) throw new HttpError(403, 'Verify your email before signing in.');
  if (user.passwordResetRequired) throw new HttpError(403, 'Reset your password before signing in.');
  return issueSession(user);
}

export async function refresh(refreshToken: string) {
  const token = await AuthToken.findOneAndDelete({
    tokenHash: digest(refreshToken),
    purpose: 'refresh',
    expiresAt: { $gt: new Date() },
  });
  if (!token) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  const user = await User.findById(token.userId);
  if (!user?.isActive || !user.emailVerifiedAt) throw new HttpError(401, 'This account is unavailable.');
  return issueSession(user);
}

export async function logout(refreshToken: string | undefined) {
  if (refreshToken) {
    await AuthToken.deleteOne({ tokenHash: digest(refreshToken), purpose: 'refresh' });
  }
}

export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase(), isActive: true });
  if (!user) return { message: 'If an active account exists, a reset code will be sent.' };
  const code = oneTimeCode();
  await storeCode(String(user._id), code, 'reset_password', env.PASSWORD_RESET_MINUTES);
  await sendOneTimeCode(user.email, code, 'reset');
  return { message: 'If an active account exists, a reset code will be sent.' };
}

export async function resetPassword(email: string, code: string, password: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) throw new HttpError(400, 'The reset code is invalid or expired.');
  const token = await AuthToken.findOneAndDelete({
    userId: user._id,
    purpose: 'reset_password',
    tokenHash: digest(code),
    expiresAt: { $gt: new Date() },
  });
  if (!token) throw new HttpError(400, 'The reset code is invalid or expired.');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetRequired = false;
  await user.save();
  await AuthToken.deleteMany({ userId: user._id, purpose: 'refresh' });
  return { message: 'Password updated. You can now sign in.' };
}
