import type { Request } from 'express';
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
  TransactionResponse,
  TransactionResult,
} from './transactions.schemas';
import { config } from '../../config/env';

export interface TransactionRepository {
  create(
    input: CreateTransactionInput,
    request: Request,
  ): Promise<TransactionResult>;
  findAccountInfo(input: { accountId: string }): Promise<AccountInfo | null>;
  findTransaction(input: {
    txnId: string;
    accountId: string;
  }): Promise<TransactionInfo | null>;
}

function toTransactionResponse(
  transaction: TransactionInfo,
): TransactionResponse {
  return {
    ...transaction,
    amount: transaction.amount.toString(),
    createdAt: transaction.createdAt.toISOString(),
  };
}

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(
    input: CreateTransactionInput,
    request: Request,
  ): Promise<TransactionResult> {
    try {
      return this.db.$transaction(async (tx) => {
        const ipAddress =
          request.ip ||
          request.headers['x-forwarded-for']
            ?.toString()
            .split(',')[0]
            ?.trim() ||
          null;
        const deviceFingerprint = input.deviceFingerprint;
        const auth = request.auth!;
        const accounts = await tx.$queryRaw<AccountInfo[]>`
          SELECT
          "id",
          "status",
          "userId",
          "balance",
          "createdAt",
          "deletedAt"
          FROM "Account"
          WHERE "id"=${input.accountId}
          and "deletedAt" is NULL
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
            statusCode: 409,
            message: 'Inactive account',
          };
        }

        if (
          input.type === TransactionType.DEBIT &&
          auth?.userId !== accountInfo?.userId
        ) {
          return {
            success: false,
            statusCode: 403,
            message: 'Unauthorized access',
          };
        }
        if (
          input.type === TransactionType.CREDIT &&
          auth.role !== UserRole.ADMIN
        ) {
          if (auth.userId === accountInfo.userId) {
            return {
              success: false,
              statusCode: 403,
              message: 'Cannot credit own account',
            };
          }
          return {
            success: false,
            statusCode: 403,
            message: 'Only authorized admin can credit account',
          };
        }
        // validate transaction type
        if (input.type === TransactionType.DEBIT) {
          // the business requirement is to not make an account balance to be fully zero
          if (input.amountMinor >= accountInfo.balance) {
            return {
              success: false,
              statusCode: 422,
              message: 'Insufficient balance',
            };
          }
        }
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
              success: true,
              statusCode: 200,
              data: toTransactionResponse(existingTxn),
            };
          } else {
            return {
              success: false,
              statusCode: 409,
              message: 'Transaction conflict',
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
            createdAt: {
              gte: new Date(Date.now() - 60_000),
            },
          },
        });
        const currentTotalTxnAmount = amt._sum.amount ?? 0n;
        let totalTxnAmount = currentTotalTxnAmount;
        if (input.type === TransactionType.DEBIT) {
          totalTxnAmount = currentTotalTxnAmount + input.amountMinor;
        }
        if (
          (count && count._count.id + 1 > config.MAX_TXN) ||
          totalTxnAmount > config.FRAUD_TXN_AMOUNT
        ) {
          // EMIT FRAUD EVENT
          await tx.transaction.update({
            where: {
              transactionId: input.transactionId,
            },
            data: {
              status: TransactionStatus.BLOCKED,
            },
          });
          await tx.outboxEvent.create({
            data: {
              event: 'TransactionBlocked',
              aggregateId: input.transactionId,
              payload: {
                eventType: 'TransactionBlocked',
                eventVersion: 1,
                ipAddress,
                deviceFingerprint,
                reason: 'Exceed transaction limit or amount for a minute',
              },
            },
          });
          return {
            success: false,
            statusCode: 422,
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
        await tx.transaction.update({
          where: {
            transactionId: input.transactionId,
          },
          data: {
            status: TransactionStatus.COMPLETED,
          },
        });
        // emit success transaction event
        await tx.outboxEvent.create({
          data: {
            event: 'TransactionCompleted',
            aggregateId: input.transactionId,
            payload: {
              eventType: 'TransactionCompleted',
              eventVersion: 1,
              transactionId: resultTxn.transactionId,
              accountId: resultTxn.accountId,
              type: resultTxn.type,
              amount: resultTxn.amount.toString(),
              balanceAfter: balanceAfter.toString(),
            },
          },
        });
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
          data: toTransactionResponse(resultTxn),
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
