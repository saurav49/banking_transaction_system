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
    const auth = request.auth;
    if (!auth) {
      return {
        success: false,
        statusCode: 401,
        message: 'Authentication required',
      };
    }

    return this.db.$transaction(async (tx) => {
      const ipAddress =
        request.ip ||
        request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        null;
      const deviceFingerprint = input.deviceFingerprint;
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
        auth.userId !== accountInfo.userId
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

      const existingTxn = await tx.transaction.findUnique({
        where: {
          transactionId: input.transactionId,
        },
      });
      if (existingTxn) {
        const isSameRequest =
          existingTxn.accountId === input.accountId &&
          existingTxn.type === input.type &&
          existingTxn.amount === input.amountMinor;

        if (!isSameRequest) {
          return {
            success: false,
            statusCode: 409,
            message: 'Transaction conflict',
          };
        }

        if (existingTxn.status === TransactionStatus.BLOCKED) {
          return {
            success: false,
            statusCode: 422,
            message: 'Invalid transaction',
          };
        }

        return {
          success: true,
          statusCode: 200,
          data: toTransactionResponse(existingTxn),
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
      const exceedsVelocityLimit = count._count.id + 1 > config.MAX_TXN;
      const exceedsAmountLimit = totalTxnAmount > config.FRAUD_TXN_AMOUNT;
      if (exceedsVelocityLimit || exceedsAmountLimit) {
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
            eventType: 'TransactionBlocked',
            aggregateId: input.transactionId,
            transactionId: input.transactionId,
            topic: 'banking.transaction-events.v1',
            partitionKey: input.accountId,
            eventVersion: 1,
            payload: {
              type: 'TransactionBlocked',
              transactionId: resultTxn.transactionId,
              accountId: resultTxn.accountId,
              txnType: resultTxn.type,
              amount: resultTxn.amount.toString(),
              ipAddress,
              deviceFingerprint,
              reason:
                exceedsVelocityLimit && exceedsAmountLimit
                  ? 'VELOCITY_AND_AMOUNT_LIMIT'
                  : exceedsVelocityLimit
                    ? 'VELOCITY_LIMIT'
                    : 'AMOUNT_LIMIT',
            },
          },
        });
        return {
          success: false,
          statusCode: 422,
          message: 'Invalid transaction',
        };
      }

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
      // emit success transaction event
      await tx.outboxEvent.create({
        data: {
          eventType: 'TransactionCompleted',
          aggregateId: input.transactionId,
          topic: 'banking.transaction-events.v1',
          partitionKey: input.accountId,
          eventVersion: 1,
          transactionId: input.transactionId,
          payload: {
            type: 'TransactionCompleted',
            transactionId: resultTxn.transactionId,
            accountId: resultTxn.accountId,
            txnType: resultTxn.type,
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
  }

  findAccountInfo(input: { accountId: string }): Promise<AccountInfo | null> {
    return this.db.account.findUnique({
      where: {
        id: input.accountId,
        deletedAt: null,
      },
    });
  }

  findTransaction(input: {
    txnId: string;
    accountId: string;
  }): Promise<TransactionInfo | null> {
    return this.db.transaction.findUnique({
      where: {
        transactionId: input.txnId,
        accountId: input.accountId,
      },
    });
  }
}
