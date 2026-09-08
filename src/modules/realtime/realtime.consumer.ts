import { kafka } from '../../infrastructure/kafka/kafka';
import { logger } from '../../infrastructure/logging/logger';
import { transactionEventSchema } from '../outbox-events/outbox-events.schema';
import { publishRealtimeEvent } from './realtime.service';
import { TOPICS } from '../../shared/constants';

export class RealtimeConsumer {
  private readonly consumer = kafka.consumer({
    groupId: `banking-realtime-sse-${process.pid}`,
  });
  private connected = false;

  async start(): Promise<void> {
    await this.consumer.connect();
    this.connected = true;
    await this.consumer.subscribe({
      topic: TOPICS.banking_transaction,
      fromBeginning: false,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const rawValue = message.value?.toString();
        if (!rawValue) return;
        const event = transactionEventSchema.parse(JSON.parse(rawValue));
        publishRealtimeEvent({
          transactionId: event.transactionId,
          eventType: event.eventType,
          data: event.payload,
        });
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.connected) return;
    await this.consumer.stop();
    await this.consumer.disconnect();
    this.connected = false;
    logger.info('Realtime consumer stopped');
  }
}
