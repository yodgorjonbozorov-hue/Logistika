import { describe, expect, it } from 'vitest';
import { buildChannels } from './contacts';

describe('buildChannels', () => {
  it('builds dialable, clickable links out of plain settings', () => {
    expect(
      buildChannels({
        phone: '+998 90 123 45 67',
        telegram: '@truckcontrol',
        email: 'info@example.com',
      }),
    ).toEqual([
      { kind: 'phone', href: 'tel:+998901234567', label: '+998 90 123 45 67' },
      { kind: 'telegram', href: 'https://t.me/truckcontrol', label: '@truckcontrol' },
      { kind: 'email', href: 'mailto:info@example.com', label: 'info@example.com' },
    ]);
  });

  it('accepts a Telegram handle with or without the @', () => {
    expect(buildChannels({ telegram: 'truckcontrol' })[0]).toEqual({
      kind: 'telegram',
      href: 'https://t.me/truckcontrol',
      label: '@truckcontrol',
    });
  });

  it('renders nothing for channels that were never configured', () => {
    expect(buildChannels({})).toEqual([]);
    expect(buildChannels({ phone: '', telegram: '   ' })).toEqual([]);
  });
});
