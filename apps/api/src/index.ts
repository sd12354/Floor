import { productionProblems } from './production.js';
import { buildServer } from './server.js';
import { ensureSeeded } from './seed.js';

// Load apps/api/.env if present (real-mode credentials live there). Real environment variables win.
try {
  process.loadEnvFile();
} catch {
  // no .env file: fine, mock mode needs none
}

const app = await buildServer();

const problems = productionProblems(app.config);
if (problems.length > 0) {
  for (const problem of problems) app.log.error(problem);
  await app.close();
  process.exit(1);
}

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  app.log.info({ signal }, 'shutting down');
  await app.close();
  clearTimeout(timer);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});

try {
  // Create or update tables before the first query. force is off so a destructive change stops the boot
  // instead of deleting orders. A fresh volume has no tables and applies cleanly.
  const { pushSchema } = await import('./db/push.js');
  const pushed = await pushSchema(app.config.databaseUrl, false);
  for (const warning of pushed.warnings) app.log.warn(warning);
  if (pushed.unexecutable.length > 0) {
    for (const step of pushed.unexecutable) app.log.error({ step }, 'schema change would drop data');
    throw new Error('Database schema was not applied. Review the steps above before starting again.');
  }
  if (pushed.executedSteps > 0) app.log.info({ steps: pushed.executedSteps }, 'applied database schema');

  // Both modes need the account row (mock also gets the demo supplier and catalog; real mode just the empty account).
  const seeded = await ensureSeeded(app.db, app.connectors);
  if (seeded) app.log.info(`created account acc_demo (${app.config.mode} mode)`);

  await app.listen({ port: app.config.port, host: app.config.host });
  app.log.info({ host: app.config.host, port: app.config.port, mode: app.config.mode }, 'listening');
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await app.close();
  process.exit(1);
}
