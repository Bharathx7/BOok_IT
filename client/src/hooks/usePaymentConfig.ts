import { useEffect, useState } from "react";
import { getPaymentConfig, type PaymentConfig } from "../services/payment.api";

/** The server's payment settings (null until loaded, or if they can't be). */
export function usePaymentConfig() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPaymentConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

/** Does this venue take payment online right now? */
export const takesOnlinePayment = (venue: { paymentMode?: string }, config: PaymentConfig | null) =>
  venue.paymentMode === "PAY_ONLINE" && Boolean(config?.enabled);
