import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'thin' | 'below';
  emphasis?: boolean;
  children?: ReactNode;
  className?: string;
}

const toneClass = {
  default: 'text-ink',
  good: 'text-green',
  thin: 'text-amber',
  below: 'text-floor',
};

/** A number first, its name second. The number is set in the display face so it reads as the headline. */
export function Stat({ label, value, hint, tone = 'default', emphasis, children, className }: StatProps) {
  return (
    <div className={cn('panel px-4 py-3.5 min-w-0 flex flex-col gap-1', className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div
        className={cn(
          'num font-display leading-none tracking-[-0.02em] truncate',
          emphasis ? 'text-[34px] sm:text-[38px]' : 'text-[26px] sm:text-[28px]',
          toneClass[tone],
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[12.5px] text-muted leading-snug">{hint}</div>}
      {children}
    </div>
  );
}
