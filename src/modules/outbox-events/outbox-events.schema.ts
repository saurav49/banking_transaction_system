import { z } from 'zod';

export const outboxEventStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
]);

export const createOutboxEventSchema = z
  .object({
    topic: z.string().trim().min(1),
    partitionKey: z.string().trim().min(1),
    eventType: z.string().trim().min(1),
    eventVersion: z.number().int().positive(),
    aggregateId: z.string().trim().min(1),
    transactionId: z.string().trim().min(1).max(100),
    payload: z.json(),
  })
  .strict();

export const outboxEventInfoSchema = z
  .object({
    id: z.uuid(),
    topic: z.string(),
    partitionKey: z.string(),
    eventType: z.string(),
    eventVersion: z.number().int(),
    aggregateId: z.string(),
    transactionId: z.string(),
    payload: z.json(),
    status: outboxEventStatusSchema,
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.date(),
    createdAt: z.date(),
    publishedAt: z.date().nullable(),
    lastError: z.string().nullable(),
  })
  .strict();

export type CreateOutboxEventInput = z.infer<typeof createOutboxEventSchema>;

export type OutboxEventStatus = z.infer<typeof outboxEventStatusSchema>;

export type OutboxEventInfo = z.infer<typeof outboxEventInfoSchema>;

export type OutboxEventResponse = Omit<
  OutboxEventInfo,
  'nextAttemptAt' | 'createdAt' | 'publishedAt'
> & {
  nextAttemptAt: string;
  createdAt: string;
  publishedAt: string | null;
};

export type OutboxEventResult =
  | {
      success: true;
      statusCode: 200 | 201;
      data: OutboxEventResponse;
    }
  | {
      success: false;
      statusCode: number;
      message: string;
    };
