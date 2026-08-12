import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import type { AuthTokens } from 'shared';
import { api, IS_DEMO, tokenStore } from '../api/client';

/** Hard redirect to login; the demo build navigates via the hash instead. */
function gotoLogin() {
  window.location.assign(IS_DEMO ? '#/login' : '/login');
  if (IS_DEMO) window.location.reload();
}
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

  const { data: user = null, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api<User>('/auth/me')).data,
    enabled: Boolean(tokenStore.access),
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
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
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
    gotoLogin();
  }, [queryClient]);

  // The API client fires this when the refresh token dies mid-session.
  useEffect(() => {
    const handler = () => {
      tokenStore.clear();
      queryClient.clear();
      gotoLogin();
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
