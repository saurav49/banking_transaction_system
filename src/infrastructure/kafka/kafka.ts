import { Kafka, logLevel } from 'kafkajs';

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID,
  brokers: process.env.KAFKA_BROKERS!.split(','),
  logLevel: logLevel.INFO,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});
