import type { TransactionRepository } from './transactions.repository';
import type { CreateTransactionInput } from './transactions.schemas';

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}

  async create(input: CreateTransactionInput) {}
}
