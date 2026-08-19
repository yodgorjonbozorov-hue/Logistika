import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../shared/utils/cn';

const STOPS = [
  {
    label: 'Ilova',
    path: '/trips',
    match: (p: string) => !p.startsWith('/login') && !p.startsWith('/track'),
  },
  { label: 'Kirish', path: '/login', match: (p: string) => p.startsWith('/login') },
  { label: 'Mijoz kuzatuvi', path: '/track/demo', match: (p: string) => p.startsWith('/track') },
];

/**
 * Preview-only switcher. The real app has no such control — it exists so a
 * viewer can reach the signed-out screens that authentication normally gates.
 */
export function DemoChrome() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="fixed bottom-24 right-4 z-[60] flex items-center gap-1 rounded-pill border border-line bg-surface/90 p-1 shadow-lg backdrop-blur-xl lg:bottom-5">
      <span className="px-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-tertiary">
        Demo
      </span>
      {STOPS.map((stop) => {
        const active = stop.match(pathname);
        return (
          <button
            key={stop.path}
            type="button"
            onClick={() => navigate(stop.path)}
            className={cn(
              'rounded-pill px-3 py-1.5 text-footnote font-medium transition-colors duration-[var(--duration-fast)] ease-ios',
              active ? 'bg-brand-primary text-white' : 'text-ink-secondary hover:bg-ink/[0.06]',
            )}
          >
            {stop.label}
          </button>
        );
      })}
    </div>
  );
}
