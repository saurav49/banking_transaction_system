import { Router } from 'express';
import { PrismaAccountRepository } from './account.repository';
import { accountParamsSchema } from './account.schemas';
import { AccountService } from './account.service';

const accountService = new AccountService(new PrismaAccountRepository());

export const accountRouter = Router({ mergeParams: true });

accountRouter.post('/', async (request, response) => {
  const { userId } = accountParamsSchema.parse(request.params);
  const account = await accountService.createAccount(request.auth!, userId);
  response.status(201).json({ data: account });
});
