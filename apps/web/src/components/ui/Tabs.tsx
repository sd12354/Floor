import { cn } from '@/lib/cn';

export interface TabItem<K extends string> { key: K; label: string; count?: number }

export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto min-w-0 max-w-full border-b border-rule [scrollbar-width:none]">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              'relative px-2.5 py-2 text-[13.5px] whitespace-nowrap -mb-px border-b-2 transition-colors',
              active ? 'border-floor text-ink font-medium' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cn('num ml-1.5 text-[12px]', active ? 'text-muted' : 'text-faint')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
