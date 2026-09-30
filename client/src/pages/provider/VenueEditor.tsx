import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Hourglass,
  MapPin,
  Save,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import BackLink from "../../components/ui/BackLink";
import FormSection from "../../components/ui/FormSection";
import Switch from "../../components/ui/Switch";
import ImageManager from "../../components/venue/ImageManager";
import VenueTabs from "../../components/venue/VenueTabs";
import LocationPicker, { type LatLng } from "../../components/venue/LocationPicker";
import {
  createVenue,
  getVenueById,
  updateVenue,
  type DayKey,
  type OpeningHours,
  type PaymentMode,
  type Venue,
  type VenueFormData,
} from "../../services/venue.api";
import { AMENITIES, DAYS, SPORTS, amenityLabel, sportLabel } from "../../lib/venueOptions";
import { alertError, alertSuccess, btnPrimary, btnSecondary, input, label, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import { translate } from "../../i18n/translate";
import { usePaymentConfig } from "../../hooks/usePaymentConfig";

const HOLD_OPTIONS: { label: MessageKey; values?: Record<string, number>; minutes: number }[] = [
  { label: "vd.hour", minutes: 60 },
  { label: "vd.hours", values: { count: 3 }, minutes: 3 * 60 },
  { label: "vd.hours", values: { count: 6 }, minutes: 6 * 60 },
  { label: "vd.hours", values: { count: 12 }, minutes: 12 * 60 },
  { label: "vd.hours", values: { count: 24 }, minutes: 24 * 60 },
  { label: "editor.days", values: { count: 2 }, minutes: 2 * 24 * 60 },
  { label: "editor.days", values: { count: 3 }, minutes: 3 * 24 * 60 },
];

type DayState = { open: boolean; from: string; to: string };

interface FormState {
  name: string;
  description: string;
  category: string;
  sportTypes: string[];
  amenities: string[];
  address: string;
  city: string;
  pin: LatLng | null;
  pricePerHour: string;
  pendingHoldMinutes: number;
  paymentMode: PaymentMode;
  rules: string;
  isActive: boolean;
  /** Off = don't show opening hours at all. */
  showHours: boolean;
  hours: Record<DayKey, DayState>;
}

const defaultHours = (): Record<DayKey, DayState> =>
  Object.fromEntries(DAYS.map(({ key }) => [key, { open: true, from: "06:00", to: "22:00" }])) as Record<
    DayKey,
    DayState
  >;

const EMPTY: FormState = {
  name: "",
  description: "",
  category: "Football",
  sportTypes: [],
  amenities: [],
  address: "",
  city: "",
  pin: null,
  pricePerHour: "",
  pendingHoldMinutes: 24 * 60,
  paymentMode: "PAY_AT_VENUE",
  rules: "",
  isActive: true,
  showHours: false,
  hours: defaultHours(),
};

function toPayload(form: FormState): VenueFormData {
  const openingHours: OpeningHours | null = form.showHours
    ? Object.fromEntries(
        DAYS.map(({ key }) => {
          const day = form.hours[key];
          return [key, day.open ? { open: day.from, close: day.to } : null];
        })
      )
    : null;

  return {
    name: form.name.trim(),
    description: form.description,
    category: form.category,
    sportTypes: form.sportTypes,
    amenities: form.amenities,
    address: form.address,
    city: form.city.trim(),
    latitude: form.pin?.lat ?? null,
    longitude: form.pin?.lng ?? null,
    pricePerHour: Number(form.pricePerHour),
    pendingHoldMinutes: form.pendingHoldMinutes,
    paymentMode: form.paymentMode,
    rules: form.rules.trim() || null,
    isActive: form.isActive,
    openingHours,
  };
}

function ChipToggle({
  options,
  selected,
  onChange,
  labelFor,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  labelFor: (option: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((item) => item !== option) : [...selected, option])}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
              active ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:ring-brand-300"
            }`}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}

function VenueEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const paymentConfig = usePaymentConfig();
  const justCreated = (location.state as { created?: boolean } | null)?.created ?? false;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(justCreated ? t("editor.created") : "");
  const [approval, setApproval] = useState<{ status: Venue["approvalStatus"]; reason: string | null } | null>(null);
  const loading = !isNew && loadedId !== id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    getVenueById(id)
      .then((venue) => {
        if (cancelled) return;
        const hours = defaultHours();
        for (const { key } of DAYS) {
          const day = venue.openingHours?.[key];
          if (day === null) hours[key] = { ...hours[key], open: false };
          else if (day) hours[key] = { open: true, from: day.open, to: day.close };
        }

        setForm({
          name: venue.name,
          description: venue.description ?? "",
          category: venue.category,
          sportTypes: venue.sportTypes.filter((sport) => sport !== venue.category),
          amenities: venue.amenities,
          address: venue.address ?? "",
          city: venue.city ?? "",
          pin: venue.latitude !== null && venue.longitude !== null ? { lat: venue.latitude, lng: venue.longitude } : null,
          pricePerHour: String(Number(venue.pricePerHour)),
          pendingHoldMinutes: venue.pendingHoldMinutes,
          paymentMode: venue.paymentMode ?? "PAY_AT_VENUE",
          rules: venue.rules ?? "",
          isActive: venue.isActive,
          showHours: Boolean(venue.openingHours && Object.keys(venue.openingHours).length > 0),
          hours,
        });
        setApproval({ status: venue.approvalStatus, reason: venue.rejectionReason });
        setLoadedId(id);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(err, translate("editor.loadFailed")));
          setLoadedId(id);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setDay = (day: DayKey, change: Partial<DayState>) =>
    setForm((current) => ({ ...current, hours: { ...current.hours, [day]: { ...current.hours[day], ...change } } }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const badDay = form.showHours && DAYS.find(({ key }) => form.hours[key].open && form.hours[key].from >= form.hours[key].to);
    if (badDay) {
      setError(t("editor.badDay", { day: t(badDay.label) }));
      return;
    }

    setSaving(true);
    try {
      const payload = toPayload(form);
      if (isNew) {
        const venue = await createVenue(payload);
        navigate(`/provider/venues/${venue.id}/edit`, { replace: true, state: { created: true } });
      } else {
        await updateVenue(id, payload);
        if (approval?.status === "REJECTED") {
          setApproval({ status: "PENDING", reason: null });
          setSuccess(t("editor.savedReview"));
        } else {
          setSuccess(t("editor.saved"));
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, t("editor.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageHeader title={t("editor.editTitle")} description={t("common.loading")} />;
  }

  return (
    <div>
      <BackLink to="/provider/venues">{t("editor.back")}</BackLink>
      <PageHeader
        title={isNew ? t("editor.addTitle") : t("editor.editNamed", { name: form.name || t("editor.venue") })}
        description={t("editor.subtitle")}
      />

      {!isNew ? <VenueTabs venueId={id} /> : null}

      {error ? <div className={`mb-4 ${alertError}`}>{error}</div> : null}
      {success ? <div className={`mb-4 ${alertSuccess}`}>{success}</div> : null}

      {approval?.status === "PENDING" ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Hourglass aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{t("editor.awaiting")}</span> {t("editor.awaitingHint")}
          </span>
        </div>
      ) : approval?.status === "REJECTED" ? (
        <div className={`mb-4 ${alertError}`}>
          <span className="font-semibold">{t("editor.needsChanges")}</span>
          {approval.reason ? <> {t("editor.whatToFix", { reason: approval.reason })}</> : null} {t("editor.resubmit")}
        </div>
      ) : null}

      <div className="space-y-6">
        {!isNew ? (
          <FormSection icon={Camera} title={t("gallery.photos")} description={t("editor.coverHint")}>
            <ImageManager venueId={id} />
          </FormSection>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-6">
          <FormSection icon={Store} title={t("editor.basics")}>
            <div>
              <label htmlFor="name" className={label}>{t("editor.name")}</label>
              <input id="name" required minLength={2} value={form.name} onChange={(e) => set("name", e.target.value)} className={input} />
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <label htmlFor="category" className={label}>{t("editor.mainSport")}</label>
                <select id="category" value={form.category} onChange={(e) => set("category", e.target.value)} className={input}>
                  {[...SPORTS, "Other"].map((sport) => (
                    <option key={sport} value={sport}>{sport === "Other" ? t("editor.other") : sportLabel(sport)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="price" className={label}>{t("browse.price")}</label>
                <input id="price" type="number" min={0} required value={form.pricePerHour} onChange={(e) => set("pricePerHour", e.target.value)} className={input} placeholder="500" />
              </div>
              <div>
                <label htmlFor="hold" className={label}>{t("editor.hold")}</label>
                <select id="hold" value={form.pendingHoldMinutes} onChange={(e) => set("pendingHoldMinutes", Number(e.target.value))} className={input}>
                  {HOLD_OPTIONS.some((option) => option.minutes === form.pendingHoldMinutes) ? null : (
                    <option value={form.pendingHoldMinutes}>{t("vd.minutesLong", { count: form.pendingHoldMinutes })}</option>
                  )}
                  {HOLD_OPTIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>{t(option.label, option.values)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <p className={label}>{t("editor.otherSports")}</p>
              <ChipToggle
                options={SPORTS.filter((sport) => sport !== form.category)}
                selected={form.sportTypes}
                onChange={(next) => set("sportTypes", next)}
                labelFor={sportLabel}
              />
            </div>

            <div>
              <label htmlFor="description" className={label}>{t("editor.description")}</label>
              <textarea id="description" rows={4} maxLength={5000} value={form.description} onChange={(e) => set("description", e.target.value)} className={input} placeholder={t("editor.descriptionPlaceholder")} />
            </div>
          </FormSection>

          <FormSection icon={Wallet} title={t("pay.modeTitle")} description={t("editor.paymentHint")}>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t("pay.modeTitle")}</legend>
              {(["PAY_AT_VENUE", "PAY_ONLINE"] as const).map((mode) => {
                const Icon = mode === "PAY_ONLINE" ? CreditCard : Store;
                return (
                  <label
                    key={mode}
                    className="relative flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500"
                  >
                    <input
                      type="radio"
                      name="paymentMode"
                      value={mode}
                      checked={form.paymentMode === mode}
                      onChange={() => set("paymentMode", mode)}
                      className="sr-only"
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-slate-200">
                      <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 pr-6">
                      <span className="font-semibold text-slate-900">{t(`pay.mode.${mode}`)}</span>
                      <span className="mt-0.5 block text-sm leading-5 text-slate-500">{t(`pay.modeHint.${mode}`)}</span>
                    </span>
                    {form.paymentMode === mode ? (
                      <CheckCircle2 aria-hidden="true" className="absolute right-3 top-3 h-5 w-5 text-brand-600" />
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
            {form.paymentMode === "PAY_ONLINE" && paymentConfig && !paymentConfig.enabled ? (
              <p className="flex items-start gap-2 text-sm text-amber-800">
                <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                {t("pay.modeOff")}
              </p>
            ) : null}
          </FormSection>

          <FormSection icon={MapPin} title={t("editor.location")}>
            <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
              <div>
                <label htmlFor="address" className={label}>{t("editor.address")}</label>
                <input id="address" value={form.address} onChange={(e) => set("address", e.target.value)} className={input} placeholder={t("editor.addressPlaceholder")} />
              </div>
              <div>
                <label htmlFor="city" className={label}>{t("browse.city")}</label>
                <input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} className={input} placeholder={t("editor.cityPlaceholder")} />
              </div>
            </div>
            <div>
              <p className={label}>{t("editor.pin")} <span className="font-normal text-slate-500">{t("editor.pinHint")}</span></p>
              <LocationPicker value={form.pin} onChange={(pin) => set("pin", pin)} />
            </div>
          </FormSection>

          <FormSection icon={Sparkles} title={t("editor.facilities")}>
            <div>
              <p className={label}>{t("vd.amenities")}</p>
              <ChipToggle options={AMENITIES} selected={form.amenities} onChange={(next) => set("amenities", next)} labelFor={amenityLabel} />
            </div>
            <div>
              <label htmlFor="rules" className={label}>{t("vd.rules")}</label>
              <textarea id="rules" rows={3} maxLength={2000} value={form.rules} onChange={(e) => set("rules", e.target.value)} className={input} placeholder={t("editor.rulesPlaceholder")} />
            </div>
          </FormSection>

          <FormSection
            icon={Clock}
            title={t("vd.openingHours")}
            description={form.showHours ? undefined : t("editor.hoursHint")}
            aside={
              <label className="flex items-center gap-3 text-sm font-medium text-slate-600">
                <span className="hidden sm:inline">{t("editor.showHours")}</span>
                <Switch checked={form.showHours} onChange={(checked) => set("showHours", checked)} label={t("editor.showHours")} />
              </label>
            }
          >
            {form.showHours ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {DAYS.map(({ key, label: dayLabel }) => {
                  const day = form.hours[key];
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
                      <span className="w-28 font-medium text-slate-800">{t(dayLabel)}</span>
                      <Switch
                        checked={day.open}
                        onChange={(open) => setDay(key, { open })}
                        label={`${t(dayLabel)}: ${t("editor.open")}`}
                      />
                      {day.open ? (
                        <span className="flex items-center gap-2">
                          <input type="time" value={day.from} onChange={(e) => setDay(key, { from: e.target.value })} className={`${inputWidth("w-32")} py-2`} aria-label={t("editor.opens", { day: t(dayLabel) })} />
                          <span aria-hidden="true" className="text-slate-400">–</span>
                          <input type="time" value={day.to} onChange={(e) => setDay(key, { to: e.target.value })} className={`${inputWidth("w-32")} py-2`} aria-label={t("editor.closes", { day: t(dayLabel) })} />
                        </span>
                      ) : (
                        <span className="font-medium text-slate-500">{t("vd.closed")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </FormSection>

          <FormSection
            icon={form.isActive ? Eye : EyeOff}
            title={t("editor.listed")}
            description={t("editor.listedHint")}
            aside={<Switch checked={form.isActive} onChange={(checked) => set("isActive", checked)} label={t("editor.listed")} />}
          />

          {/* Stays in reach while scrolling a long form. */}
          <div className="sticky bottom-4 z-20 flex items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-raised backdrop-blur">
            <Link to="/provider/venues" className={btnSecondary}>{t("common.cancel")}</Link>
            <button type="submit" disabled={saving} className={btnPrimary}>
              <Save aria-hidden="true" className="h-4 w-4" />
              {saving ? t("common.saving") : isNew ? t("editor.create") : t("common.saveChanges")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default VenueEditor;
