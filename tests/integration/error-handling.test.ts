import { describe, expect, test } from 'bun:test';
import { Prisma } from '../../generated/prisma/client';
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import request from 'supertest';
import app from '../../src/app';
import { errorHandler } from '../../src/shared/middleware/error-handler';

describe('API error handling', () => {
  test('returns useful field-level validation errors with a request ID', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBeString();
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'password' }),
      ]),
    );
  });

  test('distinguishes malformed JSON from schema validation failures', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'INVALID_JSON',
      message: 'Request body contains invalid JSON',
    });
    expect(response.body.error.requestId).toBeString();
  });

  test('returns a specific code for an invalid access token', async () => {
    const response = await request(app)
      .post('/api/v1/users/00000000-0000-4000-8000-000000000000/accounts')
      .set('authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    expect(response.body.error.requestId).toBeString();
  });

  test('returns a request ID for unknown endpoints', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.error.requestId).toBeString();
  });

  test('maps a Prisma unique violation to a safe conflict response', async () => {
    const prismaErrorApp = express();
    prismaErrorApp.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    prismaErrorApp.get('/failure', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['email'], modelName: 'User' },
      });
    });
    prismaErrorApp.use(errorHandler);

    const response = await request(prismaErrorApp).get('/failure');

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'UNIQUE_CONSTRAINT_VIOLATION',
      details: { fields: ['email'] },
    });
  });
});
