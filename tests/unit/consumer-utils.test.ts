import { describe, expect, test } from 'bun:test';
import type { EachMessagePayload } from 'kafkajs';
import {
  processWithRetry,
  retryDelayMs,
} from '../../src/workers/shared/consumer-utils';

const payload = {
  topic: 'banking.transaction-events.v1',
  partition: 0,
  message: {
    key: Buffer.from('account-1'),
    value: Buffer.from('{}'),
    offset: '1',
    timestamp: '0',
    attributes: 0,
    headers: {},
  },
} as unknown as EachMessagePayload;

describe('consumer retry handling', () => {
  test('uses capped exponential backoff', () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(20)).toBe(60_000);
  });

  test('moves a poison message to the DLQ after the configured attempts', async () => {
    let attempts = 0;
    let dlqAttempts = 0;

    await processWithRetry(
      payload,
      'test-consumer',
      async () => {
        attempts += 1;
        throw new Error('poison');
      },
      {
        maxAttempts: 3,
        sleep: async () => {},
        publishDlq: async (_payload, consumerName, error, count) => {
          expect(consumerName).toBe('test-consumer');
          expect(error).toMatchObject({ message: 'poison' });
          dlqAttempts = count;
        },
      },
    );

    expect(attempts).toBe(3);
    expect(dlqAttempts).toBe(3);
  });

  test('retries work after a worker crash and acknowledges only on success', async () => {
    let attempts = 0;
    let sentToDlq = false;

    await processWithRetry(
      payload,
      'crash-safe-consumer',
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('simulated worker crash');
      },
      {
        maxAttempts: 3,
        sleep: async () => {},
        publishDlq: async () => {
          sentToDlq = true;
        },
      },
    );

    expect(attempts).toBe(2);
    expect(sentToDlq).toBe(false);
  });
});
