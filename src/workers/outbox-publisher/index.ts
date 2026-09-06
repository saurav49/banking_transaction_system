import type { OutboxEvent } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { kafkaProducer } from '../../infrastructure/kafka/producer';
import { logger } from '../../infrastructure/logging/logger';
import { PrismaOutboxEventRepository } from '../../modules/outbox-events/outbox-events.repository';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 500;
const PROCESSING_LEASE_MS = 30_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const MAX_ERROR_LENGTH = 2_000;

const outboxRepository = new PrismaOutboxEventRepository();
let shuttingDown = false;

function serializeEvent(event: OutboxEvent): string {
  return JSON.stringify({
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    aggregateId: event.aggregateId,
    transactionId: event.transactionId,
    occurredAt: event.createdAt.toISOString(),
    payload: event.payload,
  });
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 16);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

async function publish(event: OutboxEvent): Promise<void> {
  try {
    await kafkaProducer.send({
      topic: event.topic,
      acks: -1,
      messages: [
        {
          key: event.partitionKey,
          value: serializeEvent(event),
        },
      ],
    });

    const updated = await outboxRepository.markOutboxEventPublished({
      id: event.id,
      leaseExpiresAt: event.nextAttemptAt,
    });

    if (!updated) {
      logger.warn({ eventId: event.id }, 'Outbox event lease was lost');
    }
  } catch (error) {
    const lastError = errorMessage(error);
    const nextAttemptAt = new Date(Date.now() + retryDelayMs(event.attempts));

    logger.error(
      { err: error, eventId: event.id, attempts: event.attempts },
      'Failed to publish outbox event',
    );

    await outboxRepository.rescheduleOutboxEvent({
      id: event.id,
      leaseExpiresAt: event.nextAttemptAt,
      lastError,
      nextAttemptAt,
    });
  }
}

async function run(): Promise<void> {
  await kafkaProducer.connect();
  logger.info('Outbox publisher started');

  while (!shuttingDown) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);

    try {
      const events = await outboxRepository.claimPendingOutboxEvents({
        now,
        leaseExpiresAt,
        limit: BATCH_SIZE,
      });

      for (const event of events) {
        if (shuttingDown) break;
        await publish(event);
      }
    } catch (error) {
      logger.error({ err: error }, 'Outbox publisher iteration failed');
    }

    if (!shuttingDown) await Bun.sleep(POLL_INTERVAL_MS);
  }
}

function requestShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Stopping outbox publisher');
}

process.once('SIGINT', () => requestShutdown('SIGINT'));
process.once('SIGTERM', () => requestShutdown('SIGTERM'));

try {
  await run();
} catch (error) {
  logger.fatal({ err: error }, 'Outbox publisher stopped unexpectedly');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([kafkaProducer.disconnect(), prisma.$disconnect()]);
  logger.info('Outbox publisher stopped');
}
