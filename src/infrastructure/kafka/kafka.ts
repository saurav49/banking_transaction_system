import { Kafka, logLevel } from 'kafkajs';
import { config } from '../../config/env';

export const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKERS.split(',').map((broker) => broker.trim()),
  logLevel: logLevel.INFO,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});
