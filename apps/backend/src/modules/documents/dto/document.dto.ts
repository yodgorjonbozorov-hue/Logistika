import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentOwnerType } from 'shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateDocumentDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @IsUUID()
  ownerId!: string;

  @IsString()
  @MaxLength(60)
  docType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  docNumber?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;
}

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {}

export class ListDocumentsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(DocumentOwnerType)
  ownerType?: DocumentOwnerType;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class ExpiringDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 15;
}
