/**
 * HTTP client.
 *
 * Key behaviours:
 *  - `credentials: 'include'` so HttpOnly auth cookies travel with each request.
 *    No token is ever read from or written to localStorage.
 *  - Reads the readable CSRF cookie and echoes it in X-CSRF-Token on every
 *    state-changing request (the double-submit half the SPA is responsible for).
 *  - On a 401 it attempts ONE silent refresh, then replays the original request.
 *    Concurrent 401s share a single refresh promise so a dashboard firing five
 *    queries does not trigger five rotations (which would look like token reuse).
 */

/** Same-origin by default: Vite proxies /api to the backend in development. */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

const CSRF_COOKIE = 'civic_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-keyed messages for inline form errors. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (detail.field && !map[detail.field]) map[detail.field] = detail.message;
    }
    return map;
  }
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Fetch a CSRF token if we do not already have one (first visit / expiry). */
async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  try {
    await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' });
    return readCookie(CSRF_COOKIE);
  } catch {
    return null;
  }
}

/* --- single-flight refresh ------------------------------------------- */

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const csrf = await ensureCsrfToken();
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Release the lock on the next tick so simultaneous callers all see it.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

/** Broadcast so AuthContext can clear state when the session truly ends. */
export const SESSION_EXPIRED_EVENT = 'civic:session-expired';

function announceSessionExpiry(): void {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/* --- core request ----------------------------------------------------- */

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** FormData bypasses JSON encoding (multipart uploads). */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry (used by auth calls themselves). */
  skipRetry?: boolean;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function performRequest(path: string, options: RequestOptions): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};

  if (UNSAFE_METHODS.has(method)) {
    const csrf = await ensureCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    // Do NOT set Content-Type: the browser must add the multipart boundary.
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  return fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body,
    signal: options.signal,
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await performRequest(path, options);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }

  // Silent refresh on expiry, then one replay.
  if (response.status === 401 && !options.skipRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await performRequest(path, options);
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
      }
    } else {
      announceSessionExpiry();
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = (await parseResponse(response)) as
    | { success: boolean; data?: T; error?: { code: string; message: string; details?: ApiErrorDetail[]; requestId?: string } }
    | null;

  if (!response.ok || !payload?.success) {
    const err = payload?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN_ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
      err?.requestId,
    );
  }

  return payload.data as T;
}

/** Paginated GET: preserves the sibling `pagination` object. */
export async function requestPaginated<T>(path: string, signal?: AbortSignal): Promise<PaginatedResult<T>> {
  let response: Response;
  try {
    response = await performRequest(path, { signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }

  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) response = await performRequest(path, { signal });
    else announceSessionExpiry();
  }

  const payload = (await parseResponse(response)) as
    | { success: boolean; data?: T[]; pagination?: Pagination; error?: { code: string; message: string; details?: ApiErrorDetail[] } }
    | null;

  if (!response.ok || !payload?.success) {
    const err = payload?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN_ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
    );
  }

  return {
    data: payload.data ?? [],
    pagination: payload.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  getPaginated: <T>(path: string, signal?: AbortSignal) => requestPaginated<T>(path, signal),
  post: <T>(path: string, body?: unknown, opts?: Partial<RequestOptions>) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
