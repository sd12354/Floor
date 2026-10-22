const KEY = 'floor:intro-seen';

/** Whether this browser has already seen the welcome page. Storage can throw (private windows), so it fails open. */
export function introSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}

export function markIntroSeen(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}
