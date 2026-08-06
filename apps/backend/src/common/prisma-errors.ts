import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from './exceptions/app.exception';

/**
 * Maps known Prisma errors (unique violation, FK violation, not found) to
 * AppException codes; anything else is rethrown for the global filter.
 */
export function rethrowPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new AppException('ALREADY_EXISTS', HttpStatus.CONFLICT, undefined, {
        fields: (error.meta?.target as string[] | undefined) ?? [],
      });
    }
    if (error.code === 'P2003') {
      throw new AppException('RESOURCE_IN_USE', HttpStatus.CONFLICT);
    }
    if (error.code === 'P2025') {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
  }
  throw error;
}
