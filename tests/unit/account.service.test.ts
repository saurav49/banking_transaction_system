import { describe, expect, test } from 'bun:test';
import type { AccountRepository } from '../../src/modules/accounts/account.repository';
import { AccountService } from '../../src/modules/accounts/account.service';

describe('AccountService', () => {
  test('creates a zero-balance account for an active user', async () => {
    const repository: AccountRepository = {
      async createForActiveUser(userId) {
        return {
          id: '7e201ca7-6feb-4260-b5e1-50e9008ba619',
          userId,
          balance: 0n,
          status: 'ACTIVE',
          createdAt: new Date('2026-08-30T00:00:00.000Z'),
        };
      },
    };
    const service = new AccountService(repository);

    const account = await service.createAccount(
      { userId: 'admin-id', role: 'ADMIN' },
      '02fd9e70-e2d9-4c44-a65f-55a1a8952bdd',
    );

    expect(account.balanceMinor).toBe('0');
    expect(account.status).toBe('ACTIVE');
  });

  test('rejects account creation for a missing or inactive user', async () => {
    const repository: AccountRepository = {
      async createForActiveUser() {
        return null;
      },
    };
    const service = new AccountService(repository);

    expect(
      service.createAccount(
        { userId: 'admin-id', role: 'ADMIN' },
        '02fd9e70-e2d9-4c44-a65f-55a1a8952bdd',
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_OWNER_NOT_FOUND',
    });
  });
});
