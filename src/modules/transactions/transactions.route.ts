import { Router } from 'express';
import {
  PrismaTransactionRepository,
  type TransactionRepository,
} from './transactions.repository';
import { TransactionService } from './transactions.service';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { createTransactionSchema } from './transactions.schemas';

const transactionService = new TransactionService(
  new PrismaTransactionRepository(),
);

export const transactionRouter = Router();

transactionRouter.use(authenticate, requireRole('CUSTOMER'));

transactionRouter.post('/', async (request, response) => {
  const input = createTransactionSchema.parse(request.body);
  const transaction = await transactionService.create(input, request.auth!);
  if (transaction.success) {
    response.status(201).json({ data: transaction.data });
  } else {
    response
      .status(transaction.statusCode!)
      .json({ message: transaction.message });
  }
});
