import { useId } from 'react';

/** The NexusWatch hexagon-with-pulse mark, gradient from NexusInfra indigo to FinVault emerald. */
export function Logo({ size = 30 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--c-nx)' }} />
          <stop offset="1" style={{ stopColor: 'var(--c-fv)' }} />
        </linearGradient>
      </defs>
      <path d="M16 2.5 28 9.5v13L16 29.5 4 22.5v-13z" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M8.5 19l4.5-5 3.5 3.5 6.5-7.5" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
