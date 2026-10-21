import { createContext, useContext, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  title: string;
  description?: ReactNode;
  tone?: ToastTone;
  durationMs?: number;
}

export interface ToastApi {
  toast: (t: ToastInput) => void;
  success: (title: string, description?: ReactNode) => void;
  error: (title: string, description?: ReactNode) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
