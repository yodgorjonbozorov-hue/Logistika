import { IsString, Matches } from 'class-validator';

export class LinkTelegramDto {
  /** Telegram chat id — digits, negative for groups. */
  @IsString()
  @Matches(/^-?\d{1,20}$/)
  chatId!: string;
}
