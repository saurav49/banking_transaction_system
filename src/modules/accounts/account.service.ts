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
      throw new NotFoundError(
        'The account owner does not exist or is inactive',
        'ACCOUNT_OWNER_NOT_FOUND',
      );
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
