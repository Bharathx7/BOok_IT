import { createContext, useContext } from "react";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: "info" | "success" | "error";
  /** Optional click target, e.g. the related booking page. */
  href?: string;
}

export interface ToastContextType {
  showToast: (toast: ToastInput) => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}
