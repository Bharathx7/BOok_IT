import { translateOr } from "../i18n/translate";

export const rupees = (value: number | string | null | undefined) =>
  `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "venue.approved" -> "Venue approved" (translated when known). */
export const actionLabel = (action: string) => {
  const text = action.replace(/[._]/g, " ");
  return translateOr(`auditAction.${action}`, text.charAt(0).toUpperCase() + text.slice(1));
};

/** Local "YYYY-MM-DD" for date inputs. */
export const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
