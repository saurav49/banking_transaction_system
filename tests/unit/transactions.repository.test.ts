import { describe, expect, test } from 'bun:test';
import type { Request } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transactions.repository';
import type { CreateTransactionInput } from '../../src/modules/transactions/transactions.schemas';

function createFakeDatabase(initialBalance = 100n) {
  const state = {
    balance: initialBalance,
    transactions: new Map<string, any>(),
    outbox: [] as any[],
  };
  const account = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-1',
    status: 'ACTIVE',
    createdAt: new Date(),
    deletedAt: null,
  };
  const tx = {
    $queryRaw: async () => [{ ...account, balance: state.balance }],
    transaction: {
      findUnique: async ({ where }: any) =>
        state.transactions.get(where.transactionId) ?? null,
      aggregate: async ({ _count, where }: any) => {
        const recent = [...state.transactions.values()].filter(
          (transaction) =>
            transaction.createdAt >= where.createdAt.gte &&
            (!where.type || transaction.type === where.type),
        );
        return _count
          ? { _count: { id: recent.length } }
          : { _sum: { amount: recent.reduce((sum, item) => sum + item.amount, 0n) } };
      },
      create: async ({ data }: any) => {
        const transaction = {
          id: `db-${state.transactions.size + 1}`,
          ...data,
          createdAt: new Date(),
        };
        state.transactions.set(transaction.transactionId, transaction);
        return transaction;
      },
      update: async ({ where, data }: any) => {
        const transaction = state.transactions.get(where.transactionId);
        transaction.status = data.status;
        return transaction;
      },
    },
    account: {
      update: async ({ data }: any) => {
        state.balance = data.balance;
        return { ...account, balance: state.balance };
      },
    },
    outboxEvent: {
      create: async ({ data }: any) => {
        state.outbox.push(data);
        return data;
      },
    },
  };
  let tail = Promise.resolve();
  const db = {
    ...tx,
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(tx);
      } finally {
        release();
      }
    },
  };
  return { db: db as unknown as PrismaClient, state };
}

function request(): Request {
  return {
    ip: '127.0.0.1',
    headers: {},
    auth: { userId: 'user-1', role: 'CUSTOMER' },
  } as Request;
}

function input(transactionId: string, amountMinor = 10n): CreateTransactionInput {
  return {
    transactionId,
    accountId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'DEBIT',
    amountMinor,
    deviceFingerprint: 'test-device',
  };
}

describe('transaction repository', () => {
  test('returns the existing result for a duplicate request without debiting twice', async () => {
    const fake = createFakeDatabase(100n);
    const repository = new PrismaTransactionRepository(fake.db);

    const first = await repository.create(input('txn-duplicate'), request());
    const second = await repository.create(input('txn-duplicate'), request());

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: true, statusCode: 200 });
    expect(fake.state.balance).toBe(90n);
  });

  test('serializes concurrent debits while preserving the balance invariant', async () => {
    const fake = createFakeDatabase(100n);
    const repository = new PrismaTransactionRepository(fake.db);

    const results = await Promise.all([
      repository.create(input('txn-concurrent-1', 60n), request()),
      repository.create(input('txn-concurrent-2', 60n), request()),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)[0]).toMatchObject({
      statusCode: 422,
      message: 'Insufficient balance',
    });
    expect(fake.state.balance).toBe(40n);
  });

  test('blocks the sixth transaction in the rolling fraud window without changing balance', async () => {
    const fake = createFakeDatabase(100n);
    const repository = new PrismaTransactionRepository(fake.db);

    const results = [];
    for (let index = 0; index < 6; index += 1) {
      results.push(await repository.create(input(`txn-fraud-${index}`, 1n), request()));
    }

    expect(results[5]).toMatchObject({ success: false, statusCode: 422 });
    expect(fake.state.balance).toBe(95n);
    expect(fake.state.transactions.get('txn-fraud-5').status).toBe('BLOCKED');
  });
});
