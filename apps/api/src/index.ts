import { buildServer } from './server.js';
import { ensureSeeded } from './seed.js';

const app = await buildServer();

// Mock mode seeds acc_demo on first run so the product is usable with zero setup.
if (app.config.mode === 'mock') {
  const seeded = await ensureSeeded(app.db, app.connectors);
  if (seeded) app.log.info('seeded demo account acc_demo');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: app.config.port, host: process.env.HOST ?? '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
