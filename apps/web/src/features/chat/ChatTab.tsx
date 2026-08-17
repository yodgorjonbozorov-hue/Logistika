import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useChatMessages,
  useFileUrl,
  useMarkChatRead,
  useSendMessage,
  type ChatMessage,
} from '../../shared/api/chat';
import { Button, Card, EmptyState, ErrorMessage, Input, Spinner } from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';

/**
 * W-4 chat tab (TZ §3.2 E-4): logist ↔ driver about one trip.
 *
 * Text, photo and voice note. Attachments are ordinary uploads referenced by
 * id, so a voice note here obeys the same 30-day retention as one recorded on
 * the driver's home screen — the chat does not invent a second storage rule.
 */
export function ChatTab({ tripId }: { tripId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useChatMessages(tripId);
  const send = useSendMessage(tripId);
  const markRead = useMarkChatRead(tripId);
  const [text, setText] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const messages = data ?? [];
  const unread = messages.some((message) => !message.mine && message.readAt === null);

  // Opening the tab marks the thread read; keyed on `unread` so the 20-second
  // poll does not fire it again on every refetch.
  const markReadMutation = markRead.mutate;
  useEffect(() => {
    if (unread) markReadMutation();
  }, [unread, markReadMutation]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    await send.mutateAsync({ body });
    setText('');
  }

  return (
    <Card>
      <ErrorMessage error={error ?? send.error} />
      {isLoading ? (
        <Spinner />
      ) : messages.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mb-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
          <div ref={bottom} />
        </ul>
      )}

      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('chat.placeholder')}
          disabled={send.isPending}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={send.isPending}
            onClick={() => photoInput.current?.click()}
          >
            {t('chat.photo')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={send.isPending}
            onClick={() => voiceInput.current?.click()}
          >
            {t('chat.voice')}
          </Button>
          <Button type="submit" disabled={send.isPending || !text.trim()}>
            {send.isPending ? t('chat.sending') : t('chat.send')}
          </Button>
        </div>
      </form>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send.mutateAsync({ file, kind: 'PHOTO' });
          event.target.value = '';
        }}
      />
      <input
        ref={voiceInput}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send.mutateAsync({ file, kind: 'VOICE' });
          event.target.value = '';
        }}
      />
    </Card>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();

  return (
    <li className={message.mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          message.mine
            ? 'max-w-[80%] rounded-lg bg-accent/20 px-3 py-2 text-sm'
            : 'max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-white/10'
        }
      >
        {!message.mine && message.senderName && (
          <div className="mb-0.5 text-xs font-medium text-muted">{message.senderName}</div>
        )}

        {message.kind === 'TEXT' ? (
          <p className="whitespace-pre-line">{message.body}</p>
        ) : (
          <Attachment message={message} />
        )}

        <div className="mt-1 text-right text-[11px] text-muted">
          {formatDateTime(message.createdAt)}
          {message.mine && message.readAt && ` · ${t('chat.read')}`}
        </div>
      </div>
    </li>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const { data: url, isLoading } = useFileUrl(message.fileId);

  if (isLoading) return <Spinner />;
  if (!url) return <span className="text-xs text-muted">{t('chat.attachmentUnavailable')}</span>;

  return message.kind === 'PHOTO' ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={t('chat.photo')} className="max-h-64 rounded" />
    </a>
  ) : (
    <audio controls src={url} className="w-56">
      <track kind="captions" />
    </audio>
  );
}
