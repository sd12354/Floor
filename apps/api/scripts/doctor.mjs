// Quick environment check: can the native SQLite driver load and run on this machine?
// Exits 1 with the real error when it cannot (the Prisma adapter otherwise hides it as "External error id#0").
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const row = db.prepare('select sqlite_version() as v').get();
  db.close();
  console.log(`doctor: node ${process.version} ${process.platform}/${process.arch}, better-sqlite3 OK (sqlite ${row.v})`);
} catch (err) {
  console.error('doctor: better-sqlite3 FAILED to load or run:');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
