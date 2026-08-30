import { describe, expect, test } from 'bun:test';
import type { PublicUser, UserRepository } from '../../src/modules/users/user.repository';
import { UserService } from '../../src/modules/users/user.service';

const createdUser: PublicUser = {
  id: '02fd9e70-e2d9-4c44-a65f-55a1a8952bdd',
  name: 'Customer One',
  email: 'customer@example.com',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
};

describe('UserService', () => {
  test('an admin can create a customer with a hashed password', async () => {
    let savedPasswordHash = '';
    const repository: UserRepository = {
      async create(input) {
        savedPasswordHash = input.passwordHash;
        return createdUser;
      },
    };
    const service = new UserService(repository);

    const result = await service.createUser(
      { userId: 'admin-id', role: 'ADMIN' },
      {
        name: createdUser.name,
        email: createdUser.email,
        password: 'Strong-Password-123!',
      },
    );

    expect(result).toEqual(createdUser);
    expect(savedPasswordHash).not.toContain('Strong-Password-123!');
    expect(await Bun.password.verify('Strong-Password-123!', savedPasswordHash)).toBe(true);
  });

  test('a customer cannot create another user', async () => {
    const repository: UserRepository = {
      async create() {
        throw new Error('repository should not be called');
      },
    };
    const service = new UserService(repository);

    expect(
      service.createUser(
        { userId: 'customer-id', role: 'CUSTOMER' },
        {
          name: createdUser.name,
          email: createdUser.email,
          password: 'Strong-Password-123!',
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});
