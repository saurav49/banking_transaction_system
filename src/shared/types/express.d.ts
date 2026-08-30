import type { UserRole } from '../../../generated/prisma/enums';

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: {
        userId: string;
        role: UserRole;
      };
    }
  }
}

export {};
