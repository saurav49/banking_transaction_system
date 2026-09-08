import { TransactionStatus, TransactionType } from '../../../generated/prisma/client';
import { config } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { kafka } from '../../infrastructure/kafka/kafka';
import { logger } from '../../infrastructure/logging/logger';
import { ledgerUpdatedEventSchema, type TransactionEvent } from '../../modules/outbox-events/outbox-events.schema';
import { TOPICS } from '../../shared/constants';
import { runConsumer } from '../shared/consumer-runtime';

const CONSUMER_NAME = 'banking-finalization-service-v1';
const consumer = kafka.consumer({ groupId: CONSUMER_NAME });

async function handleEvent(event: TransactionEvent): Promise<void> {
  if (event.eventType !== 'LedgerUpdated') return;

  const payload = ledgerUpdatedEventSchema.parse(event).payload;
  await prisma.$transaction(async (tx) => {
    const processed = await tx.processedEvent.findUnique({
      where: {
        consumerName_eventId: {
          consumerName: CONSUMER_NAME,
          eventId: event.eventId,
        },
      },
    });
    if (processed) return;

    const transaction = await tx.transaction.findUnique({
      where: { transactionId: payload.transactionId },
    });
    if (!transaction) throw new Error('Transaction for ledger event not found');

    if (
      transaction.status === TransactionStatus.COMPLETED &&
      transaction.authorizedAt !== null
    ) {
      await tx.transaction.update({
        where: { transactionId: payload.transactionId },
        data: { status: TransactionStatus.FINALIZED },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'TransactionFinalized',
          eventVersion: 1,
          aggregateId: payload.transactionId,
          transactionId: payload.transactionId,
          topic: TOPICS.banking_transaction,
          partitionKey: payload.accountId,
          payload: {
            type: 'TransactionFinalized',
            transactionId: payload.transactionId,
            accountId: payload.accountId,
            txnType: payload.txnType,
            amount: payload.amount,
            balanceAfter: payload.balanceAfter,
          },
        },
      });
    }

    await tx.processedEvent.create({
      data: { eventId: event.eventId, consumerName: CONSUMER_NAME },
    });
  });
}

async function compensateTimedOutTransactions(): Promise<void> {
  const cutoff = new Date(
    Date.now() - config.TRANSACTION_FINALIZATION_TIMEOUT_SECONDS * 1_000,
  );
  const timedOut = await prisma.transaction.findMany({
    where: {
      status: TransactionStatus.COMPLETED,
      createdAt: { lte: cutoff },
      ledger: null,
      authorizedAt: { not: null },
    },
    select: { transactionId: true },
    take: 50,
  });

  for (const candidate of timedOut) {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ transactionId: string; accountId: string; type: TransactionType; amount: bigint }>
      >`
        SELECT "transactionId", "accountId", "type", "amount"
        FROM "Transaction"
        WHERE "transactionId" = ${candidate.transactionId}
          AND "status" = 'COMPLETED'
        FOR UPDATE
      `;
      const transaction = rows[0];
      if (!transaction) return;

      const ledger = await tx.ledgerEntry.findUnique({
        where: { transactionId: transaction.transactionId },
      });
      if (ledger) return;

      const accountRows = await tx.$queryRaw<Array<{ balance: bigint }>>`
        SELECT "balance"
        FROM "Account"
        WHERE "id" = ${transaction.accountId}
        FOR UPDATE
      `;
      const account = accountRows[0];
      if (!account) throw new Error('Account for timed-out transaction not found');

      const balanceAfter =
        transaction.type === TransactionType.DEBIT
          ? account.balance + transaction.amount
          : account.balance - transaction.amount;
      if (balanceAfter < 0n) {
        logger.error(
          { transactionId: transaction.transactionId },
          'Unable to compensate timed-out transaction without negative balance',
        );
        return;
      }

      await tx.account.update({
        where: { id: transaction.accountId },
        data: { balance: balanceAfter },
      });
      await tx.transaction.update({
        where: { transactionId: transaction.transactionId },
        data: { status: TransactionStatus.BLOCKED },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'TransactionCompensated',
          eventVersion: 1,
          aggregateId: transaction.transactionId,
          transactionId: transaction.transactionId,
          topic: TOPICS.banking_transaction,
          partitionKey: transaction.accountId,
          payload: {
            type: 'TransactionCompensated',
            transactionId: transaction.transactionId,
            accountId: transaction.accountId,
            amount: transaction.amount.toString(),
            balanceAfter: balanceAfter.toString(),
            reason: 'LEDGER_TIMEOUT',
          },
        },
      });
    });
  }
}

const timeoutTimer = setInterval(() => {
  void compensateTimedOutTransactions().catch((error) => {
    logger.error({ err: error }, 'Finalization timeout scan failed');
  });
}, 5_000);

try {
  await runConsumer({
    consumer,
    consumerName: CONSUMER_NAME,
    onEvent: handleEvent,
  });
} catch (error) {
  logger.fatal({ err: error }, 'Finalization consumer stopped unexpectedly');
  process.exitCode = 1;
} finally {
  clearInterval(timeoutTimer);
}
