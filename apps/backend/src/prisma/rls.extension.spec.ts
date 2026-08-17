import type { PrismaClient } from '@prisma/client';
import { rlsExtension, TENANT_SETTING } from './rls.extension';

/**
 * The extension's whole job is that no model query ever reaches PostgreSQL
 * without the tenant declared first, and in the same transaction — otherwise
 * row-level security either blocks everything or (worse) the declaration lands
 * on a different pooled connection than the query.
 */
describe('rlsExtension', () => {
  function fakeClient() {
    const batches: unknown[][] = [];
    const executed: Array<{ strings: readonly string[]; values: unknown[] }> = [];
    const client = {
      $transaction: jest.fn((operations: unknown[]) => {
        batches.push(operations);
        return Promise.resolve(operations.map((_, index) => (index === 0 ? 1 : 'query-result')));
      }),
      $executeRaw: jest.fn((strings: readonly string[], ...values: unknown[]) => {
        executed.push({ strings, values });
        return { marker: 'set_config' };
      }),
    } as unknown as PrismaClient;
    return { client, batches, executed };
  }

  type ExtensionDefinition = {
    query: {
      $allModels: {
        $allOperations: (ctx: {
          args: unknown;
          query: (args: unknown) => unknown;
        }) => Promise<unknown>;
      };
    };
  };

  /**
   * Prisma.defineExtension returns an applier, so the definition is recovered
   * the same way the client does it: by applying it and capturing the argument.
   */
  function definitionOf(client: PrismaClient, companyId: string): ExtensionDefinition {
    let captured: ExtensionDefinition | undefined;
    const applier = rlsExtension(client, companyId) as unknown as (target: unknown) => unknown;
    applier({ $extends: (definition: ExtensionDefinition) => (captured = definition) });
    if (!captured) throw new Error('extension definition was not applied');
    return captured;
  }

  /** Runs the extension's hook the way Prisma would. */
  function runOperation(client: PrismaClient, companyId: string, query: jest.Mock) {
    return definitionOf(client, companyId).query.$allModels.$allOperations({
      args: { where: {} },
      query,
    });
  }

  it('declares the tenant and runs the query in one transaction', async () => {
    const { client, batches, executed } = fakeClient();
    const query = jest.fn().mockReturnValue('the-query');

    const result = await runOperation(client, 'company-a', query);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    // Declaration first, query second — the order is the point.
    expect(batches[0]![1]).toBe('the-query');
    expect(executed[0]?.values).toEqual([TENANT_SETTING, 'company-a']);
    // The caller gets the query's result, not the set_config result.
    expect(result).toBe('query-result');
  });

  it('makes the declaration transaction-local so it cannot leak to the next request', async () => {
    const { client, executed } = fakeClient();
    await runOperation(client, 'company-b', jest.fn().mockReturnValue('q'));

    // set_config(..., is_local = true) — a SQL literal, not a bound parameter.
    // is_local means the setting resets at COMMIT, so a pooled connection never
    // carries one tenant's context into another tenant's query.
    expect(executed[0]?.strings.join('?')).toContain(', true)');
    expect(executed[0]?.values).toEqual([TENANT_SETTING, 'company-b']);
  });

  it('passes the untouched arguments through to the underlying query', async () => {
    const { client } = fakeClient();
    const query = jest.fn().mockReturnValue('q');
    await runOperation(client, 'company-c', query);

    expect(query).toHaveBeenCalledWith({ where: {} });
  });
});
