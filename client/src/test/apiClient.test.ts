/**
 * API client behaviour: CSRF echoing, cookie-only auth, silent refresh and
 * error normalisation. These are the parts that would silently break security
 * if someone "simplified" them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client keeps module-level state (the single-flight refresh promise), so
 * every test loads a fresh copy. Sharing it would let one test's in-flight
 * refresh satisfy the next test's 401 and hide a real regression.
 */
type Client = typeof import('@/api/client');
type ApiErrorInstance = InstanceType<Client['ApiError']>;
let ApiError: Client['ApiError'];
let request: Client['request'];
let SESSION_EXPIRED_EVENT: Client['SESSION_EXPIRED_EVENT'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ok = (data: unknown) => jsonResponse({ success: true, data });
const fail = (status: number, code: string, message = 'nope', details?: unknown) =>
  jsonResponse({ success: false, error: { code, message, details } }, status);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Clear cookies between tests.
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }

  vi.resetModules();
  ({ ApiError, request, SESSION_EXPIRED_EVENT } = await import('@/api/client'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Credentials', () => {
  it('sends cookies on every request', async () => {
    fetchMock.mockResolvedValue(ok({ ping: true }));
    await request('/health');

    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'include' }));
  });

  it('never reads or writes a token in localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    // A fresh Response per call: a body can only be consumed once.
    fetchMock.mockImplementation(() => Promise.resolve(ok({ user: { id: 'u1' } })));
    await request('/auth/me');
    await request('/issues', { method: 'POST', body: { title: 'x' } });

    // Storing a bearer token in localStorage would expose it to any XSS.
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('never attaches an Authorization header', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await request('/issues');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});

describe('CSRF double-submit', () => {
  it('echoes the readable CSRF cookie on a POST', async () => {
    document.cookie = 'civic_csrf=token-abc-123; path=/';
    fetchMock.mockResolvedValue(ok({ created: true }));

    await request('/issues', { method: 'POST', body: { title: 'A new issue' } });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('token-abc-123');
  });

  it('echoes it on PATCH and DELETE too', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    fetchMock.mockImplementation(() => Promise.resolve(ok({})));

    await request('/issues/1', { method: 'PATCH', body: { title: 'x' } });
    await request('/issues/1', { method: 'DELETE' });

    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('tok');
    }
  });

  it('does not send the header on a safe GET', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    fetchMock.mockResolvedValue(ok({}));

    await request('/issues');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('bootstraps a token when the cookie is missing', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/csrf')) {
        document.cookie = 'civic_csrf=fresh-token; path=/';
        return Promise.resolve(ok({ csrfToken: 'fresh-token' }));
      }
      return Promise.resolve(ok({}));
    });

    await request('/issues', { method: 'POST', body: {} });

    expect(fetchMock.mock.calls[0]![0]).toContain('/auth/csrf');
    const headers = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('fresh-token');
  });
});

describe('Silent refresh', () => {
  it('refreshes once on a 401 and replays the original request', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    let attempt = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(ok({ refreshed: true }));
      attempt += 1;
      return Promise.resolve(attempt === 1 ? fail(401, 'UNAUTHENTICATED') : ok({ issues: [] }));
    });

    const result = await request<{ issues: unknown[] }>('/issues');

    expect(result).toEqual({ issues: [] });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('announces expiry when the refresh itself fails', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(fail(401, 'REFRESH_INVALID'));
      return Promise.resolve(fail(401, 'UNAUTHENTICATED'));
    });

    await expect(request('/issues')).rejects.toThrow(ApiError);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it('does not try to refresh a failing auth call', async () => {
    fetchMock.mockResolvedValue(fail(401, 'INVALID_CREDENTIALS'));

    await expect(request('/auth/login', { method: 'POST', body: {} })).rejects.toThrow(ApiError);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/refresh'))).toBe(false);
  });

  it('shares one refresh between concurrent 401s', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    const seen = new Set<string>();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(ok({}));
      if (!seen.has(url)) {
        seen.add(url);
        return Promise.resolve(fail(401, 'UNAUTHENTICATED'));
      }
      return Promise.resolve(ok({ done: true }));
    });

    await Promise.all([request('/issues'), request('/notifications'), request('/analytics/overview')]);

    // Rotating the refresh token three times in parallel would look like token
    // reuse and kill the whole family.
    const refreshes = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });
});

describe('Error normalisation', () => {
  it('throws ApiError carrying the server code and message', async () => {
    fetchMock.mockResolvedValue(fail(409, 'INVALID_TRANSITION', 'Cannot go from REPORTED to CLOSED'));

    await expect(request('/issues/1/status', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Cannot go from REPORTED to CLOSED',
    });
  });

  it('exposes field errors as a map for inline form display', async () => {
    fetchMock.mockResolvedValue(
      fail(400, 'VALIDATION_ERROR', 'Invalid input', [
        { field: 'title', message: 'Title is too short' },
        { field: 'latitude', message: 'Out of range' },
      ]),
    );

    try {
      await request('/issues', { method: 'POST', body: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiErrorInstance).fieldErrors).toEqual({
        title: 'Title is too short',
        latitude: 'Out of range',
      });
    }
  });

  it('turns a network failure into a friendly NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(request('/issues')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('propagates an abort rather than masking it', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(request('/issues')).rejects.toThrow('aborted');
  });

  it('handles a 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(request('/notifications/read-all', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('handles a non-JSON error page without crashing', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    await expect(request('/issues')).rejects.toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });
});

describe('Request encoding', () => {
  it('JSON-encodes an object body', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    fetchMock.mockResolvedValue(ok({}));

    await request('/issues', { method: 'POST', body: { title: 'Hello' } });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"title":"Hello"}');
  });

  it('leaves Content-Type unset for FormData so the boundary is generated', async () => {
    document.cookie = 'civic_csrf=tok; path=/';
    fetchMock.mockResolvedValue(ok({}));

    const formData = new FormData();
    formData.append('title', 'With a photo');
    await request('/issues', { method: 'POST', formData });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });
});
