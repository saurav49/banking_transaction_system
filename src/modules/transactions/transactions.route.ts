import { Router } from 'express';
import { PrismaTransactionRepository } from './transactions.repository';
import { TransactionService } from './transactions.service';

const transactionService = new TransactionService(
  new PrismaTransactionRepository(),
);

export const transactionRoute = Router();

transactionRoute.post('/', async (request, response) => {
  // await transactionService.create();
});
