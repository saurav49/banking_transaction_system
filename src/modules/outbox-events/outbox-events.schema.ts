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

export const transactionCompletedPayloadSchema = z
  .object({
    type: z.literal('TransactionCompleted'),
    transactionId: z.string().trim().min(1).max(100),
    accountId: z.uuid(),
    txnType: z.enum(['DEBIT', 'CREDIT']),
    amount: z.string().regex(/^[1-9]\d*$/),
    balanceAfter: z.string().regex(/^\d+$/),
    ipAddress: z.string().nullable().optional(),
    deviceFingerprint: z.string().trim().min(1).optional(),
  })
  .strict();

export const transactionEventSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.string().trim().min(1),
    eventVersion: z.number().int().positive(),
    aggregateId: z.string().trim().min(1),
    transactionId: z.string().trim().min(1).max(100),
    occurredAt: z.iso.datetime(),
    // All banking events are object payloads. Rejecting scalar/array payloads
    // here makes corrupted Kafka messages retryable and eventually DLQ-able.
    payload: z.record(z.string(), z.json()),
  })
  .strict();

export const transactionCompletedEventSchema = transactionEventSchema.extend({
  eventType: z.literal('TransactionCompleted'),
  payload: transactionCompletedPayloadSchema,
});

export const transactionBlockedEventSchema = transactionEventSchema.extend({
  eventType: z.literal('TransactionBlocked'),
  payload: z
    .object({
      type: z.literal('TransactionBlocked'),
      transactionId: z.string().trim().min(1).max(100),
      accountId: z.uuid(),
      txnType: z.enum(['DEBIT', 'CREDIT']),
      amount: z.string().regex(/^[1-9]\d*$/),
      ipAddress: z.string().nullable().optional(),
      deviceFingerprint: z.string().trim().min(1).optional(),
      reason: z.string().trim().min(1),
    })
    .strict(),
});

export const ledgerUpdatedEventSchema = transactionEventSchema.extend({
  eventType: z.literal('LedgerUpdated'),
  payload: z
    .object({
      type: z.literal('LedgerUpdated'),
      transactionId: z.string().trim().min(1).max(100),
      accountId: z.uuid(),
      txnType: z.enum(['DEBIT', 'CREDIT']),
      amount: z.string().regex(/^[1-9]\d*$/),
      balanceAfter: z.string().regex(/^\d+$/),
    })
    .strict(),
});

const finalizedPayloadSchema = z
  .object({
    type: z.literal('TransactionFinalized'),
    transactionId: z.string().trim().min(1).max(100),
    accountId: z.uuid(),
    txnType: z.enum(['DEBIT', 'CREDIT']),
    amount: z.string().regex(/^[1-9]\d*$/),
    balanceAfter: z.string().regex(/^\d+$/),
  })
  .strict();

export const transactionFinalizedEventSchema = transactionEventSchema.extend({
  eventType: z.literal('TransactionFinalized'),
  payload: finalizedPayloadSchema,
});

export type CreateOutboxEventInput = z.infer<typeof createOutboxEventSchema>;

export type OutboxEventStatus = z.infer<typeof outboxEventStatusSchema>;

export type OutboxEventInfo = z.infer<typeof outboxEventInfoSchema>;

export type TransactionEvent = z.infer<typeof transactionEventSchema>;

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
