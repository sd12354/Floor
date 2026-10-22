import { NotConfiguredError } from '../types.js';
import { DEFAULT_SCOPES, EbayApiError, EbayReauthRequiredError, type EbayEnv, type EbayTokens, type FetchLike, type RealEbayConfig } from './ebayTypes.js';

/** Refresh this long before the access token actually expires. */
const SKEW_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/** OAuth for the eBay user token: code exchange, refresh, and "which token do I send right now". */
export class EbayAuth {
  private inflight: Promise<string> | null = null;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: RealEbayConfig, private readonly env: EbayEnv) {
    this.fetchImpl = config.fetch ?? ((url, init) => fetch(url, init));
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  private get tokenUrl(): string {
    return `${this.env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'}/identity/v1/oauth2/token`;
  }

  authorizeUrl(state?: string, scopes: readonly string[] = DEFAULT_SCOPES): string {
    const { clientId, ruName } = this.config;
    if (!clientId || !ruName) throw new NotConfiguredError('RealEbay', ['EBAY_CLIENT_ID', 'EBAY_RU_NAME']);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: ruName, response_type: 'code', scope: scopes.join(' ') });
    if (state) params.set('state', state);
    const host = this.env === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
    return `${host}/oauth2/authorize?${params.toString()}`;
  }

  private basicAuth(): string {
    const { clientId, clientSecret } = this.config;
    if (!clientId || !clientSecret) throw new NotConfiguredError('RealEbay', ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET']);
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: this.basicAuth() },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    let json: TokenResponse = {};
    try {
      json = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      // fall through to the status check
    }
    if (res.status < 200 || res.status >= 300 || !json.access_token) {
      const why = json.error_description ?? json.error ?? `HTTP ${res.status}`;
      if (form.grant_type === 'refresh_token' && (res.status === 400 || res.status === 401)) {
        throw new EbayReauthRequiredError(`eBay refused the refresh token (${why}); reconnect eBay`);
      }
      throw new EbayApiError(res.status, `eBay token endpoint: ${why}`);
    }
    return json;
  }

  /** authorization_code grant. `redirect_uri` is the RuName, not a URL. Persists the tokens in the TokenStore if one is set. */
  async exchangeCode(code: string): Promise<EbayTokens> {
    if (!this.config.ruName) throw new NotConfiguredError('RealEbay', ['EBAY_RU_NAME']);
    const json = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.config.ruName });
    if (!json.refresh_token) throw new EbayApiError(502, 'eBay token endpoint returned no refresh_token');
    const t = this.now().getTime();
    const tokens: EbayTokens = {
      accessToken: json.access_token as string,
      refreshToken: json.refresh_token,
      expiresAt: new Date(t + (json.expires_in ?? 7200) * 1000),
      refreshExpiresAt: new Date(t + (json.refresh_token_expires_in ?? 47_304_000) * 1000),
    };
    await this.config.tokenStore?.set(tokens);
    return tokens;
  }

  /** A valid access token: stored one if fresh, refreshed if not, else the static EBAY_USER_TOKEN. */
  async accessToken(): Promise<string> {
    const stored = await this.config.tokenStore?.get();
    if (stored) {
      if (stored.expiresAt.getTime() - SKEW_MS > this.now().getTime()) return stored.accessToken;
      return this.refresh(stored);
    }
    if (this.config.userToken) return this.config.userToken;
    throw new NotConfiguredError('RealEbay', ['EBAY_USER_TOKEN, or connect eBay (POST /account/ebay/connect)']);
  }

  /** Called after a 401: force a refresh. A static token cannot be refreshed. */
  async refreshAfter401(): Promise<string> {
    const stored = await this.config.tokenStore?.get();
    if (!stored) throw new EbayReauthRequiredError('eBay rejected the static EBAY_USER_TOKEN (expired?); connect eBay or supply a fresh token');
    return this.refresh(stored);
  }

  /** Concurrent callers share one refresh request. */
  private refresh(stored: EbayTokens): Promise<string> {
    this.inflight ??= this.doRefresh(stored).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(stored: EbayTokens): Promise<string> {
    if (stored.refreshExpiresAt.getTime() <= this.now().getTime()) {
      throw new EbayReauthRequiredError('eBay refresh token has expired; reconnect eBay');
    }
    // scope omitted: eBay then reuses the originally consented scopes.
    const json = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refreshToken });
    const t = this.now().getTime();
    // The refresh response carries no new refresh_token (eBay docs); keep the old one unless one is returned.
    const next: EbayTokens = {
      accessToken: json.access_token as string,
      refreshToken: json.refresh_token ?? stored.refreshToken,
      expiresAt: new Date(t + (json.expires_in ?? 7200) * 1000),
      refreshExpiresAt: json.refresh_token ? new Date(t + (json.refresh_token_expires_in ?? 47_304_000) * 1000) : stored.refreshExpiresAt,
    };
    await this.config.tokenStore?.set(next);
    return next.accessToken;
  }
}
