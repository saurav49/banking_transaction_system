import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { config } from '../../config/env';
import { logger } from '../logging/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    errorFormat: config.NODE_ENV === 'production' ? 'minimal' : 'pretty',
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn', (event) => {
    logger.warn(
      { component: 'prisma', target: event.target },
      event.message,
    );
  });
  client.$on('error', (event) => {
    logger.error(
      { component: 'prisma', target: event.target },
      event.message,
    );
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
