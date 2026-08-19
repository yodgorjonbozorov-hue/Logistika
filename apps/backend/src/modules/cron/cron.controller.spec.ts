import type { TrackingService } from '../tracking/tracking.service';
import { CronController } from './cron.controller';

describe('CronController', () => {
  function setup(archiveOldTracks: jest.Mock) {
    return new CronController({ archiveOldTracks } as unknown as TrackingService);
  }

  it('reports how many rows the archive moved', async () => {
    const archive = jest.fn().mockResolvedValue(1240);
    await expect(setup(archive).archiveGps()).resolves.toMatchObject({
      job: 'archive-gps',
      archived: 1240,
    });
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second run with nothing left to move still succeeds', async () => {
    const archive = jest.fn().mockResolvedValue(0);
    await expect(setup(archive).archiveGps()).resolves.toMatchObject({ archived: 0 });
  });

  it('surfaces a failure instead of reporting a green run', async () => {
    const archive = jest.fn().mockRejectedValue(new Error('database unreachable'));
    await expect(setup(archive).archiveGps()).rejects.toThrow('database unreachable');
  });
});
