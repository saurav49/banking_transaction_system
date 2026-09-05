import {
  AccountStatus,
  TransactionStatus,
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
    statusCode: number;
    data?: TransactionInfo;
    message?: string;
  }>;
  findAccountInfo(input: { accountId: string }): Promise<AccountInfo | null>;
  findTransaction(input: {
    txnId: string;
    accountId: string;
  }): Promise<TransactionInfo | null>;
}

const fraudTxn: bigint = 5000000n;

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
      return this.db.$transaction(async (tx) => {
        const existingTxn = await tx.transaction.findUnique({
          where: {
            transactionId: input.transactionId,
            accountId: input.accountId,
          },
        });
        if (existingTxn) {
          if (
            existingTxn.type === input.type &&
            existingTxn.amount === input.amountMinor
          ) {
            return {
              success: false,
              statusCode: 209,
              message: 'Transaction conflict',
            };
          } else {
            return {
              success: true,
              statusCode: 200,
              data: existingTxn,
            };
          }
        }
        const accounts = await tx.$queryRaw<AccountInfo[]>`
          SELECT
          "id",
          "status",
          "userId",
          "balance".
          "createdAt",
          "deletedAt"
          FROM 'Account'
          WHERE "id"=${input.accountId}
          FOR UPDATE
        `;
        const accountInfo = accounts[0];
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
        // validate transaction type
        if (input.type === TransactionType.DEBIT) {
          // the business requirement is to not make an account balance to be fully zero
          if (input.amountMinor >= accountInfo.balance) {
            return {
              success: false,
              statusCode: 401,
              message: 'Insufficient balance',
            };
          }
        }
        // fraud detection
        const count = await tx.transaction.aggregate({
          _count: {
            id: true,
          },
          where: {
            account: {
              userId: auth.userId,
              id: input.accountId,
            },
            createdAt: {
              gte: new Date(Date.now() - 60_000),
            },
          },
        });
        const amt = await tx.transaction.aggregate({
          _sum: {
            amount: true,
          },
          where: {
            account: {
              id: input.accountId,
              userId: auth.userId,
            },
            type: TransactionType.DEBIT,
          },
        });
        const currentTotalTxnAmount = amt._sum.amount ?? 0n;
        let totalTxnAmount = currentTotalTxnAmount;
        if (input.type === TransactionType.DEBIT) {
          totalTxnAmount = currentTotalTxnAmount + input.amountMinor;
        }
        if ((count && count._count.id + 1 > 5) || totalTxnAmount > fraudTxn) {
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
            status: TransactionStatus.COMPLETED,
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
        // emit success transaction event where
        // we will do the ledger entry, email update etc
        // await tx.ledgerEntry.create({
        //   data: {
        //     transactionId: resultTxn.transactionId,
        //     accountId: resultTxn.accountId,
        //     type: resultTxn.type,
        //     amount: resultTxn.amount,
        //     balanceAfter: balanceAfter,
        //   },
        // });
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
          deletedAt: null,
        },
      });
    } catch (e) {
      throw e;
    }
  }

  async findTransaction(input: {
    txnId: string;
    accountId: string;
  }): Promise<TransactionInfo | null> {
    try {
      return await this.db.transaction.findUnique({
        where: {
          transactionId: input.txnId,
          accountId: input.accountId,
        },
      });
    } catch (e) {
      throw e;
    }
  }
}
