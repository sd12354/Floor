/**
 * `db push` / `db reset` without the native Prisma schema engine (which needs a binary download
 * from binaries.prisma.sh). Uses the wasm schema engine through the better-sqlite3 driver adapter.
 *
 *   tsx scripts/db.ts push   [--url file:./dev.db]
 *   tsx scripts/db.ts reset  [--url file:./dev.db]
 */
import { pushSchema, resetDatabase, resolveDatabaseUrl } from '../src/db/push.js';

const cmd = process.argv[2] ?? 'push';
const urlFlag = process.argv.indexOf('--url');
const url = resolveDatabaseUrl(urlFlag > -1 ? process.argv[urlFlag + 1] : undefined);

if (cmd === 'reset') {
  await resetDatabase(url);
  console.log(`Reset database ${url}`);
}
const out = await pushSchema(url);
console.log(`Schema pushed to ${url} (${out.executedSteps} step(s))`);
if (out.warnings.length) console.warn('Warnings:', out.warnings);
if (out.unexecutable.length) {
  console.error('Unexecutable:', out.unexecutable);
  process.exit(1);
}
