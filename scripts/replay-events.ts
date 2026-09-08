import { prisma } from '../src/infrastructure/database/prisma';
import { rebuildBalances } from '../src/modules/replay/replay.service';

const accountId = process.argv.find((argument) => argument.startsWith('--account-id='))?.split('=')[1];
const transactionId = process.argv.find((argument) => argument.startsWith('--transaction-id='))?.split('=')[1];

try {
  const events = await prisma.outboxEvent.findMany({
    where: {
      eventType: 'TransactionCompleted',
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      transactionId: true,
      eventType: true,
      createdAt: true,
      payload: true,
    },
  });
  const accountEvents = accountId
    ? events.filter(
        (event) =>
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { accountId?: unknown }).accountId === accountId,
      )
    : events;
  const balances = rebuildBalances(accountEvents);
  const traceEvents = transactionId
    ? events.filter((event) => event.transactionId === transactionId)
    : accountEvents;

  const result = Object.fromEntries(
    [...balances.entries()]
      .filter(([id]) => !accountId || id === accountId)
      .map(([id, balance]) => [id, balance.toString()]),
  );
  console.log(
    JSON.stringify(
      {
        eventCount: accountEvents.length,
        rebuiltBalances: result,
        trace: traceEvents.map((event) => ({
          eventId: event.id,
          transactionId: event.transactionId,
          accountId: (event.payload as { accountId?: string }).accountId,
          eventType: event.eventType,
          createdAt: event.createdAt.toISOString(),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
