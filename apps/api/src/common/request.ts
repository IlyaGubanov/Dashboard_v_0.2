import type { Request } from 'express';
import type { GlobalRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  login: string;
  fullName: string;
  globalRole: GlobalRole;
  mustChangePassword: boolean;
  sessionId: number;
}

export type AuthRequest = Request & { user?: AuthUser };

export function clientIp(req: Request): string | null {
  return (req.ip ?? req.socket.remoteAddress ?? null)?.replace(/^::ffff:/, '') ?? null;
}
