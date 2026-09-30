export const pageTitle =
  "text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.7rem]";

export const pageSub = "mt-1 max-w-2xl text-sm leading-6 text-slate-500";

export const card =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-card";

export const tableCard =
  "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card";

export const cardHover =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-raised";

const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export const btnPrimary = `${btn} bg-brand-600 text-white shadow-brand hover:bg-brand-700`;

export const btnSecondary = `${btn} border border-slate-200 bg-white text-slate-700 shadow-card hover:border-slate-300 hover:bg-slate-50`;

export const btnDanger = `${btn} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;

export const btnDangerSolid = `${btn} bg-rose-600 text-white hover:bg-rose-700`;

export const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-card outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

/**
 * `input` with a different width. Appending a width class to `input` doesn't
 * work: both width utilities apply and Tailwind's order decides which wins.
 */
export const inputWidth = (width: string) => input.replace("w-full", width);

export const label = "mb-1.5 block text-sm font-medium text-slate-700";

export const alertError =
  "rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700";

export const alertSuccess =
  "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800";

export const badgeBase =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset";

export function statusClass(status: string) {
  switch (status) {
    case "PENDING":
    case "AWAITING_PAYMENT":
      return `${badgeBase} bg-amber-50 text-amber-800 ring-amber-200`;
    case "CONFIRMED":
      return `${badgeBase} bg-emerald-50 text-emerald-800 ring-emerald-200`;
    case "COMPLETED":
      return `${badgeBase} bg-brand-50 text-brand-700 ring-brand-200`;
    case "CANCELLED":
      return `${badgeBase} bg-rose-50 text-rose-700 ring-rose-200`;
    case "EXPIRED":
      return `${badgeBase} bg-slate-100 text-slate-600 ring-slate-200`;
    default:
      return `${badgeBase} bg-slate-50 text-slate-600 ring-slate-200`;
  }
}

export function initials(name?: string) {
  if (!name) {
    return "B";
  }

  // Only words that start with a letter, so "Farhan (walk-in)" gives "F", not "F(".
  return (
    name
      .split(/\s+/)
      .filter((part) => /^\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "B"
  );
}
