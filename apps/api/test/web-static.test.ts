import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSpaRoute, safePublicFile } from '../src/plugins/web.js';
import { createTestApp, type TestApp } from './helpers.js';

describe('spa path rules', () => {
  it('serves client routes and refuses traversal and asset misses', () => {
    expect(isSpaRoute('GET', '/login')).toBe(true);
    expect(isSpaRoute('GET', '/orders/ord_1')).toBe(true);
    expect(isSpaRoute('GET', '/assets/index-abc.js')).toBe(false);
    expect(isSpaRoute('POST', '/login')).toBe(false);
    expect(isSpaRoute('GET', '/api/v1/account')).toBe(false);
    const root = '/var/floor/web';
    expect(safePublicFile(root, '/assets/app.js')).toBe(path.resolve(root, 'assets/app.js'));
    expect(safePublicFile(root, '/../../etc/passwd')).toBeNull();
    expect(safePublicFile(root, '/%2e%2e/secret')).toBeNull();
  });
});

describe('dashboard hosting', () => {
  let t: TestApp;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'floor-web-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Floor</title><div id="root"></div>');
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("floor")');
    t = await createTestApp({ webDist: dir });
  });

  afterAll(async () => {
    await t.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the dashboard, client routes, and hashed assets', async () => {
    const home = await t.app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.headers['cache-control']).toBe('no-cache');
    expect(home.body).toContain('id="root"');

    const login = await t.app.inject({ method: 'GET', url: '/login' });
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('id="root"');

    const asset = await t.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect(asset.body).toContain('floor');
  });

  it('keeps API and health responses, and 404s a missing asset', async () => {
    const health = await t.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });

    const status = await t.app.inject({ method: 'GET', url: '/api/v1/auth/status' });
    expect(status.statusCode).toBe(200);

    const missing = await t.app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
