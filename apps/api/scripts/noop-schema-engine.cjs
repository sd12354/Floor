#!/usr/bin/env node
// Placeholder "schema engine" so `prisma generate` does not try to download the native
// binary from binaries.prisma.sh (not reachable in every environment). `prisma generate`
// never executes the schema engine; migrations/pushes go through scripts/db.ts (wasm engine).
process.stdout.write('schema-engine-cli noop\n');
