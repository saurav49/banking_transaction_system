import pino from 'pino';
import { config } from '../../config/env';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      '*.password',
      'accessToken',
      'refreshToken',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
});
