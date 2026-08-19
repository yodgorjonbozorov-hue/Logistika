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
import { TripEventType } from 'shared';

export class DriverEventDto {
  /** Client-generated UUID — the idempotency key for offline retries. */
  @IsUUID()
  clientEventId!: string;

  @IsUUID()
  tripId!: string;

  @IsEnum(TripEventType)
  eventType!: TripEventType;

  @IsDateString()
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

/** GET /events — tripId is REQUIRED so the endpoint can never dump a whole company (H-1). */
export class ListEventsDto {
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
