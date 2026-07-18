import { create } from "zustand";

export type ToastVariant = "warning" | "error" | "info";

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastState = {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant) => void;
  dismissToast: (id: string) => void;
};

let nextToastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, variant = "info") => {
    const id = String(++nextToastId);
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));
