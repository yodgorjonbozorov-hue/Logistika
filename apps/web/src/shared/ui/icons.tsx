import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

/**
 * One icon family for the whole app: 24×24 grid, 1.75 stroke, round caps.
 * Same visual weight everywhere — no emoji, no mixed libraries.
 */

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Icon({
  children,
  size = 20,
  className,
  strokeWidth = 1.75,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {children}
    </svg>
  );
}

export const IconMap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4.5 3.8 6.6a1 1 0 0 0-.6.9v11.1c0 .7.7 1.2 1.4.9L9 17.5m0-13v13m0-13 6 2.2m0 0 4.4-1.8c.7-.3 1.4.2 1.4.9v11.1a1 1 0 0 1-.6.9L15 19.5m0-13v13" />
  </Icon>
);

export const IconRoute = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="6" r="2.4" />
    <path d="M8.6 17.2c3.5-.7 4.2-2.4 4.2-4.6 0-2.4 1-4.3 3-4.9" />
  </Icon>
);

export const IconTruck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 16.4V7a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 14 7v9.4" />
    <path d="M14 9.6h3.1c.4 0 .8.2 1 .5l2.4 3c.2.3.3.6.3.9v2.4" />
    <path d="M3 16.4h1.7M9.4 16.4h4.4M19.2 16.4H21" />
    <circle cx="7" cy="17.6" r="1.9" />
    <circle cx="17" cy="17.6" r="1.9" />
  </Icon>
);

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="8" r="3.2" />
    <path d="M3.8 19.2c.5-3 3.2-4.8 6.2-4.8s5.7 1.8 6.2 4.8" />
    <path d="M16.2 5.2a3.2 3.2 0 0 1 0 6.1M17.6 14.8c1.7.6 2.9 2 3.2 4" />
  </Icon>
);

export const IconBriefcase = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7.5" width="18" height="12" rx="2.4" />
    <path d="M9 7.5V6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6v1.5M3 12.5h18" />
  </Icon>
);

export const IconWallet = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.2c0-1.3 1-2.3 2.3-2.3h11.4c1.3 0 2.3 1 2.3 2.3v.6" />
    <rect x="3" y="8.2" width="18" height="11.4" rx="2.4" />
    <path d="M16.2 13.9h1.6" />
  </Icon>
);

export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6.5 6.5 11 11m0-11-11 11" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.2 4.2" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3l-7.4-12.7a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.2M12 17.2h.01" />
  </Icon>
);

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 9 6.5 6.5L18.5 9" />
  </Icon>
);

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12h15m-5.5-5.5L19.5 12 14 17.5" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.8v2.1M12 19.1v2.1M4.5 4.5l1.5 1.5M18 18l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.5 19.5 6 18M18 6l1.5-1.5" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
  </Icon>
);

export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5Z" />
  </Icon>
);

export const IconLogout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
    <path d="M10 8.5 6.5 12 10 15.5M6.5 12H15" />
  </Icon>
);

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 13.5a3.6 3.6 0 0 0 5.2 0l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.3 1.3" />
    <path d="M13.5 10.5a3.6 3.6 0 0 0-5.2 0l-2.6 2.6a3.7 3.7 0 0 0 5.2 5.2l1.3-1.3" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5.5" width="17" height="15" rx="2.6" />
    <path d="M3.5 10.2h17M8.5 3.5v3.6M15.5 3.5v3.6" />
  </Icon>
);

export const IconSparkles = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7l-1.6-4.5L6 9.6 10.4 8 12 3.5Z" />
    <path d="M18.5 15.5 19.2 17.4 21 18.1l-1.8.7-.7 1.9-.7-1.9-1.8-.7 1.8-.7.7-1.9Z" />
  </Icon>
);

export const IconTrendUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 16.5 5-5 3.5 3.5L20 7.5" />
    <path d="M15 7.5h5v5" />
  </Icon>
);

export const IconTrendDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 7.5 5 5L12.5 9 20 16.5" />
    <path d="M15 16.5h5v-5" />
  </Icon>
);

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 13.5h4l1.4 2.4h6.2l1.4-2.4h4" />
    <path d="M6.4 4.8h11.2a2 2 0 0 1 1.8 1.2l2.1 6v5.6a2.4 2.4 0 0 1-2.4 2.4H4.9a2.4 2.4 0 0 1-2.4-2.4V12l2.1-6a2 2 0 0 1 1.8-1.2Z" />
  </Icon>
);
