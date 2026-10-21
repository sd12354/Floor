import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** An empty screen is an invitation to act: say what is missing and offer the next step. */
export function EmptyState({ title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-start text-left', compact ? 'py-6 px-4' : 'py-14 px-6 max-w-md', className)}>
      <div className="floor-rule w-10 mb-4" aria-hidden />
      <h3 className="text-[17px] text-ink">{title}</h3>
      {description && <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">{description}</p>}
      {action && <div className="mt-4 flex gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="py-10 px-6 max-w-md">
      <h3 className="text-[17px] text-floor">Could not load this</h3>
      <p className="text-[13.5px] text-muted mt-1.5 break-words">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-[13.5px] text-accent underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}
