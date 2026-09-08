import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { prisma } from '../../infrastructure/database/prisma';
import { rebuildBalances } from './replay.service';

export const replayRouter = Router();
replayRouter.use(authenticate, requireRole('CUSTOMER', 'ADMIN'));

function serializeEvent(event: {
  id: string;
  eventType: string;
  eventVersion: number;
  transactionId: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
}) {
  return {
    eventId: event.id,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    transactionId: event.transactionId,
    aggregateId: event.aggregateId,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}

replayRouter.get('/transactions/:transactionId', async (request, response) => {
  const { transactionId } = request.params;
  const transaction = await prisma.transaction.findUnique({
    where: { transactionId },
    include: { account: { select: { userId: true } } },
  });
  if (!transaction) {
    response.status(404).json({ message: 'Transaction not found' });
    return;
  }
  if (
    request.auth?.role !== 'ADMIN' &&
    request.auth?.userId !== transaction.account.userId
  ) {
    response.status(403).json({ message: 'Unauthorized access' });
    return;
  }

  const events = await prisma.outboxEvent.findMany({
    where: { transactionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eventType: true,
      eventVersion: true,
      transactionId: true,
      aggregateId: true,
      payload: true,
      createdAt: true,
    },
  });

  response.json({
    data: {
      transactionId,
      status: transaction.status,
      events: events.map(serializeEvent),
    },
  });
});

replayRouter.get('/accounts/:accountId', async (request, response) => {
  const { accountId } = request.params;
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, userId: true, fraudFlaggedAt: true },
  });
  if (!account) {
    response.status(404).json({ message: 'Account not found' });
    return;
  }
  if (request.auth?.role !== 'ADMIN' && request.auth?.userId !== account.userId) {
    response.status(403).json({ message: 'Unauthorized access' });
    return;
  }

  const events = await prisma.outboxEvent.findMany({
    where: { eventType: 'TransactionCompleted' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eventType: true,
      eventVersion: true,
      transactionId: true,
      aggregateId: true,
      payload: true,
      createdAt: true,
    },
  });
  const accountEvents = events.filter(
    (event) =>
      typeof event.payload === 'object' &&
      event.payload !== null &&
      (event.payload as { accountId?: unknown }).accountId === accountId,
  );
  const rebuiltBalance = rebuildBalances(accountEvents).get(accountId) ?? 0n;

  response.json({
    data: {
      accountId,
      fraudFlaggedAt: account.fraudFlaggedAt?.toISOString() ?? null,
      eventCount: accountEvents.length,
      rebuiltBalance: rebuiltBalance.toString(),
      events: accountEvents.map(serializeEvent),
    },
  });
});
