import type { Account, PrismaClient } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export type CreatedAccount = Pick<
  Account,
  'id' | 'userId' | 'balance' | 'status' | 'createdAt'
>;

export interface AccountRepository {
  createForActiveUser(userId: string): Promise<CreatedAccount | null>;
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  createForActiveUser(userId: string): Promise<CreatedAccount | null> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });

      if (!user) {
        return null;
      }

      const createdAccount = tx.account.create({
        data: { userId: user.id },
        select: {
          id: true,
          userId: true,
          balance: true,
          status: true,
          createdAt: true,
        },
      });
      return createdAccount;
    });
  }
}
