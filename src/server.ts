import app from './app';
import { config } from './config/env';
import { prisma } from './infrastructure/database/prisma';
import { logger } from './infrastructure/logging/logger';
import { RealtimeConsumer } from './modules/realtime/realtime.consumer';

await prisma.$connect();

const server = app.listen(config.HTTP_PORT, config.HTTP_HOST, () => {
  logger.info(
    { host: config.HTTP_HOST, port: config.HTTP_PORT },
    'HTTP server started',
  );
});

const realtimeConsumer = new RealtimeConsumer();
void realtimeConsumer.start().catch((error) => {
  logger.error({ err: error }, 'Realtime consumer failed to start');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  server.close(async (error) => {
    try {
      await realtimeConsumer.stop();
    } catch (stopError) {
      logger.error({ err: stopError }, 'Realtime consumer shutdown failed');
    } finally {
      await prisma.$disconnect();
    }
    if (error) {
      logger.error({ err: error }, 'HTTP server shutdown failed');
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
