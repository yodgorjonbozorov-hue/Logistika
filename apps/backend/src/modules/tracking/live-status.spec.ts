import { LiveStatus } from 'shared';
import { statusFromEvent } from './tracking.service';

describe('statusFromEvent (W-2 map colors)', () => {
  it('no active trip → IDLE (gray)', () => {
    expect(statusFromEvent(null, false)).toBe(LiveStatus.IDLE);
    expect(statusFromEvent('START', false)).toBe(LiveStatus.IDLE);
  });

  it('breakdown → BREAKDOWN (red)', () => {
    expect(statusFromEvent('BREAKDOWN', true)).toBe(LiveStatus.BREAKDOWN);
  });

  it('rest → RESTING (yellow), resume flips back to MOVING (green)', () => {
    expect(statusFromEvent('REST', true)).toBe(LiveStatus.RESTING);
    expect(statusFromEvent('RESUME', true)).toBe(LiveStatus.MOVING);
  });

  it('normal progress events → MOVING', () => {
    for (const type of ['START', 'LOADED', 'REFUEL', 'CUSTOMS', 'EXPENSE'] as const) {
      expect(statusFromEvent(type, true)).toBe(LiveStatus.MOVING);
    }
  });

  it('delivered/finished → IDLE', () => {
    expect(statusFromEvent('DELIVERED', true)).toBe(LiveStatus.IDLE);
    expect(statusFromEvent('FINISH', true)).toBe(LiveStatus.IDLE);
  });

  it('assigned but no events yet → IDLE', () => {
    expect(statusFromEvent(null, true)).toBe(LiveStatus.IDLE);
  });
});
