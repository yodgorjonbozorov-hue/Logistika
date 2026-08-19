import { useMutation, useQuery } from '@tanstack/react-query';
import type { AiAnswer, AiInsight, AiStatus, Locale } from 'shared';
import { api } from '../../shared/api/client';

/**
 * The assistant is reached only through this API — there is no provider key in
 * the browser and no direct call to any model. That is what makes the rate
 * limit, the tenant scope and the prompt guard enforceable at all.
 */
export function useAiChat() {
  return useMutation({
    mutationFn: async (input: { question: string; locale: Locale }) =>
      (
        await api<AiAnswer>('/ai/chat', {
          method: 'POST',
          body: { question: input.question, locale: input.locale },
        })
      ).data,
  });
}

/**
 * Insights are deterministic and provider-free, so they load on every dashboard
 * render and keep working when the AI provider does not. Failure is silent by
 * design: an insight card is a bonus, and a dashboard that renders an error
 * banner because an extra was unavailable is worse than one without the extra.
 */
export function useAiInsights() {
  return useQuery({
    queryKey: ['ai', 'insights'],
    queryFn: async () => (await api<AiInsight[]>('/ai/insights')).data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: async () => (await api<AiStatus>('/ai/status')).data,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}
