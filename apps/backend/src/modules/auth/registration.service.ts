import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { type AuthTokens, TARIFF_TRIAL, TRIAL_DAYS } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The end of a fresh trial, counted from `from`. */
export function trialEndsAt(from: Date): Date {
  return new Date(from.getTime() + TRIAL_DAYS * DAY_MS);
}

/**
 * Self-service sign-up. A visitor becomes a tenant with one request: a Company
 * on a {@link TRIAL_DAYS}-day trial plus its first OWNER user, created in a
 * single transaction so a half-registered tenant can never exist. Login is
 * e-mail (or phone) plus password — no SMS provider is involved.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() || undefined;

    // Checked up front for a precise error; the unique indexes below are what
    // actually make it safe against two sign-ups racing for the same address.
    await this.assertIdentifiersFree(email, phone);

    const passwordHash = await argon2.hash(dto.password);
    const now = new Date();

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: dto.companyName.trim(),
            phone,
            tariffPlan: TARIFF_TRIAL,
            subscriptionUntil: trialEndsAt(now),
          },
        });
        const user = await tx.user.create({
          data: {
            companyId: company.id,
            fullName: dto.fullName.trim(),
            email,
            phone,
            passwordHash,
            role: 'OWNER',
          },
        });
        return { company, user };
      });
    } catch (error) {
      // The unique index fired between the check above and the insert.
      this.rethrowDuplicate(error, phone);
    }

    this.audit.log({
      companyId: created.company.id,
      userId: created.user.id,
      action: 'CREATE',
      entityType: 'Company',
      entityId: created.company.id,
      after: {
        name: created.company.name,
        tariffPlan: created.company.tariffPlan,
        source: 'self-registration',
      },
    });

    return this.authService.issueTokens(created.user);
  }

  private async assertIdentifiersFree(email: string, phone?: string): Promise<void> {
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new AppException('AUTH_EMAIL_TAKEN', HttpStatus.CONFLICT);
    }
    if (phone && (await this.prisma.user.findUnique({ where: { phone } }))) {
      throw new AppException('AUTH_PHONE_TAKEN', HttpStatus.CONFLICT);
    }
  }

  private rethrowDuplicate(error: unknown, phone?: string): never {
    const prismaError = error as { code?: string; meta?: { target?: string[] | string } } | null;
    if (prismaError?.code !== 'P2002') throw error;

    const target = prismaError.meta?.target;
    const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
    const onPhone = fields.includes('phone') && Boolean(phone);
    throw new AppException(onPhone ? 'AUTH_PHONE_TAKEN' : 'AUTH_EMAIL_TAKEN', HttpStatus.CONFLICT);
  }
}
