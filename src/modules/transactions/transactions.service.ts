import type { Request } from 'express';
import type { TransactionRepository } from './transactions.repository';
import type {
  CreateTransactionInput,
  TransactionResult,
} from './transactions.schemas';

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}

  async create(
    input: CreateTransactionInput,
    request: Request,
  ): Promise<TransactionResult> {
    return this.repository.create(input, request);
  }

  async accountInfo(input: { accountId: string }) {
    return await this.repository.findAccountInfo({
      accountId: input.accountId,
    });
  }
}
