import { IntersectionType } from '@nestjs/mapped-types';
import { DateRangeDto } from '../../../common/dto/date-range.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListLedgerDto extends IntersectionType(PaginationDto, DateRangeDto) {}
