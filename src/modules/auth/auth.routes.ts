import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaAuthRepository } from './auth.repository';
import { loginSchema, refreshTokenSchema } from './auth.schemas';
import { AuthService } from './auth.service';

const authService = new AuthService(new PrismaAuthRepository());
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler(request, response) {
    response.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Try again later.',
        requestId: request.id,
      },
    });
  },
});

export const authRouter = Router();

authRouter.post('/login', authRateLimit, async (request, response) => {
  const input = loginSchema.parse(request.body);
  const tokens = await authService.login(input);
  response.status(200).json({ data: tokens });
});

authRouter.post('/refresh', authRateLimit, async (request, response) => {
  const { refreshToken } = refreshTokenSchema.parse(request.body);
  const tokens = await authService.refresh(refreshToken);
  response.status(200).json({ data: tokens });
});

authRouter.post('/logout', async (request, response) => {
  const { refreshToken } = refreshTokenSchema.parse(request.body);
  await authService.logout(refreshToken);
  response.status(204).send();
});
