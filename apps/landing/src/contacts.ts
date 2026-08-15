/**
 * Contact channels come from the environment so that the site can be deployed
 * without hardcoding anyone's phone number into the repository. Whatever is not
 * configured simply does not render.
 */
export interface ContactChannel {
  kind: 'phone' | 'telegram' | 'email';
  href: string;
  label: string;
}

const PHONE = import.meta.env.VITE_CONTACT_PHONE ?? '';
const TELEGRAM = import.meta.env.VITE_CONTACT_TELEGRAM ?? '';
const EMAIL = import.meta.env.VITE_CONTACT_EMAIL ?? '';
/** Where the «login» button points — the logist/owner panel. */
export const PANEL_URL = import.meta.env.VITE_PANEL_URL ?? '';

/** Pure builder — the env only decides which of these are present. */
export function buildChannels(config: {
  phone?: string;
  telegram?: string;
  email?: string;
}): ContactChannel[] {
  const channels: ContactChannel[] = [];
  const phone = config.phone?.trim();
  const telegram = config.telegram?.trim();
  const email = config.email?.trim();

  if (phone)
    channels.push({ kind: 'phone', href: `tel:${phone.replace(/\s/g, '')}`, label: phone });
  if (telegram) {
    const handle = telegram.replace(/^@/, '');
    channels.push({ kind: 'telegram', href: `https://t.me/${handle}`, label: `@${handle}` });
  }
  if (email) channels.push({ kind: 'email', href: `mailto:${email}`, label: email });
  return channels;
}

export function contactChannels(): ContactChannel[] {
  return buildChannels({ phone: PHONE, telegram: TELEGRAM, email: EMAIL });
}
