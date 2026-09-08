import { prisma } from '../../infrastructure/database/prisma';
import { kafka } from '../../infrastructure/kafka/kafka';
import { logger } from '../../infrastructure/logging/logger';
import {
  transactionCompletedEventSchema,
  transactionFinalizedEventSchema,
  type TransactionEvent,
} from '../../modules/outbox-events/outbox-events.schema';
import { runConsumer } from '../shared/consumer-runtime';

const CONSUMER_NAME = 'banking-analytics-service-v1';
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });

function hourBucket(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    ),
  );
}

async function handleEvent(event: TransactionEvent): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const processed = await tx.processedEvent.findUnique({
      where: {
        consumerName_eventId: {
          consumerName: CONSUMER_NAME,
          eventId: event.eventId,
        },
      },
    });
    if (processed) return;

    if (event.eventType === 'TransactionCompleted') {
      const payload = transactionCompletedEventSchema.parse(event).payload;
      await tx.analyticsMetric.upsert({
        where: { bucketStart: hourBucket(new Date(event.occurredAt)) },
        create: {
          bucketStart: hourBucket(new Date(event.occurredAt)),
          completedCount: 1,
          completedAmount: BigInt(payload.amount),
        },
        update: {
          completedCount: { increment: 1 },
          completedAmount: { increment: BigInt(payload.amount) },
        },
      });
    } else if (event.eventType === 'TransactionFinalized') {
      const payload = transactionFinalizedEventSchema.parse(event).payload;
      await tx.analyticsMetric.upsert({
        where: { bucketStart: hourBucket(new Date(event.occurredAt)) },
        create: {
          bucketStart: hourBucket(new Date(event.occurredAt)),
          finalizedCount: 1,
          finalizedAmount: BigInt(payload.amount),
        },
        update: {
          finalizedCount: { increment: 1 },
          finalizedAmount: { increment: BigInt(payload.amount) },
        },
      });
    }

    const metrics = await tx.analyticsMetric.findMany({
      orderBy: { bucketStart: 'desc' },
      take: 1,
    });
    const latest = metrics[0];
    logger.info(
      {
        bucketStart: latest?.bucketStart.toISOString(),
        completedTransactions: latest?.completedCount ?? 0,
        completedAmountMinor: (latest?.completedAmount ?? 0n).toString(),
        finalizedTransactions: latest?.finalizedCount ?? 0,
        finalizedAmountMinor: (latest?.finalizedAmount ?? 0n).toString(),
      },
      'Transaction metrics aggregated',
    );

    await tx.processedEvent.create({
      data: { eventId: event.eventId, consumerName: CONSUMER_NAME },
    });
  });
}

try {
  await runConsumer({
    consumer,
    consumerName: CONSUMER_NAME,
    onEvent: handleEvent,
  });
} catch (error) {
  logger.fatal({ err: error }, 'Analytics consumer stopped unexpectedly');
  process.exitCode = 1;
}
