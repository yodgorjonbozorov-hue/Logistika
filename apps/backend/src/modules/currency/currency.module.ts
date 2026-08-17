import { Global, Module } from '@nestjs/common';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';

/**
 * Global: every money write converts, and threading this import through each
 * module that touches an amount adds noise without adding safety.
 */
@Global()
@Module({
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
