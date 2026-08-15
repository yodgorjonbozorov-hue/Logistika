import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DocumentOwnerType } from 'shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateDocumentDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @IsUUID()
  ownerId!: string;

  /** Free-form kind: TTN, CMR, INVOICE, INSURANCE… (rendered via i18n on the client). */
  @IsString()
  @MaxLength(40)
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

  /** StoredFile key or id produced by /files/upload. */
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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  docType?: string;
}
