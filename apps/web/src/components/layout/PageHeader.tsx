import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-4 md:mb-5">
      <div className="min-w-0 flex items-center gap-3.5">
        {icon}
        <div className="min-w-0">
        <h1 className="text-[24px] md:text-[28px] leading-tight">{title}</h1>
        {description && <p className="text-[13.5px] text-muted mt-1 max-w-[60ch]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
