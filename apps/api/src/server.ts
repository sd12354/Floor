import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { buildConnectors, type Connectors } from './connectors.js';
import { createDb, prepareDb, type Db } from './db/client.js';
import { accountPlugin } from './plugins/account.js';
import { authGuard } from './plugins/auth.js';
import { errorPlugin } from './plugins/errors.js';
import { prismaPlugin } from './plugins/prisma.js';
import { securityPlugin } from './plugins/security.js';
import { webPlugin } from './plugins/web.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { discoveryRoutes } from './routes/discovery.js';
import { ebayCallbackRoutes } from './routes/ebayCallback.js';
import { ebaySetupRoutes } from './routes/ebaySetup.js';
import { ebayDeletionRoutes } from './routes/ebayDeletion.js';
import { ledgerRoutes } from './routes/ledger.js';
import { listingRoutes } from './routes/listings.js';
import { messageRoutes } from './routes/messages.js';
import { orderRoutes } from './routes/orders.js';
import { manualOrderRoutes } from './routes/manualOrders.js';
import { manualProductRoutes } from './routes/manualProducts.js';
import { supplierRoutes } from './routes/suppliers.js';
import { webhookRoutes } from './routes/webhooks.js';
import { buildJobs, startScheduler, type Jobs } from './services/scheduler.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    connectors: Connectors;
    jobs: Jobs;
  }
}

export interface BuildOptions {
  config?: Partial<AppConfig>;
  db?: Db;
  connectors?: Connectors;
}

/** Build the Fastify app without listening. Tests call this with a temp DATABASE_URL. */
export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(opts.config);
  const db = opts.db ?? createDb(config.databaseUrl);
  await prepareDb(db);
  const connectors = opts.connectors ?? buildConnectors(config, db);
  connectors.bindDb(db);

  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-floor-webhook-secret"]'],
            ...(config.nodeEnv === 'production'
              ? {}
              : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
          },
  });

  app.decorate('config', config);
  app.decorate('connectors', connectors);
  connectors.bindLogger((message, meta) => app.log.warn(meta ?? {}, message));
  app.decorate('jobs', buildJobs(db, connectors, config, app.log));

  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(securityPlugin);
  await app.register(errorPlugin);
  await app.register(prismaPlugin, { db });
  await app.register(accountPlugin);

  app.get('/health', async (_req, reply) => {
    try {
      await app.db.$queryRawUnsafe('SELECT 1');
      return { ok: true, mode: config.mode, db: 'up' };
    } catch (err) {
      app.log.error({ err }, 'health check failed');
      return reply.code(503).send({ ok: false, mode: config.mode, db: 'down' });
    }
  });

  await app.register(
    async (api) => {
      // Everything under /api/v1 needs a session token except the routes marked `public` in routes/auth.ts.
      await api.register(authGuard);
      await api.register(authRoutes);
      await api.register(accountRoutes);
      await api.register(ebayCallbackRoutes);
      await api.register(ebaySetupRoutes);
      await api.register(supplierRoutes);
      await api.register(discoveryRoutes);
      await api.register(listingRoutes);
      await api.register(orderRoutes);
      await api.register(manualOrderRoutes);
      await api.register(manualProductRoutes);
      await api.register(webhookRoutes);
      await api.register(ebayDeletionRoutes);
      await api.register(dashboardRoutes);
      await api.register(ledgerRoutes);
      await api.register(messageRoutes);
    },
    { prefix: '/api/v1' },
  );

  // After the API routes, so a dashboard file can never shadow /api or /health.
  await app.register(webPlugin);

  const scheduler = startScheduler(app.jobs, config, app.log);
  app.addHook('onClose', async () => scheduler.stop());

  return app;
}
