import { IntersectionType } from '@nestjs/mapped-types';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DateRangeDto } from '../../../common/dto/date-range.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListAuditLogsDto extends IntersectionType(PaginationDto, DateRangeDto) {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  action?: string;
}
