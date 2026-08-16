import { AiInsightStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class ReadDocumentDto {
  /** Stored file to read; the tenant-scoped lookup proves it belongs here. */
  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  /** Position the phone reported when the photo was taken (TZ §8.3 GPS check). */
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class ConfirmAiRequestDto {
  /**
   * What the user changed before accepting, if anything. Stored as-is for the
   * monthly accuracy report (TZ §8.12) — it is never applied to any table here.
   */
  @IsOptional()
  @IsObject()
  correctedData?: Record<string, unknown>;
}

export class ListInsightsDto {
  /** Omitted means the open ones (NEW + REVIEWED). */
  @IsOptional()
  @IsEnum(AiInsightStatus)
  status?: AiInsightStatus;
}

export class SetInsightStatusDto {
  @IsEnum(AiInsightStatus)
  status!: AiInsightStatus;
}

export class AskDto {
  /** The owner's question, in their own words. */
  @IsString()
  @Length(3, 500)
  question!: string;
}

export class ReadVoiceNoteDto {
  /** Uploaded audio note; the tenant-scoped lookup proves it belongs here. */
  @IsUUID()
  fileId!: string;

  /** Recogniser hint, e.g. "uz" or "ru"; omitted means let it detect. */
  @IsOptional()
  @IsIn(['uz', 'ru'])
  language?: string;
}
