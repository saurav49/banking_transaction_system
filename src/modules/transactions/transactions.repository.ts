import type { PrismaClient } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type {
  AccountInfo,
  CreateTransactionInput,
  TransactionInfo,
} from './transactions.schemas';

export interface TransactionRepository {
  create(input: CreateTransactionInput): Promise<any>;
  findAccountInfo(input: { accountId: string }): Promise<AccountInfo | null>;
  findTransaction(input: { txnId: string }): Promise<TransactionInfo | null>;
}

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(input: CreateTransactionInput): Promise<any> {
    try {
    } catch (e) {
      throw e;
    }
  }

  async findAccountInfo(input: {
    accountId: string;
  }): Promise<AccountInfo | null> {
    try {
      return await this.db.account.findUnique({
        where: {
          id: input.accountId,
        },
      });
    } catch (e) {
      throw e;
    }
  }

  async findTransaction(input: {
    txnId: string;
  }): Promise<TransactionInfo | null> {
    try {
      return await this.db.transaction.findUnique({
        where: {
          transactionId: input.txnId,
        },
      });
    } catch (e) {
      throw e;
    }
  }
}
