import { describe, expect, test } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaOutboxEventRepository } from '../../src/modules/outbox-events/outbox-events.repository';

describe('outbox repository', () => {
  test('reclaims a processing event after its lease expires', async () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      topic: 'banking.transaction-events.v1',
      partitionKey: 'account-1',
      eventType: 'TransactionCompleted',
      eventVersion: 1,
      aggregateId: 'txn-1',
      transactionId: 'txn-1',
      payload: {},
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date('2026-09-09T00:00:00.000Z'),
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
      publishedAt: null,
      lastError: null,
    } as any;
    const db = {
      outboxEvent: {
        updateManyAndReturn: async ({ where, data }: any) => {
          const eligible = where.OR.some(
            (condition: any) =>
              condition.status === event.status &&
              event.nextAttemptAt <= condition.nextAttemptAt.lte,
          );
          if (!eligible) return [];
          event.status = data.status;
          event.attempts += data.attempts.increment;
          event.nextAttemptAt = data.nextAttemptAt;
          return [event];
        },
      },
    };
    const repository = new PrismaOutboxEventRepository(
      db as unknown as PrismaClient,
    );
    const firstLease = new Date('2026-09-09T00:01:00.000Z');
    const first = await repository.claimPendingOutboxEvents({
      now: new Date('2026-09-09T00:00:01.000Z'),
      leaseExpiresAt: firstLease,
      limit: 1,
    });
    const second = await repository.claimPendingOutboxEvents({
      now: new Date('2026-09-09T00:02:00.000Z'),
      leaseExpiresAt: new Date('2026-09-09T00:03:00.000Z'),
      limit: 1,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(event.attempts).toBe(2);
  });
});
