import { config } from '../../config/env';
import { AuthenticationError } from '../../shared/errors/app-error';
import type { AuthRepository } from './auth.repository';
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
} from './token.service';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$ZK6+pHrGGzs+WrfS38YlwYBzWdv64r1EXBGFXPDRERM$9P3vR9PoeKAvHr4noPptQFPdlcAkTyq2z9ncEjbknac';

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
};

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async login(input: { email: string; password: string }): Promise<TokenPair> {
    const user = await this.repository.findUserByEmail(input.email);
    const passwordMatches = await Bun.password.verify(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (
      !user ||
      !passwordMatches ||
      user.status !== 'ACTIVE' ||
      user.deletedAt
    ) {
      throw new AuthenticationError(
        'Invalid email or password',
        'INVALID_CREDENTIALS',
      );
    }

    return this.issueTokenPair(user.id, user.role);
  }

  async refresh(currentRefreshToken: string): Promise<TokenPair> {
    const nextRefreshToken = createRefreshToken();
    const now = new Date();
    const nextExpiresAt = new Date(
      now.getTime() + config.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    const user = await this.repository.rotateRefreshSession({
      currentTokenHash: hashRefreshToken(currentRefreshToken),
      nextTokenHash: hashRefreshToken(nextRefreshToken),
      nextExpiresAt,
      now,
    });

    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new AuthenticationError(
        'Invalid or expired refresh token',
        'INVALID_REFRESH_TOKEN',
      );
    }

    return {
      accessToken: await createAccessToken({
        userId: user.id,
        role: user.role,
      }),
      refreshToken: nextRefreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: config.REFRESH_TOKEN_TTL_SECONDS,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeRefreshSession(
      hashRefreshToken(refreshToken),
      new Date(),
    );
  }

  private async issueTokenPair(
    userId: string,
    role: 'ADMIN' | 'CUSTOMER',
  ): Promise<TokenPair> {
    const refreshToken = createRefreshToken();
    await this.repository.createRefreshSession({
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    });

    return {
      accessToken: await createAccessToken({ userId, role }),
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: config.REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}
