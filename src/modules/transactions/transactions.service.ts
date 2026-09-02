import { TransactionType } from '../../../generated/prisma/enums';
import type { TransactionRepository } from './transactions.repository';
import type { CreateTransactionInput } from './transactions.schemas';

// - Part 1: Core Transaction Engine (Must Be Sync)

//     ### API: `POST /transactions`

//     ```json
//     {
//     		"transaction_id":"txn_001",
//     		"account_id":"acc_123",
//     		"type":"DEBIT",
//     		"amount":12000
//     }
//     ```

//     ### Requirements

//     You **must** ensure:

//     - Exactly-once balance update -> 1 transaction (in repo)
//     - Row-level locking or equivalent -> 1 transaction (in repo)
//     - Idempotency using `transaction_id`
//     - Immediate fraud blocking (basic rules) -> to be handled later
//     - Atomic DB transaction -> 1 transaction (in repo)

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}

  async create(input: CreateTransactionInput): Promise<{
    success: boolean;
    message?: string;
    statusCode?: number;
  }> {
    const accountInfo = await this.repository.findAccountInfo({
      accountId: input.accountId,
    });
    const transactionInfo = await this.repository.findTransaction({
      txnId: input.transactionId,
    });
    if (!accountInfo) {
      return {
        success: false,
        statusCode: 404,
        message: 'Account not found',
      };
    }
    if (transactionInfo) {
      return {
        success: false,
        statusCode: 401,
        message: 'Transaction already present',
      };
    }
    if (input.type === TransactionType.DEBIT) {
      if (accountInfo && input.amountMinor > accountInfo.balance) {
        return {
          success: false,
          statusCode: 401,
          message: 'Insufficient balance',
        };
      }
    }
    return {
      success: true,
    };
  }
}
