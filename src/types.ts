import type { Request } from 'express';
import type { Types } from 'mongoose';

export type AppRole = 'farmer' | 'vehicle_owner' | 'admin';
export type AuthUser = {
  id: string;
  role: AppRole;
  email: string;
  fullName: string;
};

export type AuthenticatedRequest = Request & { auth: AuthUser };

export function objectId(value: string) {
  return value as unknown as Types.ObjectId;
}
