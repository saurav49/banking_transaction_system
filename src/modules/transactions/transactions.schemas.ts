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

export const createTransactionSchema = z
  .object({
    transactionId: z.string().trim().min(1).max(100),
    accountId: z.uuid(),
    type: transactionTypeSchema,
    amountMinor: amountMinorSchema,
    deviceFingerprint: z.string().trim().min(1).max(256),
  })
  .strict();

export const accountInfoSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    balance: z.bigint(),
    status: z.string(),
    createdAt: z.date(),
    deletedAt: z.date().nullable(),
  })
  .strict();

export const transactionInfoSchema = z
  .object({
    id: z.string(),
    transactionId: z.string().trim().min(1).max(100),
    accountId: z.uuid(),
    type: transactionTypeSchema,
    amount: z.bigint(),
    status: transactionStatusSchema,
    createdAt: z.date(),
  })
  .strict();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type TransactionInfo = z.infer<typeof transactionInfoSchema>;
export type AccountInfo = z.infer<typeof accountInfoSchema>;

export type TransactionResponse = Omit<
  TransactionInfo,
  'amount' | 'createdAt'
> & {
  amount: string;
  createdAt: string;
};

export type TransactionResult =
  | {
      success: true;
      statusCode: 200 | 201;
      data: TransactionResponse;
    }
  | {
      success: false;
      statusCode: number;
      message: string;
    };
