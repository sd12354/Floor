import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastApi, type ToastInput, type ToastTone } from './toastContext';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ToastItem extends ToastInput { id: number }

const icons: Record<ToastTone, typeof Info> = { success: CheckCircle2, error: AlertTriangle, info: Info };
const iconTone: Record<ToastTone, string> = { success: 'text-green', error: 'text-floor', info: 'text-accent' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++counter.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ms = t.durationMs ?? (t.tone === 'error' ? 8000 : 5000);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed z-50 bottom-[calc(env(safe-area-inset-bottom)+68px)] md:bottom-4 right-3 left-3 md:left-auto md:w-[360px] flex flex-col gap-2 pointer-events-none"
      >
        {items.map((t) => {
          const Icon = icons[t.tone ?? 'info'];
          return (
            <div
              key={t.id}
              role="status"
              className="toast-in pointer-events-auto panel shadow-lg px-3.5 py-3 flex gap-3 items-start"
            >
              <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', iconTone[t.tone ?? 'info'])} aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium">{t.title}</div>
                {t.description && <div className="text-[13px] text-muted mt-0.5 break-words">{t.description}</div>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="text-faint hover:text-ink rounded p-0.5 -m-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
