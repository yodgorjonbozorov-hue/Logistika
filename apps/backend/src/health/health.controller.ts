import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, type ReadinessReport } from './health.service';

/**
 * Liveness and readiness are DIFFERENT questions and must not share an answer
 * (H-15). The old single `{ status: 'ok' }` was a lie: it stayed green with the
 * database on fire, so an orchestrator kept routing traffic to a broken pod and
 * never restarted anything.
 *
 * Deliberately NOT rate limited. Probes arrive from the orchestrator on a fixed
 * interval and all share one source address; a 429 would read as "unhealthy"
 * and restart perfectly good pods. These paths are meant to be blocked at the
 * edge instead (see deploy/nginx.conf), not throttled in the application.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: is this process running at all? Never touches a dependency —
   *  a slow database must not trigger a restart loop. */
  @Public()
  @Get('live')
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: can this process actually serve requests right now? */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    res.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }

  /** Kept for existing probes/uptime monitors; mirrors readiness. */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    return this.ready(res);
  }
}
