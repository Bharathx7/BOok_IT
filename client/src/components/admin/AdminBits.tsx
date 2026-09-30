import { useState, type ReactNode } from "react";
import { badgeBase, btnDangerSolid, btnPrimary, btnSecondary, input } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import { translateOr } from "../../i18n/translate";

const TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${badgeBase} ${TONES[tone]}`}>{children}</span>;
}

const USER_STATUS: Record<string, Tone> = { ACTIVE: "green", SUSPENDED: "amber", BANNED: "red" };
const APPROVAL: Record<string, Tone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };
const REVIEW: Record<string, Tone> = { VISIBLE: "green", FLAGGED: "amber", HIDDEN: "grey" };

function EnumBadge({ tones, prefix, status }: { tones: Record<string, Tone>; prefix: string; status: string }) {
  const { language } = useI18n();
  return <Badge tone={tones[status] ?? "grey"}>{translateOr(`${prefix}.${status}`, status, language)}</Badge>;
}

export const UserStatusBadge = ({ status }: { status: string }) => (
  <EnumBadge tones={USER_STATUS} prefix="userStatus" status={status} />
);

export const ApprovalBadge = ({ status }: { status: string }) => (
  <EnumBadge tones={APPROVAL} prefix="approval" status={status} />
);

export const ReviewStatusBadge = ({ status }: { status: string }) => (
  <EnumBadge tones={REVIEW} prefix="reviewStatus" status={status} />
);

interface ReasonPromptProps {
  title: string;
  confirmLabel: string;
  placeholder?: string;
  /** Reason can't be empty. */
  required?: boolean;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Inline "why?" box shown before a moderation action. */
export function ReasonPrompt({ title, confirmLabel, placeholder, required, danger, busy, onConfirm, onCancel }: ReasonPromptProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const missing = required && reason.trim().length === 0;

  return (
    <form
      className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!missing) onConfirm(reason.trim());
      }}
    >
      <label className="block text-sm font-medium text-slate-700">
        {title}
        {required ? null : <span className="font-normal text-slate-400"> ({t("common.optional")})</span>}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder={placeholder}
          className={`${input} mt-1.5`}
          autoFocus
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || missing} className={danger ? btnDangerSolid : btnPrimary}>
          {busy ? t("common.saving") : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Before/after values of an audit entry, one row per changed field. */
export function AuditChanges({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const { t } = useI18n();
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return null;

  const show = (value: unknown) =>
    value === undefined ? "—" : value === null ? t("audit.none") : typeof value === "object" ? JSON.stringify(value) : String(value);

  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1 pr-3 font-medium">{t("audit.field")}</th>
          <th className="py-1 pr-3 font-medium">{t("audit.before")}</th>
          <th className="py-1 font-medium">{t("audit.after")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {keys.map((key) => (
          <tr key={key} className="align-top">
            <td className="py-1 pr-3 font-medium text-slate-600">{key}</td>
            <td className="break-all py-1 pr-3 text-slate-500">{show(before?.[key])}</td>
            <td className="break-all py-1 text-slate-800">{show(after?.[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
