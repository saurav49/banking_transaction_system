import { kafka } from '../src/infrastructure/kafka/kafka';

const admin = kafka.admin();

try {
  await admin.connect();

  const created = await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: 'banking.transaction-events.v1',
        numPartitions: 3,
        replicationFactor: 1,
      },
    ],
  });

  console.info(created ? 'Kafka topics created' : 'Kafka topics already exist');
} finally {
  await admin.disconnect();
}
