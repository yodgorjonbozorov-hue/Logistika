import { Children, cloneElement, createContext, isValidElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../utils/cn';

/**
 * SaaS data table with an adaptive body: rows below `md` collapse into stacked
 * cards labelled from the header row (`.lx-table` rules in index.css), so a
 * phone never gets a squeezed six-column grid.
 */
const HeadersContext = createContext<string[]>([]);

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <HeadersContext.Provider value={headers}>
      <div className="overflow-x-auto rounded-lg border-line md:border md:bg-surface md:shadow-sm">
        <table className="lx-table w-full border-collapse text-subhead md:min-w-[680px]">
          <thead>
            <tr className="border-b border-line text-left">
              {headers.map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-tertiary"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </HeadersContext.Provider>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const headers = useContext(HeadersContext);
  // Each cell carries its column name so the mobile card view can label it.
  const labelled = Children.map(children, (child, index) =>
    isValidElement<{ label?: string }>(child)
      ? cloneElement(child as ReactElement<{ label?: string }>, { label: headers[index] ?? '' })
      : child,
  );

  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'link' : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'border-b border-line-divider last:border-0',
        'transition-colors duration-[var(--duration-fast)] ease-ios',
        onClick && 'cursor-pointer hover:bg-brand-primary/[0.05]',
      )}
    >
      {labelled}
    </tr>
  );
}

export function Cell({
  children,
  className,
  label,
  numeric = false,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  /** Money, distance and counts — monospaced so columns never jitter. */
  numeric?: boolean;
}) {
  return (
    <td
      data-label={label ?? ''}
      className={cn('px-4 py-3 align-middle', numeric && 'font-mono tabular-nums', className)}
    >
      {children}
    </td>
  );
}
