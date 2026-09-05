import { z } from 'zod';

export const transactionTypeSchema = z.enum(['DEBIT', 'CREDIT']);
export const transactionStatusSchema = z.enum([
  'PENDING',
  'COMPLETED',
  'BLOCKED',
  'FINALIZED',
]);

const amountMinorSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((value) => BigInt(value));

export const createTransactionSchema = z.object({
  transactionId: z.string(),
  accountId: z.string(),
  type: transactionTypeSchema,
  amountMinor: amountMinorSchema,
});

export const accountInfoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  balance: z.bigint(),
  status: z.string(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
});

export const transactionInfoSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  accountId: z.string(),
  type: transactionTypeSchema,
  amount: z.bigint(),
  status: transactionStatusSchema,
  createdAt: z.date(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type TransactionInfo = z.infer<typeof transactionInfoSchema>;
export type AccountInfo = z.infer<typeof accountInfoSchema>;
