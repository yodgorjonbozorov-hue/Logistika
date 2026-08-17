import { Prisma } from '@prisma/client';
import { applyTenantScope, TENANT_MODELS } from './tenant.extension';

const COMPANY_A = 'company-a';

describe('applyTenantScope', () => {
  it.each(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'])(
    'adds companyId to where for %s',
    (operation) => {
      const result = applyTenantScope(operation, { where: { isActive: true } }, COMPANY_A);
      expect(result.where).toEqual({ isActive: true, companyId: COMPANY_A });
    },
  );

  it('adds companyId to unique lookups so cross-tenant ids return nothing', () => {
    const result = applyTenantScope(
      'findUnique',
      { where: { id: 'vehicle-of-company-b' } },
      COMPANY_A,
    );
    expect(result.where).toEqual({ id: 'vehicle-of-company-b', companyId: COMPANY_A });
  });

  it('scopes update and delete by companyId', () => {
    expect(
      applyTenantScope('update', { where: { id: 'x' }, data: { name: 'y' } }, COMPANY_A).where,
    ).toEqual({
      id: 'x',
      companyId: COMPANY_A,
    });
    expect(applyTenantScope('deleteMany', undefined, COMPANY_A).where).toEqual({
      companyId: COMPANY_A,
    });
  });

  it('stamps companyId into create data, overriding any client-sent value', () => {
    const result = applyTenantScope(
      'create',
      { data: { name: 'X', companyId: 'company-b' } },
      COMPANY_A,
    );
    expect((result.data as { companyId: string }).companyId).toBe(COMPANY_A);
  });

  it('stamps companyId into every createMany row', () => {
    const result = applyTenantScope(
      'createMany',
      { data: [{ name: 'a' }, { name: 'b', companyId: 'company-b' }] },
      COMPANY_A,
    );
    expect(result.data).toEqual([
      { name: 'a', companyId: COMPANY_A },
      { name: 'b', companyId: COMPANY_A },
    ]);
  });

  it('scopes both where and create in upsert', () => {
    const result = applyTenantScope(
      'upsert',
      { where: { id: 'x' }, create: { name: 'n' }, update: { name: 'n' } },
      COMPANY_A,
    );
    expect(result.where).toEqual({ id: 'x', companyId: COMPANY_A });
    expect(result.create).toEqual({ name: 'n', companyId: COMPANY_A });
  });
});

describe('TENANT_MODELS completeness', () => {
  it('covers every schema model that has a companyId column (except intentional exclusions)', () => {
    /**
     * Models that carry companyId but are deliberately outside the extension:
     * they are read before a tenant context exists (RefreshToken), are
     * platform-wide by design (Company, AuditLog), are looked up by a bare
     * public token (TrackingLink), or are infrastructure the interceptor keys
     * explicitly by company (IdempotencyKey).
     */
    const intentionallyUnscoped = new Set([
      'Company',
      'RefreshToken',
      'AuditLog',
      'TrackingLink',
      'IdempotencyKey',
    ]);
    const modelsWithCompanyId = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'companyId'))
      .map((model) => model.name)
      .filter((name) => !intentionallyUnscoped.has(name));

    expect(modelsWithCompanyId.length).toBeGreaterThan(0);
    for (const modelName of modelsWithCompanyId) {
      expect(TENANT_MODELS.has(modelName)).toBe(true);
    }
  });
});
