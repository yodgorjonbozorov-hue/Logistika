import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

/**
 * Global so the companies module can invalidate the cache the moment a
 * SUPERADMIN switches a company off, without importing a chain of modules.
 */
@Global()
@Module({
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
