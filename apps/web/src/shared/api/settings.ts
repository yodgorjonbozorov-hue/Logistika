// W-11 company settings: profile, alert thresholds, AI switches and spend cap.
// Money is micro-USD (1 USD = 1_000_000) in decimal strings, the same unit the
// backend counts AI cost in; ratios are basis points.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const SUPPORTED_TIMEZONES = [
  'Asia/Tashkent',
  'Asia/Almaty',
  'Europe/Moscow',
  'Asia/Bishkek',
  'Asia/Dushanbe',
  'UTC',
] as const;

export interface Company {
  id: string;
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  tariffPlan: string | null;
  subscriptionUntil: string | null;
}

export interface CompanySettings {
  fuelDeviationThresholdBp: number;
  idleAlertHours: number;
  routeDeviationKm: number;
  digestTime: string;
  voiceEnabled: boolean;
  ocrEnabled: boolean;
  chatEnabled: boolean;
  anomalyEnabled: boolean;
  monthlyLimitMicroUsd: string;
  currentUsageMicroUsd: string;
  usageMonth: string;
}

export interface TelegramLinkState {
  linked: boolean;
  /** False when the platform has no bot at all — the card hides itself. */
  available: boolean;
}

export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company').then((r) => r.data),
  });
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['company', 'settings'],
    queryFn: () => api<CompanySettings>('/company/settings').then((r) => r.data),
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Company>) =>
      api<Company>('/company', { method: 'PATCH', body }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['company'] }),
  });
}

/** `monthlyLimitUsd` is whole dollars — what an owner thinks in (TZ §8.11). */
export interface SettingsUpdate {
  fuelDeviationThresholdBp?: number;
  idleAlertHours?: number;
  routeDeviationKm?: number;
  digestTime?: string;
  voiceEnabled?: boolean;
  ocrEnabled?: boolean;
  chatEnabled?: boolean;
  anomalyEnabled?: boolean;
  monthlyLimitUsd?: number;
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdate) =>
      api<CompanySettings>('/company/settings', { method: 'PATCH', body }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['company'] }),
  });
}

export function useTelegramLink() {
  return useQuery({
    queryKey: ['notifications', 'telegram'],
    queryFn: () => api<TelegramLinkState>('/notifications/telegram').then((r) => r.data),
  });
}

export function useLinkTelegram() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'telegram'] });
  return {
    link: useMutation({
      mutationFn: (chatId: string) =>
        api<TelegramLinkState>('/notifications/telegram', {
          method: 'PATCH',
          body: { chatId },
        }).then((r) => r.data),
      onSuccess: invalidate,
    }),
    unlink: useMutation({
      mutationFn: () =>
        api<TelegramLinkState>('/notifications/telegram', { method: 'DELETE' }).then((r) => r.data),
      onSuccess: invalidate,
    }),
  };
}

/** "1250000" micro-USD → "1.25" dollars, without leaving integers. */
export function microUsdToDollars(value: string, digits = 2): string {
  const micro = BigInt(value);
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, digits);
  return digits > 0 ? `${whole}.${fraction}` : whole.toString();
}
