import type { PrismaClient } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { CreateTransactionInput } from './transactions.schemas';

export interface TransactionRepository {
  create(input: CreateTransactionInput): Promise<any>;
}

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(input: CreateTransactionInput): Promise<any> {
    try {
    } catch (e) {
      throw e;
    }
  }
}
