import { transactionCompletedPayloadSchema } from '../outbox-events/outbox-events.schema';

export interface ReplayEvent {
  id: string;
  transactionId: string;
  createdAt: Date;
  payload: unknown;
}

export function rebuildBalances(events: ReplayEvent[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();

  const orderedEvents = [...events].sort((left, right) => {
    const byTime = left.createdAt.getTime() - right.createdAt.getTime();
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });

  for (const event of orderedEvents) {
    const payload = transactionCompletedPayloadSchema.parse(event.payload);
    const previous = balances.get(payload.accountId) ?? 0n;
    const amount = BigInt(payload.amount);
    balances.set(
      payload.accountId,
      payload.txnType === 'DEBIT' ? previous - amount : previous + amount,
    );
  }

  return balances;
}
