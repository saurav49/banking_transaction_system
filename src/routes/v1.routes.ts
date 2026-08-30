import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { userRouter } from '../modules/users/user.routes';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/users', userRouter);
