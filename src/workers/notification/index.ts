import { prisma } from '../../infrastructure/database/prisma';
import { kafka } from '../../infrastructure/kafka/kafka';
import { logger } from '../../infrastructure/logging/logger';
import type { TransactionEvent } from '../../modules/outbox-events/outbox-events.schema';
import { runConsumer } from '../shared/consumer-runtime';

const CONSUMER_NAME = 'banking-notification-service-v1';
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });

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

    logger.info(
      { transactionId: event.transactionId, eventType: event.eventType },
      'Simulated customer notification sent',
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
  logger.fatal({ err: error }, 'Notification consumer stopped unexpectedly');
  process.exitCode = 1;
}
