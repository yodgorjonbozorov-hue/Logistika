import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ANY_ROLE, Roles } from '../../common/decorators/roles.decorator';
import { ChatService } from './chat.service';
import { ListMessagesDto, PostMessageDto } from './dto/chat.dto';

/**
 * Trip chat (TZ §3.2 E-4). Open to every signed-in role — a driver is one side
 * of the conversation — and bounded by the trip: the service refuses a trip the
 * user is not on.
 */
@Controller('chat')
@Roles(...ANY_ROLE)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(':tripId/messages')
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query() filter: ListMessagesDto,
  ) {
    return this.chatService.list(user, tripId, filter.before ? new Date(filter.before) : undefined);
  }

  @Post(':tripId/messages')
  post(
    @CurrentUser() user: CurrentUserPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.chatService.post(user, tripId, dto);
  }

  @Get(':tripId/unread')
  unread(@CurrentUser() user: CurrentUserPayload, @Param('tripId', ParseUUIDPipe) tripId: string) {
    return this.chatService.unreadCount(user, tripId);
  }

  @Post(':tripId/read')
  markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ) {
    return this.chatService.markRead(user, tripId);
  }
}
