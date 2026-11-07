import { createHmac } from 'node:crypto';

/**
 * Signing for the Alibaba/AliExpress "TOP"/IOP gateway.
 *
 * VERIFIED against the ae_sdk (npm) and iop-sdk source and the AliExpress Open Platform help pages:
 *  - HMAC-SHA256 keyed with the app secret, result as UPPERCASE hex (sign_method=sha256).
 *  - The signed base string is every request param (system + business) EXCEPT `sign`, sorted by key,
 *    concatenated as key+value with no separators (no secret wrapping; that wrapping is the legacy MD5 form).
 *  - Pairs with an empty key or empty value are skipped.
 *  - System params: method, app_key, timestamp, format=json, v=2.0, sign_method=sha256, session (the access token).
 *
 * The legacy MD5 variant (`sign_method=md5`) instead prepends and appends the secret around the base string and
 * MD5s it; Floor uses SHA-256 because the platform recommends it and MD5 is deprecated. See `signTopRequest`.
 */
export const ALIEXPRESS_SIGN_METHOD = 'sha256' as const;

/** Build the base string: params minus `sign`, sorted by key, key+value concatenated, empties skipped. */
export function topBaseString(params: Readonly<Record<string, string>>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== '' && (params[k] ?? '') !== '')
    .sort();
  let base = '';
  for (const k of keys) base += k + (params[k] ?? '');
  return base;
}

/** HMAC-SHA256(base, secret) as uppercase hex. The value sent in the `sign` param. */
export function signTopRequest(params: Readonly<Record<string, string>>, appSecret: string): string {
  const base = topBaseString(params);
  return createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}
