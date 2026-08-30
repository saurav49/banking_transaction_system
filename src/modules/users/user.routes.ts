import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { accountRouter } from '../accounts/account.routes';
import { PrismaUserRepository } from './user.repository';
import { createUserSchema } from './user.schemas';
import { UserService } from './user.service';

const userService = new UserService(new PrismaUserRepository());

export const userRouter = Router();

userRouter.use(authenticate, requireRole('ADMIN'));

userRouter.post('/', async (request, response) => {
  const input = createUserSchema.parse(request.body);
  const user = await userService.createUser(request.auth!, input);
  response.status(201).json({ data: user });
});

userRouter.use('/:userId/accounts', accountRouter);
