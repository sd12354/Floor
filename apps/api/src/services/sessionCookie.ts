import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config.js';
import { SESSION_TTL_MS } from './auth.js';

export const SESSION_COOKIE = 'floor_session';

/** Read one cookie. The session value is base64url, so a decode failure is treated as absent. */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * HttpOnly session cookie. SameSite=Lax so a foreign site cannot ride it on a POST.
 * Secure only when the dashboard itself is https, so a local http deploy can still sign in.
 */
export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string | null): void {
  const secure = config.webOrigin.startsWith('https://');
  const value = token ? encodeURIComponent(token) : '';
  const maxAge = token ? Math.floor(SESSION_TTL_MS / 1000) : 0;
  const parts = [`${SESSION_COOKIE}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}
