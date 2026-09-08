import { describe, expect, test } from 'bun:test';
import {
  transactionBlockedEventSchema,
  transactionCompletedEventSchema,
  transactionCompletedPayloadSchema,
  transactionEventSchema,
} from '../../src/modules/outbox-events/outbox-events.schema';
import { rebuildBalances } from '../../src/modules/replay/replay.service';

const accountId = '550e8400-e29b-41d4-a716-446655440000';

describe('event processing', () => {
  test('validates the Kafka transaction envelope and payload', () => {
    const event = transactionCompletedEventSchema.parse({
      eventId: '550e8400-e29b-41d4-a716-446655440001',
      eventType: 'TransactionCompleted',
      eventVersion: 1,
      aggregateId: 'txn-1',
      transactionId: 'txn-1',
      occurredAt: '2026-09-09T00:00:00.000Z',
      payload: {
        type: 'TransactionCompleted',
        transactionId: 'txn-1',
        accountId,
        txnType: 'DEBIT',
        amount: '12000',
        balanceAfter: '88000',
      },
    });

    expect(event.payload.amount).toBe('12000');
    expect(() =>
      transactionCompletedPayloadSchema.parse({
        ...event.payload,
        amount: '-1',
      }),
    ).toThrow();
  });

  test('rebuilds balances in event order', () => {
    const balances = rebuildBalances([
      {
        id: 'event-2',
        transactionId: 'txn-2',
        createdAt: new Date('2026-09-09T00:01:00.000Z'),
        payload: {
          type: 'TransactionCompleted',
          transactionId: 'txn-2',
          accountId,
          txnType: 'DEBIT',
          amount: '12000',
          balanceAfter: '88000',
        },
      },
      {
        id: 'event-1',
        transactionId: 'txn-1',
        createdAt: new Date('2026-09-09T00:00:00.000Z'),
        payload: {
          type: 'TransactionCompleted',
          transactionId: 'txn-1',
          accountId,
          txnType: 'CREDIT',
          amount: '100000',
          balanceAfter: '100000',
        },
      },
    ]);

    expect(balances.get(accountId)).toBe(88000n);
  });

  test('accepts blocked events for asynchronous fraud analysis', () => {
    const event = transactionBlockedEventSchema.parse({
      eventId: '550e8400-e29b-41d4-a716-446655440002',
      eventType: 'TransactionBlocked',
      eventVersion: 1,
      aggregateId: 'txn-blocked',
      transactionId: 'txn-blocked',
      occurredAt: '2026-09-09T00:00:00.000Z',
      payload: {
        type: 'TransactionBlocked',
        transactionId: 'txn-blocked',
        accountId,
        txnType: 'DEBIT',
        amount: '1000000',
        ipAddress: '127.0.0.1',
        deviceFingerprint: 'attack-device',
        reason: 'VELOCITY_LIMIT',
      },
    });

    expect(event.payload.reason).toBe('VELOCITY_LIMIT');
  });

  test('rejects a scalar poison payload before a consumer handles it', () => {
    expect(() =>
      transactionEventSchema.parse({
        eventId: '550e8400-e29b-41d4-a716-446655440003',
        eventType: 'TransactionCompleted',
        eventVersion: 1,
        aggregateId: 'txn-poison',
        transactionId: 'txn-poison',
        occurredAt: '2026-09-09T00:00:00.000Z',
        payload: 'corrupted',
      }),
    ).toThrow();
  });
});
