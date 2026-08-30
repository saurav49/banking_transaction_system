import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/logging/logger';
import { AppError } from '../errors/app-error';

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON',
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten(),
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId: request.id,
      },
    });
    return;
  }

  logger.error({ err: error, requestId: request.id }, 'Unhandled request error');
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: request.id,
    },
  });
};
