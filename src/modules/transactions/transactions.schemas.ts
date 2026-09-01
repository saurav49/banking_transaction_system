import { z } from 'zod';

const TransactionTypeSchema = z.enum(['DEBIT', 'CREDIT']);

const CreateTransactionSchema = z.object({
  transactionId: z.string(),
  accountId: z.string(),
  type: TransactionTypeSchema,
  amountMinor: z.string(),
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeSchema>;
