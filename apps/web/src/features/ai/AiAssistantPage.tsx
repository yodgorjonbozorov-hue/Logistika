import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiAnswer, Locale } from 'shared';
import { Badge, Button, Card, ErrorMessage, PageHeader } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { useAiChat, useAiStatus } from './api';

interface Turn {
  id: number;
  question: string;
  answer?: AiAnswer;
  failed?: boolean;
}

const SUGGESTIONS = ['profit', 'topRoute', 'topExpenseVehicle', 'compare'] as const;

/**
 * The assistant.
 *
 * Everything on screen is answerable from this company's own data, and the
 * figures behind each answer are shown beside it — an assistant that states a
 * number without letting the reader check it is asking for trust it has not
 * earned. `source: 'template'` is surfaced too: the user should know when they
 * are reading generated prose and when they are reading the fallback.
 */
export function AiAssistantPage() {
  const { t, i18n } = useTranslation();
  const chat = useAiChat();
  const status = useAiStatus();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view without yanking the page on first paint.
  // `scrollIntoView` is optional-called: it is absent in jsdom and in a few
  // older mobile browsers, and a missing nicety must not take the page down.
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending) return;
    const id = Date.now();
    setTurns((previous) => [...previous, { id, question: trimmed }]);
    setQuestion('');
    try {
      const answer = await chat.mutateAsync({ question: trimmed, locale: i18n.language as Locale });
      setTurns((previous) => previous.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    } catch {
      // The error itself is rendered from the mutation state below; the turn is
      // marked so the question does not sit there looking unanswered forever.
      setTurns((previous) =>
        previous.map((turn) => (turn.id === id ? { ...turn, failed: true } : turn)),
      );
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        title={`🤖 ${t('ai.title')}`}
        actions={
          status.data && !status.data.available ? (
            <Badge tone="gray">{t('ai.unavailable')}</Badge>
          ) : undefined
        }
      />
      <p className="-mt-2 mb-4 text-sm text-muted">{t('ai.subtitle')}</p>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {turns.length === 0 && (
          <Card>
            <p className="mb-3 text-sm text-muted">{t('ai.suggestionsTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void send(t(`ai.suggestions.${key}`))}
                  className="min-h-11 rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:border-accent hover:text-accent dark:border-white/20 dark:text-gray-200"
                >
                  {t(`ai.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </Card>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm font-medium text-navy">
                {turn.question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm shadow-sm dark:bg-white/5">
                {turn.answer ? (
                  <AnswerBody answer={turn.answer} />
                ) : turn.failed ? (
                  <span className="text-danger">{t('ai.error')}</span>
                ) : (
                  <span className="text-muted">{t('ai.loading')}</span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(question);
        }}
        className="sticky bottom-0 mt-4 flex gap-2 border-t border-gray-200 bg-bg pt-3 dark:border-white/10"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t('ai.placeholder')}
          aria-label={t('ai.placeholder')}
          maxLength={500}
          className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 outline-none focus:border-accent dark:border-white/20 dark:bg-white/10 dark:text-gray-100"
        />
        <Button type="submit" disabled={chat.isPending || question.trim().length === 0}>
          {chat.isPending ? t('ai.loadingShort') : t('ai.send')}
        </Button>
      </form>
      <ErrorMessage error={chat.error} />
    </div>
  );
}

function AnswerBody({ answer }: { answer: AiAnswer }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const numeric = answer.facts.filter((fact) => fact.unit !== 'text');

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>

      {numeric.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {open ? t('ai.hideFacts') : t('ai.showFacts')}
          </button>
          {open && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5">
              {numeric.map((fact) => (
                <div key={fact.key} className="contents">
                  <dt className="truncate text-muted">{fact.key}</dt>
                  <dd className="text-right tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{answer.period.label}</span>
        {/* Whether a model wrote this or the deterministic composer did is not
            a detail: the figures are identical either way, but the phrasing is
            not, and the reader is entitled to know which they are reading. */}
        <span
          className={cn(
            'rounded px-1.5 py-0.5',
            answer.source === 'model' ? 'bg-accent/15 text-accent' : 'bg-gray-200 dark:bg-white/10',
          )}
        >
          {t(answer.source === 'model' ? 'ai.sourceModel' : 'ai.sourceTemplate')}
        </span>
      </div>
    </div>
  );
}
