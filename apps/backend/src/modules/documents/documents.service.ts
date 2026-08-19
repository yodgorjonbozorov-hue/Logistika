import { HttpStatus, Injectable } from '@nestjs/common';
import type { Document, Prisma } from '@prisma/client';
import { DocumentOwnerType, type CurrentUserPayload } from 'shared';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDocumentDto, DocumentFilterDto, UpdateDocumentDto } from './dto/document.dto';

/**
 * The document archive: insurance, tech inspections, licences, waybills — the
 * paper a logistics company is asked for at a checkpoint.
 *
 * The file itself lives in object storage (`files` module); a Document is the
 * record about it — what kind of paper it is, whose it is, and when it runs
 * out. `fileUrl` holds the StoredFile id, not a URL, so the link handed to a
 * browser is always freshly signed and short-lived.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    pagination: PaginationDto,
    filter: DocumentFilterDto,
  ): Promise<{ data: Document[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.DocumentWhereInput = {};
    if (filter.ownerType) where.ownerType = filter.ownerType;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    if (filter.expiringInDays !== undefined) {
      const until = new Date();
      until.setDate(until.getDate() + filter.expiringInDays);
      where.expiryDate = { not: null, lte: until };
    }

    const [data, total] = await Promise.all([
      db.document.findMany({
        where,
        // Papers with a deadline first, soonest at the top: that is the order a
        // manager needs them in. Undated ones sort by when they were filed.
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.document.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateDocumentDto): Promise<Document> {
    const ownerId = await this.resolveOwner(actor, dto.ownerType, dto.ownerId);
    if (dto.fileId) await this.assertFileExists(actor, dto.fileId);

    try {
      const document = await this.prisma.forCompany(actor.companyId).document.create({
        data: {
          companyId: actor.companyId as string,
          ownerType: dto.ownerType,
          ownerId,
          docType: dto.docType,
          docNumber: dto.docNumber,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          fileUrl: dto.fileId ?? null,
        },
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Document',
        entityId: document.id,
        after: { docType: document.docType, ownerType: document.ownerType },
      });
      return document;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateDocumentDto): Promise<Document> {
    await this.getById(actor, id);
    if (dto.fileId) await this.assertFileExists(actor, dto.fileId);

    try {
      return await this.prisma.forCompany(actor.companyId).document.update({
        where: { id },
        data: {
          ownerType: dto.ownerType,
          ownerId: dto.ownerId,
          docType: dto.docType,
          docNumber: dto.docNumber,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          fileUrl: dto.fileId,
        },
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Document> {
    const document = await this.prisma
      .forCompany(actor.companyId)
      .document.findUnique({ where: { id } });
    if (!document) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return document;
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    await this.getById(actor, id);
    await this.prisma.forCompany(actor.companyId).document.delete({ where: { id } });
    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'Document',
      entityId: id,
    });
    return { deleted: true };
  }

  /**
   * A COMPANY document has no separate owner row — it belongs to the tenant, so
   * the id comes from the token and can never be pointed at another company.
   * Every other kind must name a record this tenant owns.
   */
  private async resolveOwner(
    actor: CurrentUserPayload,
    ownerType: DocumentOwnerType,
    ownerId: string | undefined,
  ): Promise<string> {
    if (ownerType === DocumentOwnerType.COMPANY) return actor.companyId as string;
    if (!ownerId) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'ownerId is required for this ownerType',
      ]);
    }

    const db = this.prisma.forCompany(actor.companyId);
    const exists =
      ownerType === DocumentOwnerType.VEHICLE
        ? await db.vehicle.findUnique({ where: { id: ownerId }, select: { id: true } })
        : ownerType === DocumentOwnerType.DRIVER
          ? await db.driver.findUnique({ where: { id: ownerId }, select: { id: true } })
          : await db.trip.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!exists) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return ownerId;
  }

  /** The upload has to belong to this tenant, or the record would point at another's file. */
  private async assertFileExists(actor: CurrentUserPayload, fileId: string): Promise<void> {
    const file = await this.prisma
      .forCompany(actor.companyId)
      .storedFile.findUnique({ where: { id: fileId }, select: { id: true } });
    if (!file) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}
