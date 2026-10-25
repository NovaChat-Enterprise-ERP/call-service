import express, { type Express } from 'express';
import { errorHandler, healthRouter, httpLogger, internalAuth, notFoundHandler, requestId } from '@novachat-enterprise-erp/common';
import type { Container } from './container.js';
import { publicRoutes } from './routes/index.js';

export const createApp = (container: Container): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId());
  app.use(httpLogger(container.logger));
  app.use(healthRouter('call-service', container.readiness));
  app.post('/webhooks/livekit', express.raw({ type: '*/*', limit: '256kb' }), container.controllers.meetings.webhook);
  app.use(express.json({ limit: '100kb' }));
  app.use(internalAuth(container.internalSecret));
  app.use('/api/v1', publicRoutes(container));
  app.use(notFoundHandler);
  app.use(errorHandler(container.logger));
  return app;
};
