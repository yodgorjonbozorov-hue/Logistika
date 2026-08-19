import { Global, Module } from '@nestjs/common';
import { SessionStateService } from './session-state.service';

/**
 * Global because two very different layers need it: the auth guard checks it on
 * every request, and the user service invalidates it the moment an account is
 * deactivated or its password changes.
 */
@Global()
@Module({
  providers: [SessionStateService],
  exports: [SessionStateService],
})
export class SessionStateModule {}
