import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { config } from '../../config/env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

  return new PrismaClient({
    adapter,
    errorFormat: config.NODE_ENV === 'production' ? 'minimal' : 'pretty',
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
