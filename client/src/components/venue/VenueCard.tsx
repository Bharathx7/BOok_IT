import { Link } from "react-router-dom";
import { ArrowUpRight, MapPin, Navigation, Star, Trophy } from "lucide-react";
import FavoriteButton from "./FavoriteButton";
import { ratingLabel, sportLabel } from "../../lib/venueOptions";
import type { Venue } from "../../services/venue.api";
import { useI18n } from "../../i18n/useI18n";

interface VenueCardProps {
  venue: Venue;
  to: string;
  onFavoriteChange?: (isFavorite: boolean) => void;
}

// Layout adapted from 21st.dev "Property Preview Card": photo first with the
// price badge on it, a divided stats row, and a hover reveal on the photo.
function VenueCard({ venue, to, onFavoriteChange }: VenueCardProps) {
  const { t } = useI18n();
  const sports = venue.sportTypes.length > 0 ? venue.sportTypes : [venue.category];
  const location = [venue.address, venue.city].filter(Boolean).join(", ") || t("venue.noLocation");

  return (
    <Link
      to={to}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-raised"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-slate-100">
        {venue.coverImageUrl ? (
          <img
            src={venue.coverImageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-5xl font-bold text-brand-600/25">
            {venue.name.charAt(0)}
          </div>
        )}

        {venue.coverImageUrl ? (
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
        ) : null}

        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-white text-brand-700 opacity-0 shadow-raised transition duration-300 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <ArrowUpRight className="h-5 w-5" />
        </span>

        <FavoriteButton
          venueId={venue.id}
          isFavorite={venue.isFavorite}
          onChange={onFavoriteChange}
          className="absolute right-3 top-3"
        />

        <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-slate-900 shadow-raised backdrop-blur">
          ₹{Number(venue.pricePerHour)}
          <span className="font-medium text-slate-500">{t("common.perHour")}</span>
        </span>

        {venue.distanceKm !== null ? (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-card backdrop-blur">
            <Navigation aria-hidden="true" className="h-3.5 w-3.5 text-brand-600" />
            {t("venue.kmAway", { km: venue.distanceKm })}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="truncate text-base font-semibold text-slate-900 transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
          {venue.name}
        </h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{location}</span>
        </p>

        <div className="mt-auto flex items-center pt-4 text-sm">
          <span
            className="flex items-center gap-1.5 border-e border-slate-200 pe-4 font-semibold text-slate-800"
            title={venue.reviewCount ? t("venue.reviews", { count: venue.reviewCount }) : t("venue.noReviews")}
          >
            <Star aria-hidden="true" className="h-4 w-4 fill-amber-400 text-amber-400" />
            {ratingLabel(venue.avgRating, venue.reviewCount)}
            {venue.reviewCount > 0 ? <span className="font-normal text-slate-500">({venue.reviewCount})</span> : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 ps-4 text-slate-600">
            <Trophy aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-500" />
            <span className="truncate">
              {sports.slice(0, 2).map(sportLabel).join(", ")}
              {sports.length > 2 ? ` +${sports.length - 2}` : ""}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export default VenueCard;
