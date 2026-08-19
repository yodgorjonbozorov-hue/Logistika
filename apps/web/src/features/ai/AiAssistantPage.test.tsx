/**
 * The assistant's UI contract.
 *
 * Two things matter here beyond "it renders": the figures shown are the ones
 * the API sent, byte for byte, and the user can always tell whether a model or
 * the deterministic composer wrote the sentence they are reading.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../shared/i18n';

const apiMock = vi.fn();
vi.mock('../../shared/api/client', () => ({
  api: (path: string, options?: unknown) => apiMock(path, options),
}));

const { AiAssistantPage } = await import('./AiAssistantPage');

const ANSWER = {
  answer: "Davr: 2026-08-01 … 2026-08-31. Sof foyda — 6 000 000 so'm, rentabellik 66,7 %.",
  source: 'model' as const,
  fallbackReason: null,
  intents: ['PROFIT'],
  period: {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    label: '2026-08-01 … 2026-08-31',
  },
  facts: [
    { key: 'revenue', value: '9 000 000', unit: 'som' },
    { key: 'profit', value: '6 000 000', unit: 'som' },
    { key: 'margin', value: '66,7 %', unit: 'percent' },
    { key: 'route_1_name', value: 'Toshkent-Samarqand', unit: 'text' },
  ],
  provider: 'anthropic',
};

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

const askAndWait = async (text: string) => {
  fireEvent.change(screen.getByLabelText(/savolingizni yozing/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Yuborish' }));
};

describe('AiAssistantPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === '/ai/status') {
        return Promise.resolve({ data: { provider: 'anthropic', available: true }, meta: null });
      }
      if (path === '/ai/chat') return Promise.resolve({ data: ANSWER, meta: null });
      throw new Error(`unexpected request: ${path}`);
    });
  });

  it('offers the suggested prompts before anything has been asked', async () => {
    renderPage(<AiAssistantPage />);
    expect(await screen.findByText('Bu oy qancha foyda qildik?')).toBeDefined();
    expect(screen.getByText("Eng foydali yo'nalish qaysi?")).toBeDefined();
  });

  it('sends the question and shows the answer', async () => {
    renderPage(<AiAssistantPage />);
    await askAndWait('Bu oy qancha foyda?');

    expect(await screen.findByText(/Sof foyda/)).toBeDefined();
    const call = apiMock.mock.calls.find((c) => c[0] === '/ai/chat');
    expect(call![1]).toMatchObject({ method: 'POST' });
    expect((call![1] as { body: { question: string } }).body.question).toBe('Bu oy qancha foyda?');
  });

  it('sends the current UI language so the answer comes back in it', async () => {
    renderPage(<AiAssistantPage />);
    await askAndWait('Bu oy qancha foyda?');
    await waitFor(() => expect(apiMock.mock.calls.some((c) => c[0] === '/ai/chat')).toBe(true));

    const body = (
      apiMock.mock.calls.find((c) => c[0] === '/ai/chat')![1] as { body: { locale: string } }
    ).body;
    expect(['uz-latn', 'uz-cyrl', 'ru']).toContain(body.locale);
  });

  it('shows the figures behind the answer on request, exactly as sent', async () => {
    renderPage(<AiAssistantPage />);
    await askAndWait('Bu oy qancha foyda?');
    fireEvent.click(await screen.findByText("Raqamlarni ko'rsatish"));

    expect(screen.getByText('9 000 000')).toBeDefined();
    expect(screen.getByText('66,7 %')).toBeDefined();
    // A route name is not a figure and has no place in the numbers panel.
    expect(screen.queryByText('Toshkent-Samarqand')).toBeNull();
  });

  it('says whether a model or the fallback wrote the answer', async () => {
    renderPage(<AiAssistantPage />);
    await askAndWait('Bu oy qancha foyda?');
    expect(await screen.findByText('AI javobi')).toBeDefined();

    apiMock.mockImplementation((path: string) => {
      if (path === '/ai/status') {
        return Promise.resolve({ data: { provider: 'mock', available: true }, meta: null });
      }
      return Promise.resolve({
        data: { ...ANSWER, source: 'template', fallbackReason: 'timeout' },
        meta: null,
      });
    });
    await askAndWait('Yana bir savol?');
    expect(await screen.findByText('Hisobot asosida')).toBeDefined();
  });

  it('shows an error without losing the conversation', async () => {
    renderPage(<AiAssistantPage />);
    await askAndWait('Bu oy qancha foyda?');
    await screen.findByText(/Sof foyda/);

    apiMock.mockImplementation((path: string) => {
      if (path === '/ai/status') {
        return Promise.resolve({ data: { provider: 'mock', available: true }, meta: null });
      }
      return Promise.reject(new Error('boom'));
    });
    await askAndWait('Yana bir savol?');

    expect(await screen.findByText("Ma'lumotlarni olishda xatolik yuz berdi.")).toBeDefined();
    // The earlier turn is still on screen.
    expect(screen.getByText(/Sof foyda/)).toBeDefined();
  });

  it('does not send an empty question', async () => {
    renderPage(<AiAssistantPage />);
    const button = screen.getByRole('button', { name: 'Yuborish' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(apiMock.mock.calls.filter((c) => c[0] === '/ai/chat')).toHaveLength(0);
  });
});
