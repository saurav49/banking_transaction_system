import { describe, expect, test } from 'bun:test';
import type { AuthRepository } from '../../src/modules/auth/auth.repository';
import { AuthService } from '../../src/modules/auth/auth.service';

function createRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    async findUserByEmail() {
      return null;
    },
    async findActiveAuthorization() {
      return null;
    },
    async createRefreshSession() {},
    async rotateRefreshSession() {
      return null;
    },
    async revokeRefreshSession() {},
    ...overrides,
  };
}

describe('AuthService', () => {
  test('returns a consistent error when login credentials are invalid', async () => {
    const service = new AuthService(createRepository());

    expect(
      service.login({
        email: 'missing@example.com',
        password: 'incorrect-password',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });
});
