import type { EachMessagePayload } from 'kafkajs';
import { config } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { kafka } from '../../infrastructure/kafka/kafka';
import { kafkaProducer } from '../../infrastructure/kafka/producer';
import { logger } from '../../infrastructure/logging/logger';
import {
  transactionCompletedEventSchema,
  transactionEventSchema,
} from '../../modules/outbox-events/outbox-events.schema';
import { TOPICS } from '../../shared/constants';

const CONSUMER_NAME = 'banking-ledger-service-v1';
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });
let shuttingDown = false;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelayMs(retryNumber: number): number {
  const exponent = Math.min(retryNumber, 16);
  return Math.min(config.CONSUMER_RETRY_BASE_MS * 2 ** exponent, 60_000);
}

async function processMessage({ message }: EachMessagePayload): Promise<void> {
  const rawValue = message.value?.toString();
  if (!rawValue) throw new Error('Kafka message has no value');

  const event = transactionEventSchema.parse(JSON.parse(rawValue));
  await prisma.$transaction(async (tx) => {
    const processedEvent = await tx.processedEvent.findUnique({
      where: {
        consumerName_eventId: {
          consumerName: CONSUMER_NAME,
          eventId: event.eventId,
        },
      },
    });
    if (processedEvent) return;

    if (event.eventType === 'TransactionCompleted') {
      const completedEvent = transactionCompletedEventSchema.parse(event);
      const payload = completedEvent.payload;

      await tx.ledgerEntry.create({
        data: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          type: payload.txnType,
          amount: BigInt(payload.amount),
          balanceAfter: BigInt(payload.balanceAfter),
        },
      });
    }

    await tx.processedEvent.create({
      data: {
        eventId: event.eventId,
        consumerName: CONSUMER_NAME,
      },
    });
  });
}

async function publishToDlq(
  payload: EachMessagePayload,
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
          consumer: CONSUMER_NAME,
          failedAt: new Date().toISOString(),
          attempts,
          error: getErrorMessage(error),
          originalValue: payload.message.value?.toString() ?? null,
        }),
      },
    ],
  });
}

async function processWithRetry(payload: EachMessagePayload): Promise<void> {
  const maxAttempts = config.CONSUMER_MAX_RETRIES + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await processMessage(payload);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      await Bun.sleep(retryDelayMs(attempt));
    }
  }

  await publishToDlq(payload, lastError, maxAttempts);
  logger.error(
    { attempts: maxAttempts, error: getErrorMessage(lastError) },
    'Ledger event moved to DLQ',
  );
}

async function run(): Promise<void> {
  await consumer.connect();
  await kafkaProducer.connect();
  await consumer.subscribe({
    topic: TOPICS.banking_transaction,
    fromBeginning: true,
  });
  logger.info('Ledger consumer started');

  await consumer.run({
    eachMessage: async (payload) => {
      if (shuttingDown) return;
      await processWithRetry(payload);
    },
  });
}

async function requestShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Stopping ledger consumer');
  try {
    await consumer.stop();
  } catch (error) {
    logger.error({ err: error }, 'Failed to stop ledger consumer cleanly');
  }
}

process.once('SIGINT', (signal) => void requestShutdown(signal));
process.once('SIGTERM', (signal) => void requestShutdown(signal));

try {
  await run();
} catch (error) {
  logger.fatal({ err: error }, 'Ledger consumer stopped unexpectedly');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    consumer.disconnect(),
    kafkaProducer.disconnect(),
    prisma.$disconnect(),
  ]);
  logger.info('Ledger consumer stopped');
}
