import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './config';
import { HttpError } from './errors';
import { User } from './models';
import type { AppRole, AuthUser, AuthenticatedRequest } from './types';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Sign in to continue.');
    const token = header.slice(7);
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & {
      sub: string;
      role: AppRole;
      email: string;
      fullName: string;
    };
    const user = await User.findById(claims.sub).select('_id role email fullName isActive');
    if (!user?.isActive) throw new HttpError(401, 'This account is unavailable.');
    (req as AuthenticatedRequest).auth = {
      id: String(user._id),
      role: user.role as AppRole,
      email: user.email,
      fullName: user.fullName,
    } satisfies AuthUser;
    next();
  } catch (error) {
    next(error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError
      ? new HttpError(401, 'Your session has expired. Please sign in again.')
      : error);
  }
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes((req as AuthenticatedRequest).auth?.role)) {
      next(new HttpError(403, 'Your account is not permitted to perform this action.'));
      return;
    }
    next();
  };
}

export function authenticated(req: Request) {
  const user = (req as AuthenticatedRequest).auth;
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return user;
}
