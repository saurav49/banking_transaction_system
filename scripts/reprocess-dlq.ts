import { kafka } from '../src/infrastructure/kafka/kafka';
import { kafkaProducer } from '../src/infrastructure/kafka/producer';
import { TOPICS } from '../src/shared/constants';

const consumer = kafka.consumer({
  groupId: `banking-dlq-reprocessor-${process.pid}`,
});
let stopTimer: ReturnType<typeof setTimeout> | undefined;

try {
  await consumer.connect();
  await kafkaProducer.connect();
  await consumer.subscribe({
    topic: TOPICS.banking_transaction_dlq,
    fromBeginning: true,
  });

  stopTimer = setTimeout(() => void consumer.stop(), 5_000);
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const rawValue = message.value?.toString();
      if (!rawValue) throw new Error('DLQ message has no value');
      const dlqEvent = JSON.parse(rawValue) as { originalValue?: unknown };
      if (typeof dlqEvent.originalValue !== 'string') {
        throw new Error('DLQ message does not contain originalValue');
      }

      await kafkaProducer.send({
        topic: TOPICS.banking_transaction,
        acks: -1,
        messages: [
          {
            key: message.key?.toString(),
            value: dlqEvent.originalValue,
          },
        ],
      });
      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: (BigInt(message.offset) + 1n).toString(),
        },
      ]);
      console.info(`Reprocessed DLQ message at ${topic}[${partition}:${message.offset}]`);
    },
  });
} finally {
  if (stopTimer) clearTimeout(stopTimer);
  await Promise.allSettled([
    consumer.disconnect(),
    kafkaProducer.disconnect(),
  ]);
}
