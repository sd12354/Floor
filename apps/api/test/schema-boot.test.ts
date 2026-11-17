import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, prepareDb } from '../src/db/client.js';
import { pushSchema } from '../src/db/push.js';

describe('schema boot', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-schema-'));
  const url = `file:${path.join(dir, 'floor.db')}`;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('creates tables on an empty file and is a no-op the second time', async () => {
    const first = await pushSchema(url, false);
    expect(first.unexecutable).toEqual([]);
    expect(first.executedSteps).toBeGreaterThan(0);

    const second = await pushSchema(url, false);
    expect(second.unexecutable).toEqual([]);
    expect(second.executedSteps).toBe(0);

    const db = createDb(url);
    await prepareDb(db);
    expect(await db.account.count()).toBe(0);
    await db.$disconnect();
  });
});
