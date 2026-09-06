import {
  type OutboxEvent,
  OutboxEventStatus,
  type PrismaClient,
} from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export interface ClaimPendingOutboxEventsInput {
  now: Date;
  leaseExpiresAt: Date;
  limit: number;
}

export interface UpdateClaimedOutboxEventInput {
  id: string;
  leaseExpiresAt: Date;
}

export interface RescheduleOutboxEventInput
  extends UpdateClaimedOutboxEventInput {
  lastError: string;
  nextAttemptAt: Date;
}

export interface OutboxEventRepository {
  claimPendingOutboxEvents(
    input: ClaimPendingOutboxEventsInput,
  ): Promise<OutboxEvent[]>;
  rescheduleOutboxEvent(input: RescheduleOutboxEventInput): Promise<boolean>;
  markOutboxEventPublished(
    input: UpdateClaimedOutboxEventInput,
  ): Promise<boolean>;
}

export class PrismaOutboxEventRepository implements OutboxEventRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  claimPendingOutboxEvents(
    input: ClaimPendingOutboxEventsInput,
  ): Promise<OutboxEvent[]> {
    return this.db.outboxEvent.updateManyAndReturn({
      where: {
        OR: [
          {
            status: OutboxEventStatus.PENDING,
            nextAttemptAt: { lte: input.now },
          },
          {
            status: OutboxEventStatus.PROCESSING,
            nextAttemptAt: { lte: input.now },
          },
        ],
      },
      data: {
        status: OutboxEventStatus.PROCESSING,
        attempts: { increment: 1 },
        nextAttemptAt: input.leaseExpiresAt,
      },
      limit: input.limit,
    });
  }

  async rescheduleOutboxEvent(
    input: RescheduleOutboxEventInput,
  ): Promise<boolean> {
    const result = await this.db.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: OutboxEventStatus.PROCESSING,
        nextAttemptAt: input.leaseExpiresAt,
      },
      data: {
        status: OutboxEventStatus.PENDING,
        lastError: input.lastError,
        nextAttemptAt: input.nextAttemptAt,
      },
    });

    return result.count === 1;
  }

  async markOutboxEventPublished(
    input: UpdateClaimedOutboxEventInput,
  ): Promise<boolean> {
    const result = await this.db.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: OutboxEventStatus.PROCESSING,
        nextAttemptAt: input.leaseExpiresAt,
      },
      data: {
        status: OutboxEventStatus.PUBLISHED,
        publishedAt: new Date(),
        lastError: null,
      },
    });

    return result.count === 1;
  }
}
