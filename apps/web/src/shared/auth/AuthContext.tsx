import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import type { AuthTokens, RegisterRequest } from 'shared';
import { api, tokenStore } from '../api/client';
import type { User } from '../api/entities';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
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

  // Sign-up returns the same token pair as a login, so the new owner lands
  // inside the app without a second round trip.
  const register = useCallback(
    async (input: RegisterRequest) => {
      const { data } = await api<AuthTokens>('/auth/register', { method: 'POST', body: input });
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
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
