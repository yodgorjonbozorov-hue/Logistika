import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { api, tokenStore, tryRefresh } from '../api/client';
import type { User } from '../api/entities';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  /**
   * The session is whatever /auth/me says it is.
   *
   * The access token is in memory now, so a page reload starts with none; the
   * httpOnly refresh cookie is the thing that survives. This asks for a fresh
   * access token first and then identifies the user — which is also why the
   * query always runs instead of being gated on a token being present.
   */
  const { data: user = null, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      if (!tokenStore.access) await tryRefresh();
      return (await api<User>('/auth/me')).data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const login = useCallback(
    async (identifier: string, password: string) => {
      const { data } = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      // The refresh token came back as an httpOnly cookie, not in this payload.
      tokenStore.set(data.accessToken);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    // The cookie identifies the session; nothing needs to be sent.
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    tokenStore.clear();
    queryClient.clear();
    window.location.assign('/login');
  }, [queryClient]);

  // The API client fires this when the refresh token dies mid-session.
  useEffect(() => {
    const handler = () => {
      tokenStore.clear();
      queryClient.clear();
      window.location.assign('/login');
    };
    window.addEventListener('tc:logout', handler);
    return () => window.removeEventListener('tc:logout', handler);
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
