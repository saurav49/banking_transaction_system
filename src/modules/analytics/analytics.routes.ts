import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { prisma } from '../../infrastructure/database/prisma';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireRole('ADMIN'));

analyticsRouter.get('/', async (_request, response) => {
  const metrics = await prisma.analyticsMetric.findMany({
    orderBy: { bucketStart: 'desc' },
    take: 24,
  });

  response.json({
    data: metrics.map((metric) => ({
      bucketStart: metric.bucketStart.toISOString(),
      completedCount: metric.completedCount,
      completedAmountMinor: metric.completedAmount.toString(),
      finalizedCount: metric.finalizedCount,
      finalizedAmountMinor: metric.finalizedAmount.toString(),
      updatedAt: metric.updatedAt.toISOString(),
    })),
  });
});
