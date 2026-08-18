import { Global, Module } from '@nestjs/common';
import { TokenVersionService } from './token-version.service';

/** Global: the auth guard, the users module and the auth module all bump it. */
@Global()
@Module({
  providers: [TokenVersionService],
  exports: [TokenVersionService],
})
export class TokenVersionModule {}
