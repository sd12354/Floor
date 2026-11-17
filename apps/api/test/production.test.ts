import { describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../src/config.js';
import { productionProblems } from '../src/production.js';

const env = { DATABASE_URL: 'file:/data/floor.db', WEB_ORIGIN: 'https://floor.example.com' };

function prod(overrides: Partial<AppConfig> = {}): AppConfig {
  return loadConfig({
    nodeEnv: 'production',
    mode: 'mock',
    webOrigin: 'https://floor.example.com',
    allowInsecureHttp: false,
    databaseUrl: 'file:/data/floor.db',
    ...overrides,
  });
}

describe('production boot checks', () => {
  it('allows development to boot with nothing configured', () => {
    expect(productionProblems(loadConfig({ nodeEnv: 'development' }), {})).toEqual([]);
  });

  it('allows a mock production process with an explicit database and https origin', () => {
    expect(productionProblems(prod(), env)).toEqual([]);
  });

  it('refuses the implicit dev database and a missing origin', () => {
    const problems = productionProblems(prod(), {});
    expect(problems.some((p) => p.includes('DATABASE_URL'))).toBe(true);
    expect(problems.some((p) => p.includes('WEB_ORIGIN'))).toBe(true);
  });

  it('refuses plain http unless FLOOR_ALLOW_HTTP is set', () => {
    const http = prod({ webOrigin: 'http://10.0.0.5:4000' });
    expect(productionProblems(http, { ...env, WEB_ORIGIN: 'http://10.0.0.5:4000' }).some((p) => p.includes('FLOOR_ALLOW_HTTP'))).toBe(true);
    expect(productionProblems({ ...http, allowInsecureHttp: true }, { ...env, WEB_ORIGIN: 'http://10.0.0.5:4000' })).toEqual([]);
  });

  it('requires the eBay production keyset pieces in real mode', () => {
    const config = prod({
      mode: 'real',
      secretKey: undefined,
      ebay: { env: 'production' },
    });
    const problems = productionProblems(config, env);
    expect(problems.some((p) => p.includes('FLOOR_SECRET_KEY'))).toBe(true);
    expect(problems.some((p) => p.includes('EBAY_CLIENT_ID'))).toBe(true);
    expect(problems.some((p) => p.includes('EBAY_DELETION_TOKEN'))).toBe(true);
    expect(problems.some((p) => p.includes('EBAY_DELETION_ENDPOINT'))).toBe(true);
  });

  it('accepts a complete real production configuration', () => {
    const config = prod({
      mode: 'real',
      secretKey: 'a'.repeat(64),
      ebay: {
        env: 'production',
        clientId: 'app',
        clientSecret: 'cert',
        ruName: 'floor-runame',
      },
      ebayDeletionToken: 'a'.repeat(32),
      ebayDeletionEndpoint: 'https://floor.example.com/api/v1/webhooks/ebay/account-deletion',
    });
    expect(productionProblems(config, env)).toEqual([]);
  });
});
