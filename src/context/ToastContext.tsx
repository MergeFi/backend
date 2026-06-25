'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Toast, ToastVariant } from '@/types';
import { TOAST_DEFAULT_DURATION_MS } from '@/lib/constants';

interface ToastContextValue {
  toasts:  Toast[];
  show:    (message: string, variant?: ToastVariant, duration?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev: Toast[]) => prev.filter((t: Toast) => t.id !== id));
  }, []);

  const show = useCallback((
    message: string,
    variant: ToastVariant = 'info',
    duration = TOAST_DEFAULT_DURATION_MS,
  ) => {
    const id = crypto.randomUUID();
    setToasts((prev: Toast[]) => [...prev, { id, message, variant, duration }]);
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    }
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toasts, show, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
