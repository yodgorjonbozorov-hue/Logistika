// Trip chat (TZ §3.2 E-4): logist ↔ driver, text, photo and voice notes.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile } from './client';
import type { StoredFile } from './ai';

export type ChatMessageKind = 'TEXT' | 'PHOTO' | 'VOICE';

export interface ChatMessage {
  id: string;
  tripId: string;
  senderId: string | null;
  senderName: string | null;
  /** True for the reader's own messages — the panel aligns bubbles by this. */
  mine: boolean;
  kind: ChatMessageKind;
  body: string | null;
  fileId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function useChatMessages(tripId: string) {
  return useQuery({
    queryKey: ['chat', tripId],
    queryFn: () => api<ChatMessage[]>(`/chat/${tripId}/messages`).then((r) => r.data),
    // A conversation is only useful if it arrives; polling keeps it simple and
    // costs one small query a driver's phone can afford.
    refetchInterval: 20_000,
  });
}

export function useSendMessage(tripId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['chat', tripId] });

  return useMutation({
    mutationFn: async (input: { body?: string; file?: File; kind?: ChatMessageKind }) => {
      // An attachment is an ordinary upload first, so it lands under the same
      // tenant prefix and the same retention rules as any other file.
      const stored = input.file
        ? await uploadFile<StoredFile>('/files/upload', input.file)
        : undefined;
      const { data } = await api<ChatMessage>(`/chat/${tripId}/messages`, {
        method: 'POST',
        body: {
          kind: input.kind ?? (stored ? 'PHOTO' : 'TEXT'),
          body: input.body,
          fileId: stored?.id,
        },
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useMarkChatRead(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ read: number }>(`/chat/${tripId}/read`, { method: 'POST', body: {} }).then(
        (r) => r.data,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['chat', tripId] }),
  });
}

export function useFileUrl(fileId: string | null) {
  return useQuery({
    queryKey: ['files', fileId],
    enabled: Boolean(fileId),
    // Signed URLs are short-lived; refetching before expiry keeps them usable.
    staleTime: 10 * 60_000,
    queryFn: () => api<{ url: string }>(`/files/${fileId}/url`).then((r) => r.data.url),
  });
}
