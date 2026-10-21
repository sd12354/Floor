import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md';
}

/** Side sheet on desktop, bottom sheet on phones. Traps focus loosely and closes on Escape. */
export function Drawer({ open, onClose, title, children, footer, width = 'md' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = panelRef.current?.querySelector<HTMLElement>('input, button, textarea, select, [tabindex]');
    first?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40 cursor-default" tabIndex={-1} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          'relative bg-surface border-rule shadow-xl flex flex-col w-full max-h-[92vh] sm:max-h-none sm:h-full',
          'rounded-t-lg sm:rounded-none border-t sm:border-t-0 sm:border-l',
          width === 'sm' ? 'sm:w-[400px]' : 'sm:w-[480px]',
        )}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-rule">
          <h2 id="drawer-title" className="text-[17px]">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule">{footer}</footer>}
      </div>
    </div>
  );
}
