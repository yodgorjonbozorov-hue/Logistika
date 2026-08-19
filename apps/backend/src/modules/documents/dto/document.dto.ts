import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentOwnerType } from 'shared';

export class CreateDocumentDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  /**
   * The record this paper belongs to: a vehicle, a driver, a trip — or, for
   * COMPANY, the company itself, which the service fills in from the token.
   */
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsString()
  @IsNotEmpty()
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

  /** The id returned by `POST /files/upload`; the service resolves it to a key. */
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {}

export class DocumentFilterDto {
  @IsOptional()
  @IsEnum(DocumentOwnerType)
  ownerType?: DocumentOwnerType;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  /** Only papers expiring within this many days — the reminder view. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiringInDays?: number;
}
