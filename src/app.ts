import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './infrastructure/logging/logger';
import { router } from './routes/v1.routes';
import { AppError } from './shared/errors/app-error';
import { errorHandler } from './shared/middleware/error-handler';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(helmet());
app.use(
  cors({
    origin: 'https://hoppscotch.io',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  }),
);
app.use(
  pinoHttp({
    logger,
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    genReqId(request, response) {
      const incomingRequestId = request.headers['x-request-id'];
      const requestId =
        typeof incomingRequestId === 'string' && incomingRequestId.length <= 128
          ? incomingRequestId
          : randomUUID();
      response.setHeader('x-request-id', requestId);
      return requestId;
    },
  }),
);
app.use(express.json({ limit: '32kb' }));

app.use('/api/v1', router);

app.use((_request, _response, next) => {
  next(
    new AppError(
      404,
      'ROUTE_NOT_FOUND',
      'The requested API endpoint was not found',
    ),
  );
});

app.use(errorHandler);

export default app;
