// The session token lives in localStorage so a reload keeps you signed in. Storage can throw
// (private windows, blocked site data), so every access is wrapped and the token also lives in memory.
const KEY = 'floor.token';
let memory: string | null = null;
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export const getToken = (): string | null => read();

export function setToken(token: string | null): void {
  memory = token;
  try {
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Keep the in-memory copy only.
  }
  listeners.forEach((l) => l());
}

export const clearToken = (): void => setToken(null);

/** For useSyncExternalStore: re-render when the token is set or cleared. */
export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
