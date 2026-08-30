import { NotFoundError, AuthorizationError } from '../../shared/errors/app-error';
import type { AuthenticatedUser } from '../auth/token.service';
import type { AccountRepository } from './account.repository';

export type AccountResponse = {
  id: string;
  userId: string;
  balanceMinor: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
};

export class AccountService {
  constructor(private readonly repository: AccountRepository) {}

  async createAccount(actor: AuthenticatedUser, userId: string): Promise<AccountResponse> {
    if (actor.role !== 'ADMIN') {
      throw new AuthorizationError();
    }

    const account = await this.repository.createForActiveUser(userId);
    if (!account) {
      throw new NotFoundError('Active user not found');
    }

    return {
      id: account.id,
      userId: account.userId,
      balanceMinor: account.balance.toString(),
      status: account.status,
      createdAt: account.createdAt,
    };
  }
}
