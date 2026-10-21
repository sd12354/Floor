import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'thin' | 'below' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent/12 text-accent',
  good: 'bg-green/12 text-green',
  thin: 'bg-amber/14 text-amber',
  below: 'bg-floor/12 text-floor',
  outline: 'border border-rule text-muted',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded px-1.5 py-[2px] text-[12px] font-medium leading-4 whitespace-nowrap', tones[tone], className)}
    >
      {children}
    </span>
  );
}

/** Small filled dot + label, for status columns where a full badge is too loud. */
export function Dot({ tone, label }: { tone: BadgeTone; label: string }) {
  const color: Record<BadgeTone, string> = {
    neutral: 'bg-faint',
    accent: 'bg-accent',
    good: 'bg-green',
    thin: 'bg-amber',
    below: 'bg-floor',
    outline: 'bg-faint',
  };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn('h-2 w-2 rounded-full shrink-0', color[tone])} aria-hidden />
      {label}
    </span>
  );
}
