import { kafka } from '../src/infrastructure/kafka/kafka';
import { TOPICS } from '../src/shared/constants';
const admin = kafka.admin();

try {
  await admin.connect();

  const created = await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: TOPICS['banking_transaction'],
        numPartitions: 3,
        replicationFactor: 1,
      },
      {
        topic: TOPICS['banking_transaction_dlq'],
        numPartitions: 3,
        replicationFactor: 1,
      },
    ],
  });

  console.info(created ? 'Kafka topics created' : 'Kafka topics already exist');
} finally {
  await admin.disconnect();
}
