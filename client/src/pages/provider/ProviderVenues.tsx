import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getMyVenues,
  updateVenue,
  deleteVenue,
  type Venue,
} from "../../services/venue.api";
import PageHeader from "../../components/ui/PageHeader";
import { VenueCardSkeleton } from "../../components/ui/Skeleton";
import { getErrorMessage } from "../../lib/errors";
import { fetchAllPages } from "../../lib/pagination";
import { ratingLabel } from "../../lib/venueOptions";
import {
  alertError,
  btnPrimary,
  btnSecondary,
} from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import { RatingPill } from "../../components/ui/StarRating";
import EmptyState from "../../components/ui/EmptyState";
import { Building2, CalendarClock, Camera, Eye, EyeOff, IndianRupee, MapPin, MapPinned, Pencil, Trash2 } from "lucide-react";

const btnSmall = "px-3! py-2!";

function ProviderVenues() {
  const { t } = useI18n();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyVenueId, setBusyVenueId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadVenues = async () => {
      try {
        const data = await fetchAllPages(getMyVenues);
        if (!cancelled) setVenues(data);
      } catch (error) {
        if (!cancelled) setError(getErrorMessage(error, translate("pvenues.loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadVenues();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reloadVenues = () => setReloadKey((key) => key + 1);

  async function toggleListed(venue: Venue) {
    try {
      setBusyVenueId(venue.id);
      setError("");
      await updateVenue(venue.id, { isActive: !venue.isActive });
      reloadVenues();
    } catch (error) {
      setError(getErrorMessage(error, t("pvenues.updateFailed")));
    } finally {
      setBusyVenueId(null);
    }
  }

  async function handleDeleteVenue(venueId: string) {
    const confirmed = window.confirm(
      t("pvenues.confirmDelete")
    );

    if (!confirmed) {
      return;
    }

    try {
      setBusyVenueId(venueId);
      setError("");
      await deleteVenue(venueId);
      reloadVenues();
    } catch (error) {
      setError(getErrorMessage(error, t("pvenues.deleteFailed")));
    } finally {
      setBusyVenueId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("nav.myVenues")}
        description={t("pvenues.subtitle")}
        action={
          <Link to="/provider/venues/new" className={btnPrimary}>
            {t("pvenues.add")}
          </Link>
        }
      />

      {error ? <div className={`mb-6 ${alertError}`}>{error}</div> : null}

      {loading ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <VenueCardSkeleton key={index} />
          ))}
        </div>
      ) : venues.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("pvenues.empty")}
          hint={t("pvenues.emptyHint")}
          action={<Link to="/provider/venues/new" className={btnPrimary}>
            {t("pvenues.addFirst")}
          </Link>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {venues.map((venue) => {
            const busy = busyVenueId === venue.id;
            return (
              <article key={venue.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400">
                  {venue.coverImageUrl ? (
                    <img src={venue.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <div aria-hidden="true" className="absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px]" />
                      <div className="relative flex h-full flex-col items-center justify-center text-white/90">
                        <span aria-hidden="true" className="text-5xl font-bold">{venue.name.charAt(0)}</span>
                        <span className="mt-1 text-xs font-medium text-indigo-100">{t("pvenues.noPhotos")}</span>
                      </div>
                    </>
                  )}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-card backdrop-blur">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${venue.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                    {venue.isActive ? t("pvenues.listed") : t("pvenues.hidden")}
                  </span>
                  {venue.approvalStatus !== "APPROVED" ? (
                    <span
                      className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-card ${
                        venue.approvalStatus === "PENDING" ? "bg-amber-600" : "bg-rose-600"
                      }`}
                    >
                      {venue.approvalStatus === "PENDING" ? t("approval.PENDING") : t("pvenues.needsChanges")}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-900">{venue.name}</h2>
                    <RatingPill label={ratingLabel(venue.avgRating, venue.reviewCount)} className="shrink-0 text-sm" />
                  </div>

                  <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                    <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{[venue.city, venue.address].filter(Boolean).join(" · ") || t("pvenues.noLocation")}</span>
                  </p>

                  {venue.approvalStatus === "REJECTED" && venue.rejectionReason ? (
                    <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                      {t("pvenues.adminNote", { note: venue.rejectionReason })}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="text-base font-bold text-slate-900 tabular">
                      ₹{Number(venue.pricePerHour)}
                      <span className="text-sm font-medium text-slate-500">{t("common.perHour")}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Camera aria-hidden="true" className="h-4 w-4 text-slate-400" />
                      {venue.imageCount === 1 ? t("pvenues.photo") : t("pvenues.photos", { count: venue.imageCount })}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 ${venue.latitude !== null ? "" : "text-amber-700"}`}>
                      <MapPinned aria-hidden="true" className="h-4 w-4 opacity-70" />
                      {venue.latitude !== null ? t("pvenues.onMap") : t("pvenues.noPin")}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Link to={`/provider/venues/${venue.id}/edit`} className={`${btnPrimary} ${btnSmall}`}>
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                      {t("common.edit")}
                    </Link>
                    <Link to={`/provider/venues/${venue.id}/schedule`} className={`${btnSecondary} ${btnSmall}`}>
                      <CalendarClock aria-hidden="true" className="h-4 w-4" />
                      {t("vtabs.schedule")}
                    </Link>
                    <Link to={`/provider/venues/${venue.id}/pricing`} className={`${btnSecondary} ${btnSmall}`}>
                      <IndianRupee aria-hidden="true" className="h-4 w-4" />
                      {t("pvenues.pricing")}
                    </Link>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleListed(venue)}
                      disabled={busy}
                      aria-label={venue.isActive ? t("pvenues.hide") : t("pvenues.list")}
                      title={venue.isActive ? t("pvenues.hide") : t("pvenues.list")}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 disabled:opacity-50"
                    >
                      {venue.isActive ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteVenue(venue.id)}
                      disabled={busy}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProviderVenues;
