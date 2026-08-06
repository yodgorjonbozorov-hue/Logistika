import { Module } from '@nestjs/common';
import { PublicLinkController } from './public-link.controller';
import { PublicLinkService } from './public-link.service';

@Module({
  controllers: [PublicLinkController],
  providers: [PublicLinkService],
})
export class PublicLinkModule {}
