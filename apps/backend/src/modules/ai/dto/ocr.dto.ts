import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsObject, IsOptional, IsUUID } from 'class-validator';

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
