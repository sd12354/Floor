import { ALIEXPRESS_SIGN_METHOD, signTopRequest } from './aliexpressSign.js';
import {
  ALIEXPRESS_API_VERSION,
  ALIEXPRESS_AUTH_ERROR_CODES,
  ALIEXPRESS_GATEWAY,
  AliExpressApiError,
  AliExpressReauthRequiredError,
  type RealAliExpressConfig,
} from './aliexpressTypes.js';
import type { FetchLike } from './ebayTypes.js';

/** AliExpress gateway timestamp = milliseconds since epoch, as a string. VERIFIED (ae_sdk uses Date.now()). */
function timestampMs(now: Date): string {
  return String(now.getTime());
}

interface AeErrorEnvelope {
  code?: string | number;
  msg?: string;
  sub_code?: string;
  sub_msg?: string;
  request_id?: string;
  error_response?: { code?: string | number; msg?: string; sub_code?: string; sub_msg?: string; request_id?: string };
}

/**
 * Signed JSON client for the AliExpress TOP/IOP "sync" gateway.
 *
 * Every call: system params + the method's business params are signed (HMAC-SHA256, see aliexpressSign.ts) and the
 * whole lot is POSTed form-urlencoded to the one gateway URL. The HTTP status is usually 200 even for business
 * errors, which arrive as a `{ code, msg, sub_code, sub_msg }` envelope (or nested under `error_response`), so the
 * body is always inspected. An auth error code becomes AliExpressReauthRequiredError; any other error becomes
 * AliExpressApiError. Nothing here logs the secret or the token.
 */
export class AliExpressHttp {
  private readonly gateway: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: Required<Pick<RealAliExpressConfig, 'appKey' | 'appSecret' | 'accessToken'>> & RealAliExpressConfig) {
    this.gateway = config.gateway ?? ALIEXPRESS_GATEWAY;
    this.fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  /**
   * Call one TOP method. `params` are the business params (string values only; callers JSON-stringify objects).
   * Empty-string values are dropped before signing and sending, matching the gateway's own base-string rule.
   */
  async call<T = unknown>(method: string, params: Readonly<Record<string, string>>): Promise<T> {
    const all: Record<string, string> = {
      method,
      app_key: this.config.appKey,
      session: this.config.accessToken,
      timestamp: timestampMs(this.now()),
      format: 'json',
      v: ALIEXPRESS_API_VERSION,
      sign_method: ALIEXPRESS_SIGN_METHOD,
    };
    for (const [k, v] of Object.entries(params)) if (v !== '') all[k] = v;
    all.sign = signTopRequest(all, this.config.appSecret);

    const body = new URLSearchParams(all).toString();
    const res = await this.fetchImpl(this.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AliExpressApiError(res.status, `AliExpress ${method} failed: HTTP ${res.status}`);
    }
    this.throwIfErrorEnvelope(method, json);
    return json as T;
  }

  /** AliExpress returns 200 with an error envelope for business failures; turn those into typed errors. */
  private throwIfErrorEnvelope(method: string, json: unknown): void {
    const env = (json ?? {}) as AeErrorEnvelope;
    const err = env.error_response ?? env;
    const code = err.code !== undefined ? String(err.code) : undefined;
    const subCode = err.sub_code;
    // A `0` / absent code is success. A non-zero top-level code or any sub_code is a failure.
    const hasError = (code !== undefined && code !== '0' && code !== '') || (subCode !== undefined && subCode !== '');
    if (!hasError) return;
    const detail = [err.msg, err.sub_msg].filter(Boolean).join(': ') || 'no error detail';
    const effective = subCode ?? code;
    if (effective && ALIEXPRESS_AUTH_ERROR_CODES.includes(effective)) {
      throw new AliExpressReauthRequiredError(`AliExpress rejected the access token (${effective}: ${detail}); reconnect AliExpress`);
    }
    throw new AliExpressApiError(200, `AliExpress ${method} error ${effective ?? ''}: ${detail}`, effective);
  }
}
