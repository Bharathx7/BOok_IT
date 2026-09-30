import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Accessibility,
  AirVent,
  Armchair,
  ArrowLeft,
  Bath,
  Car,
  Check,
  Clock,
  Coffee,
  CreditCard,
  Dumbbell,
  ExternalLink,
  GlassWater,
  HeartPulse,
  Info,
  Lightbulb,
  MapPin,
  MessageSquare,
  Shirt,
  ShowerHead,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import {
  getVenueById,
  getVenueReviews,
  type VenueDetails as VenueDetailsData,
  type VenueReview,
} from "../../services/venue.api";
import PhotoGallery from "../../components/venue/PhotoGallery";
import BookingPicker from "../../components/venue/BookingPicker";
import FavoriteButton from "../../components/venue/FavoriteButton";
import ReportReviewButton from "../../components/venue/ReportReviewButton";
import VenueMap from "../../components/venue/VenueMap";
import EmptyState from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { StarRating } from "../../components/ui/StarRating";
import { alertError, btnPrimary, btnSecondary, card, initials } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { timeAgo } from "../../lib/datetime";
import { DAYS, amenityLabel, ratingLabel, sportLabel } from "../../lib/venueOptions";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import { takesOnlinePayment, usePaymentConfig } from "../../hooks/usePaymentConfig";

const AMENITY_ICONS: Record<string, LucideIcon> = {
  Parking: Car,
  Floodlights: Lightbulb,
  "Changing rooms": Shirt,
  Showers: ShowerHead,
  "Drinking water": GlassWater,
  Washrooms: Bath,
  "Equipment rental": Dumbbell,
  Cafeteria: Coffee,
  "First aid": HeartPulse,
  "Seating area": Armchair,
  "Air conditioning": AirVent,
  "Wheelchair access": Accessibility,
};

/** Today's day key ("mon" ... "sun") in the venue's own time zone. */
function todayKey(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(new Date()).slice(0, 3).toLowerCase();
  } catch {
    return "";
  }
}

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm text-slate-700">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon aria-hidden="true" className="h-4.5 w-4.5" />
      </span>
      {children}
    </li>
  );
}

function VenueDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const paymentConfig = usePaymentConfig();

  const [venue, setVenue] = useState<VenueDetailsData | null>(null);
  const [reviews, setReviews] = useState<VenueReview[]>([]);

  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState(id ? "" : t("vd.invalid"));

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    const loadVenue = async () => {
      try {
        const [venueData, reviewData] = await Promise.all([
          getVenueById(id),
          getVenueReviews(id, { limit: 5 }),
        ]);

        if (cancelled) return;
        setVenue(venueData);
        setReviews(reviewData.reviews);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load venue:", err);
        setError(getErrorMessage(err, translate("vd.loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadVenue();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (error && !venue) {
    return (
      <div>
        <p className={alertError}>{error}</p>
        <button type="button" onClick={() => navigate("/customer/venues")} className={`mt-4 ${btnSecondary}`}>
          {t("vd.back")}
        </button>
      </div>
    );
  }

  if (!venue) {
    return <p className="text-sm text-slate-500">{t("vd.notFound")}</p>;
  }

  const sports = venue.sportTypes.length > 0 ? venue.sportTypes : [venue.category];
  const hasHours = venue.openingHours && Object.keys(venue.openingHours).length > 0;
  const hasPin = venue.latitude !== null && venue.longitude !== null;
  const location = [venue.address, venue.city].filter(Boolean).join(", ") || t("venue.noAddress");
  const payOnline = takesOnlinePayment(venue, paymentConfig);
  const today = todayKey(venue.timezone);
  const todayHours = hasHours && venue.openingHours && today in venue.openingHours ? venue.openingHours[today as keyof typeof venue.openingHours] : undefined;
  const confirmTime =
    venue.pendingHoldMinutes >= 120
      ? t("vd.hours", { count: Math.round(venue.pendingHoldMinutes / 60) })
      : venue.pendingHoldMinutes >= 60
        ? t("vd.hour")
        : t("vd.minutesLong", { count: venue.pendingHoldMinutes });
  const price = Number(venue.pricePerHour);

  return (
    <div className="pb-24 lg:pb-0">
      <Link
        to="/customer/venues"
        className="mb-5 inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-slate-600 transition hover:text-brand-700"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("vd.back")}
      </Link>

      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {sports.map((sport) => (
              <span key={sport} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                {sportLabel(sport)}
              </span>
            ))}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{venue.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <a href="#reviews" className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:underline">
              <Star aria-hidden="true" className="h-4 w-4 fill-amber-400 text-amber-400" />
              {ratingLabel(venue.avgRating, venue.reviewCount)}
              {venue.reviewCount > 0 ? (
                <span className="font-normal text-slate-500">
                  ({venue.reviewCount === 1 ? t("venue.review") : t("venue.reviews", { count: venue.reviewCount })})
                </span>
              ) : null}
            </a>
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" className="h-4 w-4 text-slate-400" />
              {location}
            </span>
          </div>
        </div>
        <FavoriteButton venueId={venue.id} isFavorite={venue.isFavorite} />
      </header>

      <PhotoGallery images={venue.images} venueName={venue.name} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className={card}>
            <h2 className="text-lg font-semibold text-slate-900">{t("vd.about")}</h2>

            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              <Fact icon={Trophy}>{sports.map(sportLabel).join(", ")}</Fact>
              <Fact icon={Clock}>
                {todayHours ? t("vd.openToday", { hours: `${todayHours.open}–${todayHours.close}` }) : hasHours ? t("vd.closedToday") : t("vd.openingHours")}
              </Fact>
              <Fact icon={payOnline ? CreditCard : Check}>{payOnline ? t("vd.payOnline") : t("vd.confirmsIn", { time: confirmTime })}</Fact>
            </ul>

            <p className="mt-5 whitespace-pre-line text-[0.95rem] leading-7 text-slate-600">{venue.description || t("vd.noDescription")}</p>

            {venue.amenities.length > 0 ? (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("vd.amenities")}</h3>
                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  {venue.amenities.map((amenity) => {
                    const Icon = AMENITY_ICONS[amenity] ?? Check;
                    return (
                      <li key={amenity} className="flex items-center gap-2.5 text-sm text-slate-700">
                        <Icon aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-slate-500" />
                        {amenityLabel(amenity)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {venue.rules ? (
              <div className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">{t("vd.rules")}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-amber-900/80">{venue.rules}</p>
                </div>
              </div>
            ) : null}
          </section>

          <div id="book" className="scroll-mt-24">
            <BookingPicker venue={venue} />
          </div>

          <section id="reviews" className={`${card} scroll-mt-24`}>
            <h2 className="text-lg font-semibold text-slate-900">{t("nav.reviews")}</h2>
            {venue.reviewCount > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl bg-slate-50 p-5">
                <p className="text-5xl font-bold tracking-tight text-slate-900 tabular">{venue.avgRating.toFixed(1)}</p>
                <div>
                  <StarRating rating={venue.avgRating} size={20} />
                  <p className="mt-1 text-sm text-slate-500">
                    {t("vd.outOfFive")} · {t("vd.basedOn", { count: venue.reviewCount })}
                  </p>
                </div>
              </div>
            ) : null}

            {reviews.length === 0 ? (
              <EmptyState bare icon={MessageSquare} title={t("vd.noReviews")} />
            ) : (
              <>
                {venue.reviewCount > 0 ? <h3 className="mt-6 text-sm font-semibold text-slate-900">{t("vd.recentReviews")}</h3> : null}
                <ul className="mt-2 divide-y divide-slate-100">
                  {reviews.map((review) => (
                    <li key={review.id} className="flex gap-3 py-5 last:pb-0">
                      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                        {initials(review.user.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3">
                          <p className="text-sm font-semibold text-slate-900">{review.user.name}</p>
                          <span className="text-xs text-slate-500">{timeAgo(review.createdAt)}</span>
                        </div>
                        <div className="mt-1">
                          <StarRating rating={review.rating} size={14} />
                        </div>
                        {review.review ? <p className="mt-2 text-sm leading-6 text-slate-700">{review.review}</p> : null}
                        {review.providerReply ? (
                          <div className="mt-3 rounded-xl border-l-4 border-brand-300 bg-slate-50 px-4 py-3 text-sm">
                            <p className="text-xs font-semibold text-brand-700">{t("vd.reply")}</p>
                            <p className="mt-1 text-slate-700">{review.providerReply}</p>
                          </div>
                        ) : null}
                        <ReportReviewButton reviewId={review.id} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-raised">
            <p className="text-3xl font-bold tracking-tight text-slate-900 tabular">
              ₹{price}
              <span className="ml-1 text-base font-medium text-slate-500">{t("vd.perHourLong")}</span>
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm text-slate-600">
              {payOnline ? (
                <CreditCard aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              ) : (
                <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              )}
              {payOnline ? t("pay.venueOnline") : t("vd.confirmsWithin", { time: confirmTime })}
            </p>
            <a href="#book" className={`${btnPrimary} mt-5 w-full py-3 text-base`}>
              {t("vd.bookCta")}
            </a>
          </section>

          {hasHours ? (
            <section className={card}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Clock aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {t("vd.openingHours")}
              </h2>
              <dl className="mt-3 space-y-0.5 text-sm">
                {DAYS.map(({ key, label }) => {
                  if (!venue.openingHours || !(key in venue.openingHours)) return null;
                  const hours = venue.openingHours[key];
                  const isToday = key === today;
                  return (
                    <div
                      key={key}
                      className={`-mx-2 flex justify-between gap-3 rounded-lg px-2 py-1.5 ${isToday ? "bg-brand-50 font-semibold" : ""}`}
                    >
                      <dt className={isToday ? "text-brand-800" : "text-slate-500"}>{t(label)}</dt>
                      <dd className={hours ? (isToday ? "text-brand-800" : "font-medium text-slate-900") : "text-slate-500"}>
                        {hours ? `${hours.open} – ${hours.close}` : t("vd.closed")}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}

          {hasPin ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
              <VenueMap venues={[venue]} linkFor={() => `/customer/venues/${venue.id}`} className="h-56" />
              <a
                href={`https://www.openstreetmap.org/directions?to=${venue.latitude},${venue.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-brand-700 transition hover:bg-slate-50"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="truncate">{location}</span>
                </span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="sr-only">{t("vd.directions")}</span>
              </a>
            </section>
          ) : null}
        </aside>
      </div>

      {/* Phones: price and a book button stay in reach at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <p className="text-lg font-bold text-slate-900 tabular">
          ₹{price}
          <span className="ml-1 text-sm font-medium text-slate-500">{t("vd.perHourLong")}</span>
        </p>
        <a href="#book" className={btnPrimary}>
          {t("vd.bookCta")}
        </a>
      </div>
    </div>
  );
}

export default VenueDetails;
