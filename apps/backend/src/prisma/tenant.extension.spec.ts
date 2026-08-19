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

/**
 * C-4 — the tenant pointer in a WRITE PAYLOAD is attacker input.
 *
 * The scope used to be applied to `where` only, so an authenticated user of
 * company A could hand company B one of A's rows simply by putting
 * `companyId` in the body: the row was found (A's scope) and then updated to
 * B's id. Every write path is checked here.
 */
describe('applyTenantScope — tenant pointer injection (C-4)', () => {
  const HOSTILE = { companyId: 'company-b', company: { connect: { id: 'company-b' } } };

  it('refuses to move a row to another tenant via update data', () => {
    const result = applyTenantScope(
      'update',
      { where: { id: 'trip-1' }, data: { cargoName: 'x', ...HOSTILE } },
      COMPANY_A,
    );
    expect(result.where).toEqual({ id: 'trip-1', companyId: COMPANY_A });
    expect(result.data).toEqual({ cargoName: 'x' });
  });

  it.each(['updateMany', 'updateManyAndReturn'])('sanitises %s data', (operation) => {
    const result = applyTenantScope(
      operation,
      { where: { status: 'DRAFT' }, data: { status: 'CANCELLED', ...HOSTILE } },
      COMPANY_A,
    );
    expect(result.where).toEqual({ status: 'DRAFT', companyId: COMPANY_A });
    expect(result.data).toEqual({ status: 'CANCELLED' });
  });

  it('sanitises both branches of an upsert', () => {
    const result = applyTenantScope(
      'upsert',
      { where: { id: 'x' }, create: { name: 'n', ...HOSTILE }, update: { name: 'n', ...HOSTILE } },
      COMPANY_A,
    );
    expect(result.create).toEqual({ name: 'n', companyId: COMPANY_A });
    expect(result.update).toEqual({ name: 'n' });
  });

  it('ignores a nested company relation on create', () => {
    const result = applyTenantScope('create', { data: { name: 'X', ...HOSTILE } }, COMPANY_A);
    expect(result.data).toEqual({ name: 'X', companyId: COMPANY_A });
  });

  it('sanitises every row of createManyAndReturn', () => {
    const result = applyTenantScope(
      'createManyAndReturn',
      { data: [{ name: 'a', ...HOSTILE }, { name: 'b' }] },
      COMPANY_A,
    );
    expect(result.data).toEqual([
      { name: 'a', companyId: COMPANY_A },
      { name: 'b', companyId: COMPANY_A },
    ]);
  });
});

describe('TENANT_MODELS completeness', () => {
  it('covers every schema model that has a companyId column (except intentional exclusions)', () => {
    const intentionallyUnscoped = new Set(['Company', 'RefreshToken', 'AuditLog', 'TrackingLink']);
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
