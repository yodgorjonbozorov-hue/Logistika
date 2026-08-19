import { Module } from '@nestjs/common';
import { ThrottleModule } from '../common/throttle/throttle.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [ThrottleModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
