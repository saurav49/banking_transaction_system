import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { userRouter } from '../modules/users/user.routes';
import { transactionRouter } from '../modules/transactions/transactions.route';
import { replayRouter } from '../modules/replay/replay.routes';
import { analyticsRouter } from '../modules/analytics/analytics.routes';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/transactions', transactionRouter);
router.use('/replay', replayRouter);
router.use('/analytics', analyticsRouter);
