import { existsSync } from 'node:fs';
import { NotConfiguredError } from '@floor/core';
import type { AppConfig } from './config.js';
import { parseSecretKey } from './services/secretBox.js';

const HTTP_URL = /^https?:\/\/[^\s]+$/i;

/**
 * Reasons a production process must not listen. Development and tests are exempt:
 * a laptop can boot in mock mode with nothing configured.
 */
export function productionProblems(config: AppConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  if (config.nodeEnv !== 'production') return [];
  const problems: string[] = [];

  if (!env.DATABASE_URL?.trim()) {
    problems.push('DATABASE_URL is required in production. Use an absolute SQLite path on a persistent volume, for example file:/data/floor.db');
  }
  if (!env.WEB_ORIGIN?.trim()) {
    problems.push('WEB_ORIGIN is required in production (the public URL of this Floor, for example https://floor.example.com)');
  } else if (!HTTP_URL.test(config.webOrigin)) {
    problems.push('WEB_ORIGIN must be an http or https URL');
  } else if (config.webOrigin.startsWith('http://') && !config.allowInsecureHttp) {
    problems.push('WEB_ORIGIN is http. Use https, or set FLOOR_ALLOW_HTTP=1 for a private network');
  }

  if (config.webDist && !existsSync(config.webDist)) {
    problems.push(`WEB_DIST does not exist: ${config.webDist}`);
  }

  if (config.mode === 'real') {
    try {
      parseSecretKey(config.secretKey);
    } catch (err) {
      problems.push(err instanceof NotConfiguredError ? err.message : 'FLOOR_SECRET_KEY is invalid');
    }
    for (const [name, value] of [
      ['EBAY_CLIENT_ID', config.ebay.clientId],
      ['EBAY_CLIENT_SECRET', config.ebay.clientSecret],
      ['EBAY_RU_NAME', config.ebay.ruName],
    ] as const) {
      if (!value) problems.push(`${name} is required when FLOOR_MODE=real`);
    }
    if (config.ebay.env === 'production') {
      const token = config.ebayDeletionToken ?? '';
      if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) {
        problems.push('EBAY_DELETION_TOKEN must be 32–80 characters (letters, numbers, underscore, hyphen). eBay requires it for a production keyset');
      }
      if (!config.ebayDeletionEndpoint?.startsWith('https://')) {
        problems.push('EBAY_DELETION_ENDPOINT must be the public https URL registered in the eBay developer portal');
      }
    }
  }

  return problems;
}
