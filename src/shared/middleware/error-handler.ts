import { Prisma } from '../../../generated/prisma/client';
import type { ErrorRequestHandler, Request } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/logging/logger';
import { AppError, ServiceUnavailableError } from '../errors/app-error';

type ErrorWithHttpStatus = Error & {
  status?: number;
  type?: string;
};

function requestDetails(request: Request, statusCode: number, code: string) {
  return {
    requestId: request.id,
    method: request.method,
    path: request.originalUrl,
    statusCode,
    errorCode: code,
  };
}

function safeUniqueFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] | undefined {
  const target = error.meta?.target;
  if (!Array.isArray(target)) return undefined;

  const fields = target.filter(
    (field): field is string =>
      typeof field === 'string' && field.length <= 100,
  );
  return fields.length > 0 ? fields : undefined;
}

function mapPrismaError(error: unknown): AppError | undefined {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new ServiceUnavailableError(
      'The database is temporarily unavailable',
      'DATABASE_UNAVAILABLE',
    );
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  switch (error.code) {
    case 'P1000':
    case 'P1001':
    case 'P1002':
    case 'P1008':
    case 'P1017':
      return new ServiceUnavailableError(
        'The database is temporarily unavailable',
        'DATABASE_UNAVAILABLE',
      );
    case 'P2000':
      return new AppError(
        400,
        'VALUE_TOO_LONG',
        'A supplied value is too long for the target field',
      );
    case 'P2002': {
      const fields = safeUniqueFields(error);
      return new AppError(
        409,
        'UNIQUE_CONSTRAINT_VIOLATION',
        fields
          ? `A record with the same ${fields.join(', ')} already exists`
          : 'A record with the same unique value already exists',
        fields ? { fields } : undefined,
      );
    }
    case 'P2003':
    case 'P2014':
      return new AppError(
        409,
        'RELATION_CONSTRAINT_VIOLATION',
        'The operation conflicts with a related resource',
      );
    case 'P2025':
      return new AppError(
        404,
        'RESOURCE_NOT_FOUND',
        'The requested resource was not found',
      );
    case 'P2024':
      return new ServiceUnavailableError(
        'The database timed out while processing the request',
        'DATABASE_TIMEOUT',
      );
    case 'P2034':
      return new AppError(
        409,
        'CONCURRENT_WRITE_CONFLICT',
        'The resource was changed concurrently; retry the request',
      );
    default:
      return new AppError(500, 'DATABASE_ERROR', 'A database operation failed');
  }
}

function prismaLogDetails(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const modelName = error.meta?.modelName;
    return {
      prismaCode: error.code,
      ...(typeof modelName === 'string' ? { prismaModel: modelName } : {}),
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      prismaCode: error.errorCode ?? 'INITIALIZATION_ERROR',
      prismaClientVersion: error.clientVersion,
    };
  }

  return {};
}

function logHandledError(
  request: Request,
  sourceError: unknown,
  responseError: AppError,
): void {
  const requestLogger = request.log ?? logger;
  const context = requestDetails(
    request,
    responseError.statusCode,
    responseError.code,
  );

  if (responseError.statusCode >= 500) {
    requestLogger.error(
      { ...context, ...prismaLogDetails(sourceError), err: sourceError },
      'Request failed',
    );
    return;
  }

  requestLogger.warn(context, 'Request rejected');
}

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const httpError = error as ErrorWithHttpStatus;

  if (httpError.type === 'entity.too.large' || httpError.status === 413) {
    const responseError = new AppError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request body exceeds the 32 KB limit',
    );
    logHandledError(request, error, responseError);
    response.status(responseError.statusCode).json({
      error: {
        code: responseError.code,
        message: responseError.message,
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof SyntaxError && httpError.status === 400) {
    const responseError = new AppError(
      400,
      'INVALID_JSON',
      'Request body contains invalid JSON',
    );
    logHandledError(request, error, responseError);
    response.status(responseError.statusCode).json({
      error: {
        code: responseError.code,
        message: responseError.message,
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    const details = {
      issues: error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'request',
        code: issue.code,
        message: issue.message,
      })),
    };
    const responseError = new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      details,
    );
    logHandledError(request, error, responseError);
    response.status(responseError.statusCode).json({
      error: {
        code: responseError.code,
        message: responseError.message,
        details,
        requestId: request.id,
      },
    });
    return;
  }

  const responseError =
    error instanceof AppError
      ? error
      : mapPrismaError(error) ??
        new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');

  logHandledError(request, error, responseError);
  response.status(responseError.statusCode).json({
    error: {
      code: responseError.code,
      message: responseError.message,
      ...(responseError.details === undefined
        ? {}
        : { details: responseError.details }),
      requestId: request.id,
    },
  });
};
