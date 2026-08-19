import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthTokens } from 'shared';
import { api, restoreSession, tokenStore } from '../api/client';
import type { User } from '../api/entities';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /** A refresh cookie is expected to exist — the session may still be restoring. */
  hasSession: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // The access token lives in memory only (H-16), so a page reload starts with
  // no token at all and has to exchange the httpOnly cookie for a fresh one
  // before any request can succeed.
  const [restoring, setRestoring] = useState(() => tokenStore.hasSession);

  useEffect(() => {
    if (!restoring) return;
    let cancelled = false;
    void restoreSession().finally(() => {
      if (!cancelled) setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, [restoring]);

  const { data: user = null, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api<User>('/auth/me')).data,
    enabled: !restoring && Boolean(tokenStore.access),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const login = useCallback(
    async (identifier: string, password: string) => {
      const { data } = await api<AuthTokens>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      // Only the access token is kept; the refresh token stays in the cookie
      // the server just set, out of reach of any script on the page.
      tokenStore.set(data.accessToken);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    // The server clears the cookie; the body is empty because the browser
    // already carries the token.
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
    <AuthContext.Provider
      value={{
        user,
        isLoading: restoring || isLoading,
        hasSession: tokenStore.hasSession,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
