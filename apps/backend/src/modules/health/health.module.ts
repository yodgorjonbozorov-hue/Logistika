import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DependencyHealthIndicator } from './dependency.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DependencyHealthIndicator],
})
export class HealthModule {}
