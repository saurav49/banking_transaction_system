import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { UserRole } from '../../../generated/prisma/enums';
import { config } from '../../config/env';
import { AuthenticationError } from '../../shared/errors/app-error';

const accessTokenSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export type AuthenticatedUser = {
  userId: string;
  role: UserRole;
};

export async function createAccessToken(user: AuthenticatedUser): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.userId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessTokenSecret);
}

export async function verifyAccessToken(token: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, accessTokenSecret, {
      algorithms: ['HS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    });

    if (
      !payload.sub ||
      (payload.role !== 'ADMIN' && payload.role !== 'CUSTOMER')
    ) {
      throw new AuthenticationError('Invalid access token');
    }

    return { userId: payload.sub, role: payload.role };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError('Invalid or expired access token');
  }
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
