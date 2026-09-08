import { prisma } from '../../infrastructure/database/prisma';
import { kafka } from '../../infrastructure/kafka/kafka';
import { logger } from '../../infrastructure/logging/logger';
import {
  transactionCompletedEventSchema,
  type TransactionEvent,
} from '../../modules/outbox-events/outbox-events.schema';
import { TOPICS } from '../../shared/constants';
import { runConsumer } from '../shared/consumer-runtime';

const CONSUMER_NAME = 'banking-ledger-service-v1';
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });

async function handleEvent(event: TransactionEvent): Promise<void> {
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
      const payload = transactionCompletedEventSchema.parse(event).payload;
      await tx.$queryRaw`
        SELECT "id"
        FROM "Transaction"
        WHERE "transactionId" = ${payload.transactionId}
        FOR UPDATE
      `;
      await tx.ledgerEntry.create({
        data: {
          transactionId: payload.transactionId,
          accountId: payload.accountId,
          type: payload.txnType,
          amount: BigInt(payload.amount),
          balanceAfter: BigInt(payload.balanceAfter),
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'LedgerUpdated',
          eventVersion: 1,
          aggregateId: payload.transactionId,
          transactionId: payload.transactionId,
          topic: TOPICS.banking_transaction,
          partitionKey: payload.accountId,
          payload: {
            type: 'LedgerUpdated',
            transactionId: payload.transactionId,
            accountId: payload.accountId,
            txnType: payload.txnType,
            amount: payload.amount,
            balanceAfter: payload.balanceAfter,
          },
        },
      });
    }

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
  logger.fatal({ err: error }, 'Ledger consumer stopped unexpectedly');
  process.exitCode = 1;
}
