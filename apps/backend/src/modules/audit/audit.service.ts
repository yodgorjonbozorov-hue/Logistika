import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget: an audit failure must never break the user flow, but is always logged. */
  log(entry: AuditEntry): void {
    void this.prisma.auditLog
      .create({
        data: {
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: entry.before,
          after: entry.after,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit write failed for ${entry.action} ${entry.entityType}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
