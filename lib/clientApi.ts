// How the website's pages talk to the API: fetch, with the login token added.
// Used only in the browser.

export interface ApiResult<T = unknown> {
  status: number; // 0 when the server could not be reached at all
  body: T | null;
}

const TOKEN_KEY = 'kazi-token';
const APPLICATIONS_KEY = 'kazi-applications';

// Where the token from a password-reset email waits (this tab only) until the new-password page uses it.
export const RESET_TOKEN_KEY = 'kazi-reset-token';

// The login token is kept in this browser until logout. Every use is wrapped, since storage can be
// switched off (private windows) and the page must still work.
export const session = {
  get token(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string): void {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage is off: the login lasts until the page closes */ }
  },
  clear(): void {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(APPLICATIONS_KEY); } catch { /* nothing to clear */ }
  },
};

// The page that provides the login registers here, so a 401 anywhere can send the person back to log in.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void { onSessionExpired = handler; }

// The free host sleeps when quiet, so the first request can take up to a minute. After 4 seconds of
// waiting the header shows a notice; these two events tell it when to appear and when to go.
export const WAKING_EVENT = 'kazi:waking';
let waiting = 0;
function setWaking(on: boolean): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WAKING_EVENT, { detail: on }));
}

// The website's own API key, if the server was started with one (see app/layout.tsx).
export function websiteApiKey(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="kazi-api-key"]')?.getAttribute('content') || null;
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const slow = setTimeout(() => { waiting++; setWaking(true); }, 4000);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const key = websiteApiKey();
  if (key) headers['X-API-Key'] = key;
  try {
    const res = await fetch(path, { method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const text = await res.text();
    let body: T | null = null;
    try { body = text ? (JSON.parse(text) as T) : null; } catch { body = null; }
    if (res.status === 401 && token && !path.startsWith('/api/auth/') && onSessionExpired) onSessionExpired();
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(slow);
    if (waiting > 0) { waiting = 0; setWaking(false); }
  }
}

// The message the API sent with an error, if there was one.
export function messageOf(result: ApiResult, fallback: string): string {
  const body = result.body as { message?: unknown } | null;
  return body && typeof body.message === 'string' ? body.message : fallback;
}
