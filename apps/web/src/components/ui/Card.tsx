import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
}

export function Card({ title, action, padded = true, className, children, ...rest }: CardProps) {
  return (
    <section className={cn('panel flex flex-col min-w-0', className)} {...rest}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          {title && <h2 className="text-[15px] text-ink">{title}</h2>}
          {action && <div className="flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('min-w-0', padded && (title || action ? 'px-4 pb-4' : 'p-4'))}>{children}</div>
    </section>
  );
}
