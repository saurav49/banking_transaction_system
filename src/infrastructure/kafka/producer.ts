import { kafka } from './kafka';

export const kafkaProducer = kafka.producer({
  allowAutoTopicCreation: false,
});
