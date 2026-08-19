import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ThrottlePublic } from '../../common/throttle/throttle';
import { PublicLinkService } from './public-link.service';

@Controller()
export class PublicLinkController {
  constructor(private readonly publicLinkService: PublicLinkService) {}

  @Post('trips/:id/share-link')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @HttpCode(HttpStatus.OK)
  createLink(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.publicLinkService.createLink(user, id);
  }

  @Public()
  @ThrottlePublic()
  @Get('public/track/:token')
  publicView(@Param('token') token: string) {
    return this.publicLinkService.publicView(token);
  }
}
