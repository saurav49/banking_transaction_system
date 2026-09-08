import { EventEmitter } from 'node:events';

export interface RealtimeTransactionEvent {
  transactionId: string;
  eventType: string;
  data: unknown;
}

const events = new EventEmitter();
events.setMaxListeners(0);

export function publishRealtimeEvent(event: RealtimeTransactionEvent): void {
  events.emit(event.transactionId, event);
}

export function subscribeToTransaction(
  transactionId: string,
  listener: (event: RealtimeTransactionEvent) => void,
): () => void {
  events.on(transactionId, listener);
  return () => events.off(transactionId, listener);
}
