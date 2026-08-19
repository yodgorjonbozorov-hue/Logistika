import { cn } from '../utils/cn';
import { BRAND } from './palette';

/**
 * The Logixa mark — a route drawn as an "L": origin node, the run, and the
 * destination node carrying the Electric Blue signal. Geometry is taken
 * verbatim from the brand board (64×64 grid) and must not be redrawn.
 */

type Tone = 'auto' | 'light' | 'dark' | 'mono';

/** The mark stays legible down to 16px by thickening the run as it shrinks. */
function strokeFor(size: number): number {
  if (size <= 18) return 10;
  if (size <= 26) return 9;
  if (size <= 40) return 8;
  return 7;
}

function nodeRadii(size: number): { origin: number; destination: number } {
  if (size <= 18) return { origin: 5.5, destination: 7.5 };
  if (size <= 26) return { origin: 5, destination: 7 };
  if (size <= 40) return { origin: 4.5, destination: 6 };
  return { origin: 4, destination: 5.5 };
}

const STRUCTURE: Record<Tone, string> = {
  auto: 'currentColor',
  light: '#FFFFFF',
  dark: '#0D1220',
  mono: 'currentColor',
};

export function LogixaMark({
  size = 28,
  tone = 'auto',
  className,
  title,
}: {
  size?: number;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  const stroke = strokeFor(size);
  const { origin, destination } = nodeRadii(size);
  const structure = STRUCTURE[tone];
  // Monochrome drops the signal colour so the mark holds in one ink.
  // Electric Blue is constant across grounds — it is the signal, not a theme.
  const signal = tone === 'mono' ? structure : BRAND.primary;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M14 22v26M14 48h28" stroke={structure} strokeWidth={stroke} strokeLinecap="round" />
      <circle cx="14" cy="14" r={origin} fill={structure} />
      <circle cx="52" cy="48" r={destination} fill={signal} />
    </svg>
  );
}

/** "Logixa" is the mass; "AI" is distinguished by Electric Blue alone. */
function Wordmark({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span className={cn('font-semibold tracking-[-0.02em] whitespace-nowrap', className)}>
      Logixa
      <span className={tone === 'mono' ? '' : 'text-brand-primary dark:text-brand-accent'}>
        {' '}
        AI
      </span>
    </span>
  );
}

const WORDMARK_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[15px]',
  md: 'text-[19px]',
  lg: 'text-title2',
};

export function LogixaLogo({
  variant = 'horizontal',
  size = 'md',
  tone = 'auto',
  className,
}: {
  variant?: 'horizontal' | 'mark' | 'wordmark' | 'stacked';
  size?: 'sm' | 'md' | 'lg';
  tone?: Tone;
  className?: string;
}) {
  const markSize = { sm: 20, md: 26, lg: 36 }[size];

  if (variant === 'mark') {
    return <LogixaMark size={markSize} tone={tone} className={className} title="Logixa AI" />;
  }

  if (variant === 'wordmark') {
    return <Wordmark tone={tone} className={cn(WORDMARK_SIZE[size], className)} />;
  }

  if (variant === 'stacked') {
    return (
      <span className={cn('inline-flex flex-col items-center gap-3 text-center', className)}>
        <LogixaMark size={markSize * 1.8} tone={tone} title="Logixa AI" />
        <Wordmark tone={tone} className={WORDMARK_SIZE[size]} />
        <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-tertiary">
          AI-powered logistics
        </span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogixaMark size={markSize} tone={tone} title="Logixa AI" />
      <Wordmark tone={tone} className={WORDMARK_SIZE[size]} />
    </span>
  );
}
