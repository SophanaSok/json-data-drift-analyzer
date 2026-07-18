import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useToastStore, type Toast, type ToastVariant } from "../../stores/toast-store";

const TOAST_DURATION_MS = 6000;

const variantClasses: Record<ToastVariant, string> = {
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-700",
  info: "border-slate-300 bg-white text-slate-900"
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((state) => state.dismissToast);

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast.id]);

  return (
    <div
      className={`rounded border p-3 text-sm shadow-lg ${variantClasses[toast.variant]}`}
      data-testid="toast"
      role="status"
    >
      <div className="flex items-start gap-3">
        <p className="flex-1">{toast.message}</p>
        <button
          type="button"
          className="shrink-0 text-xs font-medium opacity-70 hover:opacity-100"
          onClick={() => dismissToast(toast.id)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>,
    document.body
  );
}
