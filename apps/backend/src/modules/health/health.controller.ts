import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { DependencyHealthIndicator } from './dependency.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dependencies: DependencyHealthIndicator,
  ) {}

  /** Liveness: is the process itself alive? Used by the container restart policy. */
  @Public()
  @Get()
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('live')
  liveAlias(): { status: string; uptimeSeconds: number } {
    return this.live();
  }

  /**
   * Readiness: can this instance serve traffic? A load balancer that sends
   * requests here while the database is down turns one outage into two.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.dependencies.checkDatabase(),
      () => this.dependencies.checkRedis(),
      () => this.dependencies.checkStorage(),
    ]);
  }
}
