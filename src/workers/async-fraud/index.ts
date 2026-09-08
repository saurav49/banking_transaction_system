import { kafka } from '../../infrastructure/kafka/kafka';
import { prisma } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logging/logger';
import {
  transactionBlockedEventSchema,
  transactionCompletedEventSchema,
  type TransactionEvent,
} from '../../modules/outbox-events/outbox-events.schema';
import { TOPICS } from '../../shared/constants';
import { runConsumer } from '../shared/consumer-runtime';

const CONSUMER_NAME = 'banking-async-fraud-service-v1';
const WINDOW_MS = 60_000;
const SUSPICIOUS_COUNT = 5;
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });

async function handleEvent(event: TransactionEvent): Promise<void> {
  if (
    event.eventType !== 'TransactionCompleted' &&
    event.eventType !== 'TransactionBlocked'
  ) {
    return;
  }

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

    const payload =
      event.eventType === 'TransactionCompleted'
        ? transactionCompletedEventSchema.parse(event).payload
        : transactionBlockedEventSchema.parse(event).payload;
    const observedAt = new Date(event.occurredAt);
    const signals = [
      payload.deviceFingerprint
        ? { signalType: 'DEVICE', signalValue: payload.deviceFingerprint }
        : null,
      payload.ipAddress
        ? { signalType: 'IP', signalValue: payload.ipAddress }
        : null,
    ].filter(
      (signal): signal is { signalType: string; signalValue: string } =>
        signal !== null,
    );

    await tx.fraudSignal.createMany({
      data: signals.map((signal) => ({
        accountId: payload.accountId,
        signalType: signal.signalType,
        signalValue: signal.signalValue,
        transactionId: payload.transactionId,
        observedAt,
      })),
      skipDuplicates: true,
    });

    let suspicious = false;
    for (const signal of signals) {
      const count = await tx.fraudSignal.count({
        where: {
          signalType: signal.signalType,
          signalValue: signal.signalValue,
          observedAt: {
            gte: new Date(observedAt.getTime() - WINDOW_MS),
            lte: observedAt,
          },
        },
      });
      if (count > SUSPICIOUS_COUNT) {
        suspicious = true;
        logger.warn(
          {
            accountId: payload.accountId,
            transactionId: payload.transactionId,
            signal: `${signal.signalType}:${signal.signalValue}`,
            countLastMinute: count,
          },
          'Suspicious transaction pattern detected',
        );
      }
    }

    if (suspicious) {
      const account = await tx.account.findUnique({
        where: { id: payload.accountId },
        select: { fraudFlaggedAt: true },
      });
      if (account && !account.fraudFlaggedAt) {
        await tx.account.update({
          where: { id: payload.accountId },
          data: { fraudFlaggedAt: observedAt },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: 'AccountFraudFlagged',
            eventVersion: 1,
            aggregateId: payload.accountId,
            transactionId: payload.transactionId,
            topic: TOPICS.banking_transaction,
            partitionKey: payload.accountId,
            payload: {
              type: 'AccountFraudFlagged',
              accountId: payload.accountId,
              transactionId: payload.transactionId,
              reason: 'DEVICE_OR_IP_VELOCITY',
              flaggedAt: observedAt.toISOString(),
            },
          },
        });
      }
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
  logger.fatal({ err: error }, 'Async fraud consumer stopped unexpectedly');
  process.exitCode = 1;
}
