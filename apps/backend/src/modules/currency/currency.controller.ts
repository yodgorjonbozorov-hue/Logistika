import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UserRole } from 'shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrencyService } from './currency.service';
import { ListExchangeRatesDto, UpsertExchangeRateDto } from './dto/exchange-rate.dto';

/**
 * Rates are platform data, not tenant data: every company converts at the same
 * published rate, so only SUPERADMIN maintains them.
 */
@Controller('admin/exchange-rates')
@Roles(UserRole.SUPERADMIN)
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get()
  list(@Query() filter: ListExchangeRatesDto) {
    return this.currency.listRates(filter.currency);
  }

  @Post()
  upsert(@Body() dto: UpsertExchangeRateDto) {
    return this.currency.upsertRate(dto.currency, dto.date, dto.rateToUzs, dto.source);
  }
}
