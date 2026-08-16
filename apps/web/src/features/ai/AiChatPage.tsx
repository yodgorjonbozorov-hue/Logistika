import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatus, useAskAi, type ChatReply } from '../../shared/api/ai';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Spinner,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';

interface Exchange {
  question: string;
  reply: ChatReply;
}

/** Questions from TZ §8.4 — a starting point, not a menu the answer is limited to. */
const EXAMPLE_KEYS = ['losingVehicle', 'fuelGap', 'profitTrend', 'receivables'] as const;

/**
 * W-12 «AI-boshliq» (TZ §8.4).
 *
 * The owner types a question; the server picks one prepared query, runs it and
 * words the result. Every answer is shown with the query and period it came
 * from, because a figure a boss cannot trace is a figure they will not act on.
 */
export function AiChatPage() {
  const { t } = useTranslation();
  const { data: status } = useAiStatus();
  const ask = useAskAi();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked) return;
    const reply = await ask.mutateAsync(asked);
    setHistory((previous) => [{ question: asked, reply }, ...previous]);
    setQuestion('');
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('ai.chat.title')} />

      {status && !status.available && (
        <Card>
          <p className="text-sm text-muted">
            {status.configured ? t('ai.chat.limitReached') : t('ai.chat.notConfigured')}
          </p>
        </Card>
      )}

      <Card>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('ai.chat.placeholder')}
            disabled={ask.isPending || status?.available === false}
          />
          <Button type="submit" disabled={ask.isPending || !question.trim()}>
            {ask.isPending ? t('ai.chat.thinking') : t('ai.chat.ask')}
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-muted hover:text-gray-700 dark:border-white/15 dark:hover:text-gray-200"
              onClick={() => setQuestion(t(`ai.chat.examples.${key}`))}
            >
              {t(`ai.chat.examples.${key}`)}
            </button>
          ))}
        </div>
      </Card>

      <ErrorMessage error={ask.error} />
      {ask.isPending && <Spinner />}

      {history.length === 0 && !ask.isPending ? (
        <EmptyState />
      ) : (
        history.map((exchange, index) => (
          <Card key={`${exchange.reply.requestIds[0]}-${index}`}>
            <p className="text-sm font-medium">{exchange.question}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{exchange.reply.answer}</p>
            <p className="mt-3 text-xs text-muted">
              {t('ai.chat.source', {
                query: t(`ai.chat.functions.${exchange.reply.source.function}`),
                from: formatDate(exchange.reply.source.from),
                to: formatDate(exchange.reply.source.to),
                count: exchange.reply.source.rowCount,
              })}
            </p>
          </Card>
        ))
      )}
    </div>
  );
}
