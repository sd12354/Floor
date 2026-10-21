// Runs `prisma generate` with PRISMA_SCHEMA_ENGINE_BINARY pointed at a local no-op file so the
// CLI skips the native engine download. Prisma 7's client itself is engine-free (wasm + driver adapter).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const noop = path.join(here, 'noop-schema-engine.cjs');
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');

const res = spawnSync(bin, ['generate'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PRISMA_SCHEMA_ENGINE_BINARY: noop, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
});
process.exit(res.status ?? 1);
