import { describe, expect, it } from 'vitest';
import { ALIEXPRESS_SIGN_METHOD, signTopRequest, topBaseString } from '../src/index.js';

describe('AliExpress TOP signing', () => {
  it('uses sha256', () => {
    expect(ALIEXPRESS_SIGN_METHOD).toBe('sha256');
  });

  it('builds the base string: params minus sign, sorted by key, key+value concatenated, empties skipped', () => {
    expect(topBaseString({ b: '2', a: '1', c: '' })).toBe('a1b2');
    expect(topBaseString({ a: '1', sign: 'XXX', '': 'ignored' })).toBe('a1');
  });

  it('known vector: a simple pair', () => {
    expect(signTopRequest({ b: '2', a: '1', c: '' }, 'k')).toBe('612AA7A58C61F4149BE543976824709C309687349368AD1F734BCACDD020B43C');
  });

  it('known vector: a full system+business param set (uppercase hex HMAC-SHA256)', () => {
    const params = {
      method: 'aliexpress.ds.product.get',
      app_key: '12345',
      timestamp: '1700000000000',
      format: 'json',
      v: '2.0',
      sign_method: 'sha256',
      session: 'tok',
      product_id: '4000999',
    };
    expect(topBaseString(params)).toBe(
      'app_key12345formatjsonmethodaliexpress.ds.product.getproduct_id4000999sessiontoksign_methodsha256timestamp1700000000000v2.0',
    );
    expect(signTopRequest(params, 'secret123')).toBe('3D4C2EFE0A9FC15BCBDAC689D356D00B470DB6EA33F5EE45192D1EB98C24F18B');
    // The signature is exactly 64 uppercase hex chars.
    expect(signTopRequest(params, 'secret123')).toMatch(/^[0-9A-F]{64}$/);
  });

  it('a different secret produces a different signature', () => {
    const p = { a: '1', b: '2' };
    expect(signTopRequest(p, 'k1')).not.toBe(signTopRequest(p, 'k2'));
  });
});
