import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { buildConnectors, type Connectors } from './connectors.js';
import { createDb, type Db } from './db/client.js';
import { accountPlugin } from './plugins/account.js';
import { authGuard } from './plugins/auth.js';
import { errorPlugin } from './plugins/errors.js';
import { prismaPlugin } from './plugins/prisma.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { discoveryRoutes } from './routes/discovery.js';
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
  const connectors = opts.connectors ?? buildConnectors(config, db);
  connectors.bindDb(db);

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : config.nodeEnv === 'production'
          ? { level: process.env.LOG_LEVEL ?? 'info' }
          : { level: process.env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } },
  });

  app.decorate('config', config);
  app.decorate('connectors', connectors);
  app.decorate('jobs', buildJobs(db, connectors, config, app.log));

  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(errorPlugin);
  await app.register(prismaPlugin, { db });
  await app.register(accountPlugin);

  app.get('/health', async () => ({ ok: true, mode: config.mode }));

  await app.register(
    async (api) => {
      // Everything under /api/v1 needs a session token except the routes marked `public` in routes/auth.ts.
      await api.register(authGuard);
      await api.register(authRoutes);
      await api.register(accountRoutes);
      await api.register(supplierRoutes);
      await api.register(discoveryRoutes);
      await api.register(listingRoutes);
      await api.register(orderRoutes);
      await api.register(manualOrderRoutes);
      await api.register(manualProductRoutes);
      await api.register(webhookRoutes);
      await api.register(dashboardRoutes);
      await api.register(ledgerRoutes);
      await api.register(messageRoutes);
    },
    { prefix: '/api/v1' },
  );

  const scheduler = startScheduler(app.jobs, config, app.log);
  app.addHook('onClose', async () => scheduler.stop());

  return app;
}
