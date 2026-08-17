import { auditDiff, auditSnapshot } from './audit.snapshot';

const VEHICLE = {
  id: 'v1',
  plateNumber: '01 A 123 AA',
  purchasePrice: 90_000_000_000n,
  fuelNormPer100km: '32.00',
  currentOdometer: 412_300,
  isActive: true,
  insuranceExpiry: new Date('2027-03-01T00:00:00Z'),
  createdAt: new Date('2026-01-05T09:00:00Z'),
};

describe('auditSnapshot', () => {
  it('turns money and dates into something a JSON column can hold', () => {
    const snapshot = auditSnapshot(VEHICLE);
    // BigInt tiyin would make the audit write fail on exactly the rows that
    // matter most, so it is written out in full rather than rounded away.
    expect(snapshot.purchasePrice).toBe('90000000000');
    expect(snapshot.insuranceExpiry).toBe('2027-03-01T00:00:00.000Z');
    expect(snapshot.currentOdometer).toBe(412_300);
    expect(snapshot.isActive).toBe(true);
  });

  it('never copies a secret, whatever the caller hands over', () => {
    const snapshot = auditSnapshot({
      id: 'u1',
      fullName: 'Jasur',
      passwordHash: '$argon2id$v=19$...',
      tokenHash: 'abc',
      telegramChatId: '12345',
      passport: 'AA1234567',
    });
    expect(snapshot).toEqual({ id: 'u1', fullName: 'Jasur' });
  });

  it('records only the fields asked for, when a caller narrows it', () => {
    expect(auditSnapshot(VEHICLE, ['plateNumber', 'isActive'])).toEqual({
      plateNumber: '01 A 123 AA',
      isActive: true,
    });
  });

  it('keeps null distinct from missing', () => {
    expect(auditSnapshot({ a: null })).toEqual({ a: null });
    expect(auditSnapshot(VEHICLE, ['nothingLikeThis'])).toEqual({});
  });

  it('truncates long free text instead of storing an essay', () => {
    const snapshot = auditSnapshot({ description: 'x'.repeat(2000) });
    expect(String(snapshot.description)).toHaveLength(500);
  });

  it('drops a value it cannot render, rather than writing [object Object]', () => {
    expect(auditSnapshot({ id: 'x', payload: { nested: true } })).toEqual({ id: 'x' });
  });

  it('survives being handed something that is not a row', () => {
    expect(auditSnapshot(null)).toEqual({});
    expect(auditSnapshot('a string')).toEqual({});
  });
});

describe('auditDiff', () => {
  it('records only what moved', () => {
    const after = { ...VEHICLE, currentOdometer: 415_000 };
    expect(auditDiff(VEHICLE, after)).toEqual({ currentOdometer: '412300 → 415000' });
  });

  it('says nothing when nothing changed', () => {
    expect(auditDiff(VEHICLE, { ...VEHICLE })).toEqual({});
  });

  it('shows a money change in full, both sides', () => {
    const after = { ...VEHICLE, purchasePrice: 85_000_000_000n };
    expect(auditDiff(VEHICLE, after)).toEqual({
      purchasePrice: '90000000000 → 85000000000',
    });
  });

  it('marks a field that was empty before', () => {
    expect(auditDiff({ id: 'v1', vin: null }, { id: 'v1', vin: 'WMA06XZZ' })).toEqual({
      vin: '— → WMA06XZZ',
    });
  });
});
