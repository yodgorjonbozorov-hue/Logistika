import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import type { AuthTokens, UserRole } from 'shared';
import { api, tokenStore } from '../api/client';
import type { User } from '../api/entities';

interface AuthContextValue {
  user: User | null;
  role: UserRole | null;
  /** A refresh token exists — the router may render protected routes. */
  isAuthenticated: boolean;
  isLoading: boolean;
  /** /auth/me failed (deactivated user, revoked session…). */
  error: unknown;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const isAuthenticated = Boolean(tokenStore.refresh);

  const {
    data: user = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api<User>('/auth/me')).data,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const login = useCallback(
    async (identifier: string, password: string) => {
      const { data } = await api<AuthTokens>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      tokenStore.set(data.accessToken, data.refreshToken);
      // The role decides where to land, so the profile is fetched before redirecting.
      const me = (await api<User>('/auth/me')).data;
      queryClient.setQueryData(['auth', 'me'], me);
      return me;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh;
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    }
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
        role: (user?.role as UserRole | undefined) ?? null,
        isAuthenticated,
        isLoading,
        error,
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
