import { createContext, useContext, useCallback, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);
let idCounter = 0;

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const COLORS = { success: 'text-running border-running/30 bg-running-soft', error: 'text-error border-error/30 bg-error-soft', info: 'text-signal border-signal/30 bg-signal-soft' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, type = 'info') => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2.5 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg animate-rise pointer-events-auto ${COLORS[t.type]}`}
            >
              <Icon size={16} className="shrink-0 mt-0.5" />
              <span className="text-sm text-ink">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
