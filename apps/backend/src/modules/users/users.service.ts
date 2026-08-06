import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Login lookup happens BEFORE the tenant is known, so this is the one place
   * allowed to query users without a company scope. Email and phone are
   * globally unique.
   */
  findByIdentifier(identifier: string): Promise<User | null> {
    const where = identifier.includes('@') ? { email: identifier } : { phone: identifier };
    return this.prisma.user.findUnique({ where });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
