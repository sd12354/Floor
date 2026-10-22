import { useId } from 'react';

/**
 * The Floor mark: two lines of "listings" resting on the red floor rule. Same drawing as favicon.svg,
 * with an optional slow shimmer that sweeps along the rule.
 */
export function LogoMark({ size = 40, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Floor"
      className={className}
    >
      <defs>
        {/* userSpaceOnUse: the rule has zero height, so a bounding-box gradient would not render. */}
        <linearGradient id={`${id}-sweep`} gradientUnits="userSpaceOnUse" x1="-14" x2="6" y1="23" y2="23">
          <stop offset="0" stopColor="#E0574A" />
          <stop offset="0.5" stopColor="#FFC2B8" />
          <stop offset="1" stopColor="#E0574A" />
          {animated && <animate attributeName="x1" values="-14;26" dur="3.2s" repeatCount="indefinite" />}
          {animated && <animate attributeName="x2" values="6;46" dur="3.2s" repeatCount="indefinite" />}
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill="#1B2430" />
      <path d="M8 9h16M8 15h10" stroke="#8AA2FF" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M6 23h20" stroke={animated ? `url(#${id}-sweep)` : '#E0574A'} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
