import { PartialType } from '@nestjs/mapped-types';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(190)
  contactPerson?: string;

  @IsOptional()
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsDays?: number;
}

export class UpdateClientDto extends PartialType(CreateClientDto) {}
