import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IntersectionType } from '@nestjs/mapped-types';
import { TripEventType } from 'shared';
import { DateRangeDto } from '../../../common/dto/date-range.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { DEVICE_EVENT_WINDOW, IsWithinDateWindow } from '../../../common/dto/date-bounds';

export class DriverEventDto {
  /** Client-generated UUID — the idempotency key for offline retries. */
  @IsUUID()
  clientEventId!: string;

  @IsUUID()
  tripId!: string;

  @IsEnum(TripEventType)
  eventType!: TripEventType;

  /**
   * Stamped by the phone, whose clock the server does not control (M-5). An
   * event dated 1970 or 2049 reorders the trip's history and lands in the
   * wrong reporting month without looking like an error anywhere.
   */
  @IsDateString()
  @IsWithinDateWindow(DEVICE_EVENT_WINDOW)
  eventTime!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  /** StoredFile ids uploaded via /files/upload before the batch sync. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMaxSize(10)
  photoFileIds?: string[];
}

/**
 * Listing events REQUIRES a trip. Without it the old handler passed
 * `where: { tripId: undefined }`, which Prisma drops — returning every event of
 * the whole company, unpaginated, to any role including DRIVER.
 */
export class ListEventsDto extends IntersectionType(PaginationDto, DateRangeDto) {
  @IsUUID()
  tripId!: string;
}

export class EventBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DriverEventDto)
  events!: DriverEventDto[];
}
