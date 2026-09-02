import {
  AccountStatus,
  TransactionType,
  UserRole,
  type PrismaClient,
} from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type {
  AccountInfo,
  CreateTransactionInput,
  TransactionInfo,
} from './transactions.schemas';

export interface TransactionRepository {
  create(
    input: CreateTransactionInput,
    auth: { userId: string; role: UserRole },
  ): Promise<{
    success: boolean;
    statusCode: 201;
    data?: TransactionInfo;
    message?: string;
  }>;
  findAccountInfo(input: { accountId: string }): Promise<AccountInfo | null>;
  findTransaction(input: { txnId: string }): Promise<TransactionInfo | null>;
}

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(
    input: CreateTransactionInput,
    auth: { userId: string; role: UserRole },
  ): Promise<{
    success: boolean;
    statusCode: number;
    data?: TransactionInfo;
    message?: string;
  }> {
    try {
      const accountInfo = await this.db.account.findUnique({
        where: {
          id: input.accountId,
        },
      });
      if (!accountInfo) {
        return {
          success: false,
          statusCode: 404,
          message: 'Account not found',
        };
      }
      if (accountInfo.status === AccountStatus.INACTIVE) {
        return {
          success: false,
          statusCode: 401,
          message: 'Inactive account',
        };
      }
      if (accountInfo.userId !== auth.userId) {
        return {
          success: false,
          statusCode: 403,
          message: 'Unauthorized transaction',
        };
      }
      return this.db.$transaction(async (tx) => {
        const reqdTxn = await tx.transaction.findUnique({
          where: {
            transactionId: input.transactionId,
          },
        });
        if (reqdTxn) return reqdTxn;
        // validate transaction type
        if (input.type === TransactionType.DEBIT) {
          if (accountInfo && input.amountMinor >= accountInfo.balance) {
            return {
              success: false,
              statusCode: 401,
              message: 'Insufficient balance',
            };
          }
        }
        // fraud detection
        const result = await tx.transaction.aggregate({
          _count: {
            id: true,
          },
          _sum: {
            amount: true,
          },
          where: {
            account: {
              userId: auth.userId,
            },
            createdAt: {
              gte: new Date(Date.now() - 60_000),
            },
          },
        });
        const currentTotalTxnAmount = result._sum.amount ?? 0n;
        let totalTxnAmount = 0n;
        if (input.type === TransactionType.DEBIT) {
          totalTxnAmount = currentTotalTxnAmount + input.amountMinor;
        }
        if (result && result._count.id + 1 > 5 && totalTxnAmount > 50000) {
          // EMIT FRAUD EVENT
          return {
            success: false,
            statusCode: 403,
            message: 'Invalid transaction',
          };
        }

        const resultTxn = await tx.transaction.create({
          data: {
            transactionId: input.transactionId,
            accountId: input.accountId,
            type: input.type,
            amount: input.amountMinor,
          },
          select: {
            id: true,
            transactionId: true,
            accountId: true,
            type: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        });

        let balanceAfter = 0n;
        if (input.type === TransactionType.DEBIT) {
          balanceAfter = accountInfo.balance - resultTxn.amount;
        } else {
          balanceAfter = accountInfo.balance + resultTxn.amount;
        }
        await tx.account.update({
          where: {
            id: input.accountId,
          },
          data: {
            balance: balanceAfter,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            transactionId: resultTxn.transactionId,
            accountId: resultTxn.accountId,
            type: resultTxn.type,
            amount: resultTxn.amount,
            balanceAfter: balanceAfter,
          },
        });
        return {
          success: true,
          statusCode: 201,
          data: resultTxn,
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async findAccountInfo(input: {
    accountId: string;
  }): Promise<AccountInfo | null> {
    try {
      return await this.db.account.findUnique({
        where: {
          id: input.accountId,
        },
      });
    } catch (e) {
      throw e;
    }
  }

  async findTransaction(input: {
    txnId: string;
  }): Promise<TransactionInfo | null> {
    try {
      return await this.db.transaction.findUnique({
        where: {
          transactionId: input.txnId,
        },
      });
    } catch (e) {
      throw e;
    }
  }
}
