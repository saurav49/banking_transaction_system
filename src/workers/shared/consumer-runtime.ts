import type { Consumer, EachMessagePayload } from 'kafkajs';
import { prisma } from '../../infrastructure/database/prisma';
import { kafkaProducer } from '../../infrastructure/kafka/producer';
import { logger } from '../../infrastructure/logging/logger';
import { TOPICS } from '../../shared/constants';
import {
  decodeTransactionEvent,
  processWithRetry,
} from './consumer-utils';

interface ConsumerRuntimeOptions {
  consumer: Consumer;
  consumerName: string;
  onEvent: (event: ReturnType<typeof decodeTransactionEvent>) => Promise<void>;
}

export async function runConsumer({
  consumer,
  consumerName,
  onEvent,
}: ConsumerRuntimeOptions): Promise<void> {
  let shuttingDown = false;

  const requestShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, consumerName }, 'Stopping consumer');
    try {
      await consumer.stop();
    } catch (error) {
      logger.error({ err: error, consumerName }, 'Consumer stop failed');
    }
  };

  process.once('SIGINT', (signal) => void requestShutdown(signal));
  process.once('SIGTERM', (signal) => void requestShutdown(signal));

  try {
    await consumer.connect();
    await kafkaProducer.connect();
    await consumer.subscribe({
      topic: TOPICS.banking_transaction,
      fromBeginning: true,
    });
    logger.info({ consumerName }, 'Consumer started');

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        if (shuttingDown) return;
        await processWithRetry(payload, consumerName, async () => {
          await onEvent(decodeTransactionEvent(payload));
        });
      },
    });
  } finally {
    await Promise.allSettled([
      consumer.disconnect(),
      kafkaProducer.disconnect(),
      prisma.$disconnect(),
    ]);
    logger.info({ consumerName }, 'Consumer stopped');
  }
}
