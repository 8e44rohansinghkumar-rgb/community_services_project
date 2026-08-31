/**
 * Authentication state.
 *
 * The SPA holds only the user PROFILE in memory. Credentials live exclusively in
 * HttpOnly cookies the JavaScript cannot read, so there is nothing here for an
 * XSS payload to exfiltrate. On boot we ask the server who we are; the answer is
 * authoritative.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, SESSION_EXPIRED_EVENT } from '@/api/client';
import type { User } from '@/types';

interface AuthContextValue {
  user: User | null;
  /** True until the initial "who am I" probe resolves. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfile: (input: { name?: string; phone?: string | null }) => Promise<void>;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch (error) {
      // 401 here simply means "not signed in" — an expected state, not a failure.
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.warn('Could not load the current session', error);
      }
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadUser();
      setInitialising(false);
    })();
  }, [loadUser]);

  // The API client emits this when a refresh attempt definitively fails.
  useEffect(() => {
    const handler = (): void => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const data = await api.post<{ user: User }>('/auth/login', { email, password }, { skipRetry: true });
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<User> => {
    const payload: Record<string, unknown> = {
      name: input.name,
      email: input.email,
      password: input.password,
    };
    if (input.phone?.trim()) payload.phone = input.phone.trim();
    const data = await api.post<{ user: User }>('/auth/register', payload, { skipRetry: true });
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout', {}, { skipRetry: true });
    } finally {
      // Clear locally even if the network call failed — the cookie is gone or
      // will be rejected on next use.
      setUser(null);
    }
  }, []);

  const updateProfile = useCallback(async (input: { name?: string; phone?: string | null }) => {
    const data = await api.patch<{ user: User }>('/auth/me', input);
    setUser(data.user);
  }, []);

  const value = useMemo(
    () => ({ user, initialising, login, register, logout, refreshUser: loadUser, updateProfile }),
    [user, initialising, login, register, logout, loadUser, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
