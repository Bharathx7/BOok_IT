import { useEffect, useState, type FormEvent } from "react";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { Badge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import {
  createCoupon,
  deleteCoupon,
  getAdminVenues,
  getCoupons,
  updateCoupon,
  type Coupon,
  type CouponInput,
} from "../../services/admin.api";
import { rupees } from "../../lib/admin";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnPrimary, btnSecondary, card, input, label, tableCard } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";

const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

interface FormState {
  code: string;
  description: string;
  type: "PERCENT" | "FLAT";
  value: string;
  maxDiscount: string;
  maxUses: string;
  perUserLimit: string;
  minAmount: string;
  validFrom: string;
  validTo: string;
  venueId: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  code: "",
  description: "",
  type: "PERCENT",
  value: "",
  maxDiscount: "",
  maxUses: "",
  perUserLimit: "1",
  minAmount: "",
  validFrom: "",
  validTo: "",
  venueId: "",
  isActive: true,
};

/** ISO -> value for <input type="datetime-local"> in the browser's time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const fromCoupon = (coupon: Coupon): FormState => ({
  code: coupon.code,
  description: coupon.description ?? "",
  type: coupon.type,
  value: String(Number(coupon.value)),
  maxDiscount: coupon.maxDiscount === null ? "" : String(Number(coupon.maxDiscount)),
  maxUses: coupon.maxUses === null ? "" : String(coupon.maxUses),
  perUserLimit: coupon.perUserLimit === null ? "" : String(coupon.perUserLimit),
  minAmount: coupon.minAmount === null ? "" : String(Number(coupon.minAmount)),
  validFrom: toLocalInput(coupon.validFrom),
  validTo: toLocalInput(coupon.validTo),
  venueId: coupon.venueId ?? "",
  isActive: coupon.isActive,
});

const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

const toInput = (form: FormState): CouponInput => ({
  code: form.code.trim(),
  description: form.description.trim() || null,
  type: form.type,
  value: Number(form.value),
  maxDiscount: form.type === "PERCENT" ? numberOrNull(form.maxDiscount) : null,
  maxUses: numberOrNull(form.maxUses),
  perUserLimit: numberOrNull(form.perUserLimit),
  minAmount: numberOrNull(form.minAmount),
  validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
  validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
  venueId: form.venueId || null,
  isActive: form.isActive,
});

function describe(coupon: Coupon) {
  const off =
    coupon.type === "PERCENT"
      ? translate("coupon.percentOff", { value: Number(coupon.value) })
      : translate("coupon.amountOff", { amount: rupees(coupon.value) });
  const cap =
    coupon.type === "PERCENT" && coupon.maxDiscount !== null ? translate("coupon.cap", { amount: rupees(coupon.maxDiscount) }) : "";
  const min = coupon.minAmount !== null ? translate("coupon.min", { amount: rupees(coupon.minAmount) }) : "";
  return `${off}${cap}${min}`;
}

function status(coupon: Coupon, now: number): { tone: "green" | "grey" | "amber" | "red"; text: string } {
  if (!coupon.isActive) return { tone: "grey", text: translate("coupon.state.off") };
  if (coupon.validTo && Date.parse(coupon.validTo) < now) return { tone: "red", text: translate("coupon.state.expired") };
  if (coupon.validFrom && Date.parse(coupon.validFrom) > now) return { tone: "amber", text: translate("coupon.state.scheduled") };
  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) return { tone: "amber", text: translate("coupon.state.usedUp") };
  return { tone: "green", text: translate("coupon.state.active") };
}

function CouponForm({ editing, venues, onSaved, onCancel }: {
  editing: Coupon | null;
  venues: { id: string; name: string }[];
  onSaved: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(editing ? fromCoupon(editing) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateCoupon(editing.id, toInput(form));
        onSaved(t("coupon.saved", { code: form.code.toUpperCase() }));
      } else {
        await createCoupon(toInput(form));
        onSaved(t("coupon.created", { code: form.code.toUpperCase() }));
      }
    } catch (err) {
      setError(getErrorMessage(err, t("coupon.saveFailed")));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} mb-6 space-y-4`}>
      <h2 className="text-lg font-semibold text-slate-900">{editing ? t("coupon.edit", { code: editing.code }) : t("coupon.new")}</h2>
      {error ? <div className={alertError}>{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={label}>
          {t("abook.code")}
          <input required value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} className={`${input} mt-1.5 font-mono uppercase`} placeholder="WEEKEND20" maxLength={30} />
        </label>
        <label className={label}>
          {t("coupon.type")}
          <select value={form.type} onChange={(e) => set("type", e.target.value as FormState["type"])} className={`${input} mt-1.5`}>
            <option value="PERCENT">{t("coupon.typePercent")}</option>
            <option value="FLAT">{t("coupon.typeFlat")}</option>
          </select>
        </label>
        <label className={label}>
          {form.type === "PERCENT" ? t("coupon.percentLabel") : t("coupon.rupeesLabel")}
          <input required type="number" min={1} max={form.type === "PERCENT" ? 100 : undefined} step="any" value={form.value} onChange={(e) => set("value", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        {form.type === "PERCENT" ? (
          <label className={label}>
            {t("coupon.maxDiscount")}
            <input type="number" min={1} step="any" value={form.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} className={`${input} mt-1.5`} />
          </label>
        ) : null}
        <label className={label}>
          {t("coupon.minAmount")}
          <input type="number" min={1} step="any" value={form.minAmount} onChange={(e) => set("minAmount", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        <label className={label}>
          {t("coupon.maxUses")}
          <input type="number" min={1} step={1} value={form.maxUses} onChange={(e) => set("maxUses", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        <label className={label}>
          {t("coupon.perUser")}
          <input type="number" min={1} step={1} value={form.perUserLimit} onChange={(e) => set("perUserLimit", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        <label className={label}>
          {t("coupon.validFrom")}
          <input type="datetime-local" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        <label className={label}>
          {t("coupon.validTo")}
          <input type="datetime-local" value={form.validTo} onChange={(e) => set("validTo", e.target.value)} className={`${input} mt-1.5`} />
        </label>
        <label className={label}>
          {t("common.venue")}
          <select value={form.venueId} onChange={(e) => set("venueId", e.target.value)} className={`${input} mt-1.5`}>
            <option value="">{t("coupon.everyVenue")}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name}</option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          {t("coupon.description")}
          <input value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={200} className={`${input} mt-1.5`} placeholder={t("coupon.descriptionPlaceholder")} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-brand-600" />
        {t("coupon.state.active")}
      </label>

      <p className="text-xs text-slate-500">
        {t("coupon.hint")}
      </p>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={btnPrimary}>{saving ? t("common.saving") : editing ? t("common.save") : t("coupon.create")}</button>
        <button type="button" onClick={onCancel} disabled={saving} className={btnSecondary}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}

export default function AdminCoupons() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [now] = useState(() => Date.now());

  const { data, loading, error, reload } = useLoad(`${page}`, () => getCoupons({ page }), translate("coupon.loadFailed"));

  useEffect(() => {
    getAdminVenues({ approvalStatus: "APPROVED", limit: 100 })
      .then((result) => setVenues(result.items.map((venue) => ({ id: venue.id, name: venue.name }))))
      .catch(() => undefined);
  }, []);

  async function toggle(coupon: Coupon) {
    try {
      await updateCoupon(coupon.id, { isActive: !coupon.isActive });
      setNotice({ tone: "success", text: t(coupon.isActive ? "coupon.isOff" : "coupon.isOn", { code: coupon.code }) });
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: getErrorMessage(err) });
    }
  }

  async function remove(coupon: Coupon) {
    if (!window.confirm(t("coupon.confirmDelete", { code: coupon.code }))) return;
    try {
      await deleteCoupon(coupon.id);
      setNotice({ tone: "success", text: t("coupon.deleted", { code: coupon.code }) });
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: getErrorMessage(err) });
    }
  }

  return (
    <div>
      <PageHeader
        title={t("nav.coupons")}
        description={t("coupon.subtitle")}
        action={editing ? null : <button type="button" onClick={() => setEditing("new")} className={btnPrimary}>{t("coupon.new")}</button>}
      />

      {editing ? (
        <CouponForm
          key={editing === "new" ? "new" : editing.id}
          editing={editing === "new" ? null : editing}
          venues={venues}
          onCancel={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ tone: "success", text });
            reload();
          }}
        />
      ) : null}

      {notice ? <div className={`${notice.tone === "success" ? alertSuccess : alertError} mb-4`}>{notice.text}</div> : null}
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      <div className={tableCard}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("abook.code")}</th>
                <th className={th}>{t("coupon.discount")}</th>
                <th className={th}>{t("detail.where")}</th>
                <th className={th}>{t("coupon.valid")}</th>
                <th className={`${th} text-right`}>{t("coupon.used")}</th>
                <th className={`${th} text-right`}>{t("coupon.given")}</th>
                <th className={th}>{t("common.status")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data?.items.map((coupon) => {
                const state = status(coupon, now);
                return (
                  <tr key={coupon.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-slate-900">{coupon.code}</span>
                      {coupon.description ? <span className="block text-xs text-slate-500">{coupon.description}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{describe(coupon)}</td>
                    <td className="px-4 py-3 text-slate-500">{coupon.venue?.name ?? t("panal.allVenues")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {coupon.validFrom ? new Date(coupon.validFrom).toLocaleDateString(currentLocale()) : t("coupon.now")} –{" "}
                      {coupon.validTo ? new Date(coupon.validTo).toLocaleDateString(currentLocale()) : t("coupon.noEnd")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {coupon.uses}{coupon.maxUses !== null ? ` / ${coupon.maxUses}` : ""}
                      {coupon.perUserLimit !== null ? <span className="block text-xs text-slate-400">{t("coupon.perCustomer", { count: coupon.perUserLimit })}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right">{rupees(coupon.totalDiscount)}</td>
                    <td className="px-4 py-3"><Badge tone={state.tone}>{state.text}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button type="button" onClick={() => setEditing(coupon)} className="font-semibold text-brand-700 hover:underline">{t("common.edit")}</button>
                      <button type="button" onClick={() => void toggle(coupon)} className="ml-3 font-semibold text-slate-600 hover:underline">
                        {coupon.isActive ? t("pricing.turnOff") : t("pricing.turnOn")}
                      </button>
                      {coupon.uses === 0 ? (
                        <button type="button" onClick={() => void remove(coupon)} className="ml-3 font-semibold text-rose-700 hover:underline">{t("common.delete")}</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {data && data.items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">{t("coupon.none")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {loading && !data ? <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p> : null}

      <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
    </div>
  );
}
