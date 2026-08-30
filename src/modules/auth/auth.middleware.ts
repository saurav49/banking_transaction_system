import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '../../../generated/prisma/enums';
import { AuthenticationError, AuthorizationError } from '../../shared/errors/app-error';
import { PrismaAuthRepository } from './auth.repository';
import { verifyAccessToken } from './token.service';

const authRepository = new PrismaAuthRepository();

export const authenticate: RequestHandler = async (request, _response, next) => {
  const authorization = request.header('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    throw new AuthenticationError();
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthenticationError();
  }

  const tokenUser = await verifyAccessToken(token);
  const currentAuthorization = await authRepository.findActiveAuthorization(tokenUser.userId);
  if (!currentAuthorization) {
    throw new AuthenticationError('User is inactive or no longer exists');
  }

  request.auth = {
    userId: tokenUser.userId,
    role: currentAuthorization.role,
  };
  next();
};

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.auth) {
      throw new AuthenticationError();
    }

    if (!allowedRoles.includes(request.auth.role)) {
      throw new AuthorizationError();
    }

    next();
  };
}
