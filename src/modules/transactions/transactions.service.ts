import { TransactionType, UserRole } from '../../../generated/prisma/enums';
import type { TransactionRepository } from './transactions.repository';
import type {
  CreateTransactionInput,
  TransactionInfo,
} from './transactions.schemas';

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}

  async create(
    input: CreateTransactionInput,
    auth: { userId: string; role: UserRole },
  ): Promise<{
    success: boolean;
    message?: string;
    statusCode?: number;
    data?: TransactionInfo;
  }> {
    const transactionInfo = await this.repository.findTransaction({
      txnId: input.transactionId,
    });
    if (transactionInfo) {
      return { success: true, data: transactionInfo };
    }
    return await this.repository.create(input, auth);
  }
}
