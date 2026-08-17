import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { auditDiff, auditSnapshot } from './audit.snapshot';

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

  /**
   * Records one change made by a signed-in user (TZ §9: every change is logged).
   *
   * The row is snapshotted through `auditSnapshot`, which makes BigInt money and
   * dates JSON-safe and drops secrets — so a service can hand over the entity it
   * just wrote without thinking about either.
   */
  record(
    actor: CurrentUserPayload,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE',
    entityType: string,
    entity: { id: string } & Record<string, unknown>,
    before?: unknown,
  ): void {
    this.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action,
      entityType,
      entityId: entity.id,
      before: before === undefined ? undefined : auditSnapshot(before),
      // On an update, only the fields that moved; otherwise the whole row.
      after: before === undefined ? auditSnapshot(entity) : auditDiff(before, entity),
    });
  }
}
