import type { EachMessagePayload } from 'kafkajs';
import { config } from '../../config/env';
import { kafkaProducer } from '../../infrastructure/kafka/producer';
import { logger } from '../../infrastructure/logging/logger';
import {
  transactionEventSchema,
  type TransactionEvent,
} from '../../modules/outbox-events/outbox-events.schema';
import { TOPICS } from '../../shared/constants';

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function retryDelayMs(retryNumber: number): number {
  const exponent = Math.min(retryNumber, 16);
  return Math.min(config.CONSUMER_RETRY_BASE_MS * 2 ** exponent, 60_000);
}

export function decodeTransactionEvent(
  payload: EachMessagePayload,
): TransactionEvent {
  const rawValue = payload.message.value?.toString();
  if (!rawValue) throw new Error('Kafka message has no value');
  return transactionEventSchema.parse(JSON.parse(rawValue));
}

async function publishToDlq(
  payload: EachMessagePayload,
  consumerName: string,
  error: unknown,
  attempts: number,
): Promise<void> {
  await kafkaProducer.send({
    topic: TOPICS.banking_transaction_dlq,
    acks: -1,
    messages: [
      {
        key: payload.message.key?.toString(),
        value: JSON.stringify({
          consumer: consumerName,
          sourceTopic: payload.topic,
          sourcePartition: payload.partition,
          sourceOffset: payload.message.offset,
          failedAt: new Date().toISOString(),
          attempts,
          error: getErrorMessage(error),
          originalValue: payload.message.value?.toString() ?? null,
        }),
      },
    ],
  });
}

export async function processWithRetry(
  payload: EachMessagePayload,
  consumerName: string,
  handler: () => Promise<void>,
  options: {
    maxAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    publishDlq?: (
      payload: EachMessagePayload,
      consumerName: string,
      error: unknown,
      attempts: number,
    ) => Promise<void>;
  } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? config.CONSUMER_MAX_RETRIES + 1;
  const sleep = options.sleep ?? Bun.sleep;
  const publishDlq = options.publishDlq ?? publishToDlq;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await handler();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      await sleep(retryDelayMs(attempt));
    }
  }

  await publishDlq(payload, consumerName, lastError, maxAttempts);
  logger.error(
    { consumerName, attempts: maxAttempts, error: getErrorMessage(lastError) },
    'Event moved to DLQ',
  );
}
