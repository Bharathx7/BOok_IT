import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContext, type ToastInput } from "./toast-context";
import { useI18n } from "../i18n/useI18n";

interface Toast extends ToastInput {
  id: number;
}

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

const toneClass: Record<NonNullable<ToastInput["tone"]>, string> = {
  info: "border-brand-200",
  success: "border-brand-300",
  error: "border-rose-300",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const navigate = useNavigate();
  const { t } = useI18n();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...input, id }].slice(-MAX_TOASTS));
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-xl border bg-white p-4 shadow-lg ${
              toneClass[toast.tone ?? "info"]
            }`}
          >
            <div className="flex items-start gap-3">
              <button
                type="button"
                disabled={!toast.href}
                onClick={() => {
                  if (toast.href) {
                    navigate(toast.href);
                    dismiss(toast.id);
                  }
                }}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                {toast.body ? <p className="mt-1 text-sm text-slate-600">{toast.body}</p> : null}
              </button>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={t("toast.dismiss")}
                className="rounded-lg px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
