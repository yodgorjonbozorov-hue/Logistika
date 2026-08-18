import { useMemo, useState } from 'react';
import { errorFor, fieldErrors } from './field-errors';
import type { Errors } from '../utils/validate';

/**
 * One place a form asks "what is wrong with this field?" (TASK-5.3).
 *
 * Two sources answer it. The local checks run before the request and catch the
 * obvious — an empty amount, a date in the future — where the user is still
 * looking at the field. The server's `details` catch everything else and are
 * the authority; a rule that only exists on the client is a rule that is not
 * enforced.
 *
 * Local wins when both speak, because the local message was produced by the
 * value currently on screen while the server's describes the value that was
 * sent.
 */
export function useFormErrors(serverError: unknown) {
  const [local, setLocal] = useState<Errors>({});
  const server = useMemo(() => fieldErrors(serverError), [serverError]);

  return {
    /** The message to show under `field`, if any. */
    of: (field: string): string | undefined => local[field] ?? errorFor(server, field),
    /** Server messages that belong to no field — shown at the form level. */
    general: server.general,
    /**
     * Records the local problems and says whether the form may be submitted.
     * Clearing on a clean pass matters: a field the user has just fixed must
     * stop being red before they press Save again.
     */
    check: (found: Errors): boolean => {
      setLocal(found);
      return Object.keys(found).length === 0;
    },
    clear: () => setLocal({}),
  };
}
