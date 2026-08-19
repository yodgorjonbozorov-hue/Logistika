import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CronGuard } from '../../common/guards/cron.guard';
import { TrackingService } from '../tracking/tracking.service';

/**
 * Scheduled work, exposed as HTTP.
 *
 * A serverless deployment has no process to hold `@nestjs/schedule` timers, so
 * the platform scheduler (Vercel Cron) calls these endpoints instead. On a
 * self-hosted deployment the in-process `@Cron` decorators still run and these
 * endpoints simply go unused — the job itself is idempotent either way.
 *
 * `@Public()` only bypasses the JWT guard; `CronGuard` then requires the shared
 * cron secret.
 */
@Controller('cron')
@Public()
@UseGuards(CronGuard)
export class CronController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('archive-gps')
  async archiveGps(): Promise<{ job: string; ranAt: string }> {
    await this.tracking.archiveOldTracks();
    return { job: 'archive-gps', ranAt: new Date().toISOString() };
  }
}
