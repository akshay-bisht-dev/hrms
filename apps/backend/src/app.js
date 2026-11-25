// @ts-check
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins } from './config/env.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';
import { buildOpenApiDocument } from './openapi/registry.js';
import { apiRouter } from './routes/index.js';

/**
 * Builds the Express application without starting a server (used by server.js and tests).
 * @param {object} deps
 * @param {Readonly<import('./config/env.js').Env>} deps.env
 * @param {import('pino').Logger} deps.logger
 * @param {import('./modules/health/health.routes.js').ReadinessCheck[]} deps.readinessChecks
 * @param {Parameters<typeof apiRouter>[0]} [deps.services] module services (auth, …); omitted in shell-only tests
 * @returns {import('express').Express}
 */
export function createApp({ env, logger, readinessChecks, services }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind one ALB / Nginx hop
  app.set('query parser', 'simple');

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => /** @type {any} */ (req).id,
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );

  // Routers register their OpenAPI paths when they are built, so build them before the document.
  const api = apiRouter(services);
  const docsEnabled = env.ENABLE_API_DOCS ?? env.NODE_ENV !== 'production';
  if (docsEnabled) {
    const document = buildOpenApiDocument();
    app.get('/api/docs/openapi.json', (_req, res) => res.json(document));
    // Swagger UI needs inline script/style; this relaxed CSP applies to the docs path only.
    app.use(
      '/api/docs',
      helmet({
        contentSecurityPolicy: {
          directives: {
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
          },
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(document, { customSiteTitle: 'Workforce HRMS API' }),
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: corsOrigins(env),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'If-Match',
        'X-CSRF-Token',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id', 'ETag', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    '/health',
    healthRouter({
      checks: readinessChecks,
      onFailure: (name, err) => logger.warn({ err, check: name }, 'Readiness check failed'),
    }),
  );
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
