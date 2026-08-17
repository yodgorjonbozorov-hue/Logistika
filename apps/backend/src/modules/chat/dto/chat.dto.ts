import { ChatMessageKind } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PostMessageDto {
  @IsOptional()
  @IsEnum(ChatMessageKind)
  kind?: ChatMessageKind;

  /** Required for a TEXT message; ignored for an attachment. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  /** Uploaded photo or voice note; the service checks it belongs here. */
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class ListMessagesDto {
  /** Cursor for paging back through an older conversation. */
  @IsOptional()
  @IsDateString()
  before?: string;
}
