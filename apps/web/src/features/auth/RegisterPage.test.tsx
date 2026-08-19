import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';

const registerMock = vi.fn();
const navigateMock = vi.fn();

// Assert against keys, not wording, so re-phrasing a string cannot break this.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../shared/auth/AuthContext', () => ({
  useAuth: () => ({ register: registerMock }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

/** Fills the form; every field is addressed by its visible label. */
async function fill(overrides: Partial<Record<string, string>> = {}) {
  const user = userEvent.setup();
  const values: Record<string, string> = {
    'auth.register.companyName': 'Yo‘l Logistika',
    'auth.register.fullName': 'Umar Karimov',
    'auth.register.email': 'owner@yol.uz',
    'auth.register.phone': '+998901112233',
    'auth.register.password': 'StrongPass123',
    'auth.register.passwordRepeat': 'StrongPass123',
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    if (!value) continue;
    await user.type(screen.getByLabelText(label), value);
  }
  return user;
}

describe('RegisterPage', () => {
  beforeEach(() => {
    registerMock.mockReset().mockResolvedValue(undefined);
    navigateMock.mockReset();
  });

  it('signs the new owner up and drops them into the app', async () => {
    renderPage();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'auth.register.submit' }));

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
    expect(registerMock).toHaveBeenCalledWith({
      companyName: 'Yo‘l Logistika',
      fullName: 'Umar Karimov',
      email: 'owner@yol.uz',
      phone: '+998901112233',
      password: 'StrongPass123',
    });
    expect(navigateMock).toHaveBeenCalledWith('/overview', { replace: true });
  });

  it('omits an empty phone rather than sending a blank string', async () => {
    renderPage();
    const user = await fill({ 'auth.register.phone': '' });
    await user.click(screen.getByRole('button', { name: 'auth.register.submit' }));

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
    expect((registerMock.mock.calls[0]?.[0] as { phone?: string }).phone).toBeUndefined();
  });

  it('refuses to submit when the two passwords differ', async () => {
    renderPage();
    const user = await fill({ 'auth.register.passwordRepeat': 'DifferentPass123' });
    await user.click(screen.getByRole('button', { name: 'auth.register.submit' }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(await screen.findByText('auth.register.passwordMismatch')).toBeTruthy();
  });

  it('refuses a password shorter than eight characters', async () => {
    renderPage();
    const user = await fill({
      'auth.register.password': 'short',
      'auth.register.passwordRepeat': 'short',
    });
    await user.click(screen.getByRole('button', { name: 'auth.register.submit' }));

    expect(registerMock).not.toHaveBeenCalled();
    expect(await screen.findByText('auth.register.passwordTooShort')).toBeTruthy();
  });

  it('surfaces a rejected sign-up instead of navigating away', async () => {
    registerMock.mockRejectedValue(new Error('Bu email allaqachon ro‘yxatdan o‘tgan'));
    renderPage();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'auth.register.submit' }));

    expect(await screen.findByText(/allaqachon/i)).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
