import type { UserRole, UserStatus } from '../../../generated/prisma/enums';
import type { PrismaClient } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type AuthenticationUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  deletedAt: Date | null;
};

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthenticationUser | null>;
  findActiveAuthorization(userId: string): Promise<{ role: UserRole } | null>;
  createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    now: Date;
  }): Promise<Pick<
    AuthenticationUser,
    'id' | 'role' | 'status' | 'deletedAt'
  > | null>;
  revokeRefreshSession(tokenHash: string, now: Date): Promise<void>;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findUserByEmail(email: string): Promise<AuthenticationUser | null> {
    return this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  findActiveAuthorization(userId: string): Promise<{ role: UserRole } | null> {
    return this.db.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
      select: { role: true },
    });
  }

  async createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.refreshSession.create({ data: input });
  }

  rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    now: Date;
  }): Promise<Pick<
    AuthenticationUser,
    'id' | 'role' | 'status' | 'deletedAt'
  > | null> {
    return this.db.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash: input.currentTokenHash },
        select: {
          expiresAt: true,
          revokedAt: true,
          user: {
            select: { id: true, role: true, status: true, deletedAt: true },
          },
        },
      });

      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= input.now ||
        session.user.status !== 'ACTIVE' ||
        session.user.deletedAt
      ) {
        return null;
      }

      const revoked = await tx.refreshSession.updateMany({
        where: {
          tokenHash: input.currentTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { revokedAt: input.now },
      });

      if (revoked.count !== 1) {
        return null;
      }

      await tx.refreshSession.create({
        data: {
          userId: session.user.id,
          tokenHash: input.nextTokenHash,
          expiresAt: input.nextExpiresAt,
        },
      });

      return session.user;
    });
  }

  async revokeRefreshSession(tokenHash: string, now: Date): Promise<void> {
    await this.db.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
