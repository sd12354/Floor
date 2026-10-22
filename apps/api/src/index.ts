import { buildServer } from './server.js';
import { ensureSeeded } from './seed.js';

// Load apps/api/.env if present (real-mode credentials live there). Real environment variables win.
try {
  process.loadEnvFile();
} catch {
  // no .env file: fine, mock mode needs none
}

const app = await buildServer();

// Both modes need the account row (mock also gets the demo supplier and catalog; real mode just the empty account).
const seeded = await ensureSeeded(app.db, app.connectors);
if (seeded) app.log.info(`created account acc_demo (${app.config.mode} mode)`);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: app.config.port, host: process.env.HOST ?? '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
