import { translate } from "../i18n/translate";
import { fakeCheckout, verifyPayment, type CheckoutOrder, type CheckoutResult } from "../services/payment.api";
import { rupees } from "./admin";

// Opens the payment checkout for an order and resolves with the signed
// result; the server then verifies it (and learns of it by webhook anyway).

/** The customer closed the checkout without paying. */
export class CheckoutClosedError extends Error {
  constructor() {
    super("Checkout closed");
    this.name = "CheckoutClosedError";
  }
}

interface RazorpayInstance {
  open(): void;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let scriptLoad: Promise<void> | null = null;

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null;
      script.remove();
      reject(new Error(translate("pay.scriptFailed")));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

async function razorpayCheckout(order: CheckoutOrder) {
  await loadRazorpay();
  return new Promise<CheckoutResult>((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.orderId,
      name: "BookIt",
      description: order.description,
      prefill: order.prefill,
      theme: { color: "#4f46e5" },
      // A failed attempt stays in the checkout, where the customer can retry.
      handler: (response) =>
        resolve({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
      modal: { ondismiss: () => reject(new CheckoutClosedError()) },
    });
    checkout.open();
  });
}

/** Development stand-in for the gateway's checkout (PAYMENT_GATEWAY=fake). */
function fakeCheckoutDialog(order: CheckoutOrder) {
  return new Promise<CheckoutResult>((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "fake-checkout m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-900/40";
    dialog.setAttribute("aria-labelledby", "fake-checkout-title");

    const title = document.createElement("h2");
    title.id = "fake-checkout-title";
    title.className = "text-lg font-semibold";
    title.textContent = translate("pay.fakeTitle");

    const amount = document.createElement("p");
    amount.className = "mt-2 text-3xl font-semibold";
    amount.textContent = rupees(order.amountPaise / 100);

    const note = document.createElement("p");
    note.className = "mt-2 text-sm text-slate-500";
    note.textContent = `${order.description}. ${translate("pay.fakeNote")}`;

    const error = document.createElement("p");
    error.className = "mt-3 hidden text-sm text-rose-700";
    error.setAttribute("role", "alert");

    const buttons = document.createElement("div");
    buttons.className = "mt-6 flex flex-wrap gap-2";
    const button = (label: string, className: string, onClick: () => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.className = `rounded-xl px-4 py-2.5 text-sm font-semibold ${className}`;
      element.addEventListener("click", onClick);
      buttons.appendChild(element);
      return element;
    };

    const close = () => {
      dialog.close();
      dialog.remove();
    };
    let settled = false;
    const attempt = async (outcome: "success" | "failure") => {
      try {
        const result = await fakeCheckout(order.orderId, outcome);
        if (outcome === "success") {
          settled = true;
          close();
          resolve(result);
        } else {
          // Like the real checkout: a declined attempt can be retried.
          error.textContent = translate("pay.declined");
          error.classList.remove("hidden");
        }
      } catch (err) {
        settled = true;
        close();
        reject(err);
      }
    };

    button(translate("pay.fakePay"), "bg-brand-600 text-white hover:bg-brand-700", () => void attempt("success"));
    button(translate("pay.fakeDecline"), "border border-slate-200 text-slate-700 hover:bg-slate-50", () => void attempt("failure"));
    button(translate("common.cancel"), "text-slate-500 hover:underline", () => {
      settled = true;
      close();
      reject(new CheckoutClosedError());
    });

    dialog.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        dialog.remove();
        reject(new CheckoutClosedError());
      }
    });

    dialog.append(title, amount, note, error, buttons);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * Takes the payment for an order and has the server verify it. Resolves
 * with the booking's new status; rejects with CheckoutClosedError if the
 * customer closed the checkout.
 */
export async function payOrder(order: CheckoutOrder) {
  const result = order.gateway === "razorpay" ? await razorpayCheckout(order) : await fakeCheckoutDialog(order);
  return verifyPayment(result);
}
