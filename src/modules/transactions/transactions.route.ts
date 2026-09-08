import { Router } from 'express';
import { PrismaTransactionRepository } from './transactions.repository';
import { TransactionService } from './transactions.service';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { createTransactionSchema } from './transactions.schemas';
import { prisma } from '../../infrastructure/database/prisma';
import {
  publishRealtimeEvent,
  subscribeToTransaction,
} from '../realtime/realtime.service';

const transactionService = new TransactionService(
  new PrismaTransactionRepository(),
);

export const transactionRouter = Router();

transactionRouter.use(authenticate, requireRole('CUSTOMER', 'ADMIN'));

transactionRouter.post('/', async (request, response) => {
  const input = createTransactionSchema.parse(request.body);
  publishRealtimeEvent({
    transactionId: input.transactionId,
    eventType: 'TransactionPending',
    data: { transactionId: input.transactionId, status: 'PENDING' },
  });
  const transaction = await transactionService.create(input, request);
  if (transaction.success) {
    response.status(transaction.statusCode).json({ data: transaction.data });
  } else {
    response
      .status(transaction.statusCode!)
      .json({ message: transaction.message });
  }
});

transactionRouter.get('/:transactionId/events', async (request, response) => {
  const transactionId = request.params.transactionId;
  const auth = request.auth!;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: () => void = () => {};

  const sendEvent = (eventType: string, data: unknown): void => {
    if (closed) return;
    response.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  unsubscribe = subscribeToTransaction(transactionId, (event) => {
    sendEvent(event.eventType, event.data);
  });

  const transaction = await prisma.transaction.findUnique({
    where: { transactionId },
    include: { account: { select: { userId: true } } },
  });
  if (!transaction) {
    unsubscribe();
    response.status(404).json({ message: 'Transaction not found' });
    return;
  }
  if (auth.role !== 'ADMIN' && auth.userId !== transaction.account.userId) {
    unsubscribe();
    response.status(403).json({ message: 'Unauthorized access' });
    return;
  }

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);

  const initialEventType =
    transaction.status === 'BLOCKED'
      ? 'TransactionBlocked'
      : transaction.status === 'FINALIZED'
        ? 'TransactionFinalized'
        : transaction.status === 'COMPLETED'
          ? 'TransactionCompleted'
          : 'TransactionPending';
  sendEvent(initialEventType, {
    transactionId: transaction.transactionId,
    accountId: transaction.accountId,
    type: transaction.type,
    amount: transaction.amount.toString(),
    status: transaction.status,
  });

  request.on('close', () => {
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
  });
});
