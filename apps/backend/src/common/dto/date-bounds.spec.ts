import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DAY_MS,
  DEVICE_EVENT_WINDOW,
  IsWithinDateWindow,
  MINUTE_MS,
  RECORDED_DATE_WINDOW,
} from './date-bounds';

class Recorded {
  @IsWithinDateWindow(RECORDED_DATE_WINDOW)
  when?: string;
}

class DeviceStamped {
  @IsWithinDateWindow(DEVICE_EVENT_WINDOW)
  when?: string;
}

const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const check = async <T extends object>(cls: new () => T, when: string | undefined) =>
  (await validate(plainToInstance(cls, { when }))).length === 0;

describe('a date a person typed (RECORDED_DATE_WINDOW)', () => {
  it('accepts today and the past', async () => {
    expect(await check(Recorded, at(0))).toBe(true);
    expect(await check(Recorded, at(-365 * DAY_MS))).toBe(true);
  });

  it('accepts tomorrow, because the office and the driver straddle midnight', async () => {
    expect(await check(Recorded, at(12 * 3600_000))).toBe(true);
  });

  it('refuses next year', async () => {
    expect(await check(Recorded, at(400 * DAY_MS))).toBe(false);
  });

  it('refuses something that is not a date', async () => {
    expect(await check(Recorded, 'ertaga')).toBe(false);
  });

  it('leaves an absent value to @IsOptional', async () => {
    expect(await check(Recorded, undefined)).toBe(true);
  });
});

describe('a moment a device stamped (DEVICE_EVENT_WINDOW)', () => {
  it('tolerates ordinary clock drift', async () => {
    expect(await check(DeviceStamped, at(2 * MINUTE_MS))).toBe(true);
  });

  it('refuses a clock set well ahead', async () => {
    expect(await check(DeviceStamped, at(60 * MINUTE_MS))).toBe(false);
  });

  it('accepts a queue that has been offline for a fortnight', async () => {
    expect(await check(DeviceStamped, at(-14 * DAY_MS))).toBe(true);
  });

  it('refuses 1970, which is what a reset clock reports', async () => {
    // It would reorder the trip's history and land in the wrong reporting
    // month without looking like an error anywhere.
    expect(await check(DeviceStamped, '1970-01-01T00:00:00Z')).toBe(false);
  });
});
