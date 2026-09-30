import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, LayoutGrid, Map as MapIcon, MapPin, Navigation, Search, SearchX, SlidersHorizontal, Star, X } from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import SegmentedControl from "../../components/ui/SegmentedControl";
import Sheet from "../../components/ui/Sheet";
import EmptyState from "../../components/ui/EmptyState";
import { VenueCardSkeleton } from "../../components/ui/Skeleton";
import VenueCard from "../../components/venue/VenueCard";
import VenueMap from "../../components/venue/VenueMap";
import {
  getPopularVenues,
  searchVenues,
  type Venue,
  type VenueSearchParams,
  type VenueSort,
} from "../../services/venue.api";
import type { Pagination } from "../../lib/pagination";
import {
  AMENITIES,
  DURATIONS,
  SORT_OPTIONS,
  SPORTS,
  amenityLabel,
  sportLabel,
  todayInputValue,
} from "../../lib/venueOptions";
import { alertError, btnPrimary, btnSecondary, input, inputWidth, label } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";

const PAGE_SIZE = 12;
const MAP_PAGE_SIZE = 50;
const RATINGS = [3, 4, 4.5];
const RADII = [2, 5, 10, 25, 50];

// Every filter lives in the URL, so searches can be shared and survive reloads.
function readFilters(params: URLSearchParams) {
  const number = (key: string) => {
    const value = params.get(key);
    return value === null || value === "" || Number.isNaN(Number(value)) ? undefined : Number(value);
  };
  const text = (key: string) => params.get(key)?.trim() || undefined;

  return {
    q: text("q"),
    sport: text("sport"),
    city: text("city"),
    minPrice: number("minPrice"),
    maxPrice: number("maxPrice"),
    minRating: number("minRating"),
    amenities: text("amenities")?.split(",").filter(Boolean) ?? [],
    date: text("date"),
    time: text("time"),
    duration: number("duration"),
    lat: number("lat"),
    lng: number("lng"),
    radiusKm: number("radiusKm"),
    sort: text("sort") as VenueSort | undefined,
    page: number("page") ?? 1,
    view: params.get("view") === "map" ? ("map" as const) : ("list" as const),
  };
}

type Filters = ReturnType<typeof readFilters>;

const hasAnyFilter = (filters: Filters) =>
  Boolean(
    filters.q ||
      filters.sport ||
      filters.city ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      filters.minRating !== undefined ||
      filters.amenities.length ||
      filters.date ||
      filters.lat !== undefined
  );

/** How many filters live in the side panel (shown as a badge on its button). */
const panelFilterCount = (filters: Filters) =>
  [filters.minPrice !== undefined || filters.maxPrice !== undefined, filters.minRating !== undefined, filters.date, filters.lat !== undefined].filter(Boolean)
    .length + filters.amenities.length;

interface Result {
  key: string | null;
  venues: Venue[];
  pagination: Pagination | null;
  error: string;
}

/** A pill that toggles on and off. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 ring-inset transition ${
        active
          ? "bg-brand-600 text-white ring-brand-600 shadow-brand"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 hover:ring-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 pb-6 last:border-0 last:pb-0">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function BrowseVenues() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const paramsKey = searchParams.toString();

  // Text inputs are drafts until the form is submitted.
  const [draft, setDraft] = useState({
    q: filters.q ?? "",
    city: filters.city ?? "",
    minPrice: filters.minPrice?.toString() ?? "",
    maxPrice: filters.maxPrice?.toString() ?? "",
  });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // null until the first search answers: "" is a real key (no filters), so it would read as loaded.
  const [result, setResult] = useState<Result>({ key: null, venues: [], pagination: null, error: "" });
  const [popular, setPopular] = useState<Venue[]>([]);
  const loading = result.key !== paramsKey;

  useEffect(() => {
    let cancelled = false;
    const { page, view, ...rest } = filters;
    const request: VenueSearchParams = {
      ...rest,
      page: view === "map" ? 1 : page,
      limit: view === "map" ? MAP_PAGE_SIZE : PAGE_SIZE,
    };

    searchVenues(request)
      .then((data) => {
        if (!cancelled) {
          setResult({ key: paramsKey, venues: data.items, pagination: data.pagination, error: "" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            key: paramsKey,
            venues: [],
            pagination: null,
            error: getErrorMessage(error, translate("browse.loadFailed")),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, paramsKey]);

  useEffect(() => {
    let cancelled = false;
    getPopularVenues(4)
      .then((venues) => {
        if (!cancelled) setPopular(venues);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** Changes filters in the URL; any change except paging goes back to page 1. */
  function update(changes: Record<string, string | number | undefined | null>) {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    }

    if (!("page" in changes)) next.delete("page");
    setSearchParams(next);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    update({ q: draft.q.trim(), city: draft.city.trim() });
  }

  function applyPanel(event?: FormEvent) {
    event?.preventDefault();
    update({ minPrice: draft.minPrice, maxPrice: draft.maxPrice });
    setShowFilters(false);
  }

  function resetPanel() {
    setDraft({ ...draft, minPrice: "", maxPrice: "" });
    update({
      minPrice: null,
      maxPrice: null,
      minRating: null,
      amenities: null,
      date: null,
      time: null,
      duration: null,
      lat: null,
      lng: null,
      radiusKm: null,
      sort: filters.sort === "distance" ? null : filters.sort,
    });
  }

  function toggleAmenity(amenity: string) {
    const selected = new Set(filters.amenities);
    if (selected.has(amenity)) selected.delete(amenity);
    else selected.add(amenity);
    update({ amenities: [...selected].join(",") });
  }

  function toggleNearMe() {
    if (filters.lat !== undefined) {
      update({ lat: null, lng: null, radiusKm: null, sort: filters.sort === "distance" ? null : filters.sort });
      return;
    }

    if (!navigator.geolocation) {
      setLocationError(t("browse.noGeo"));
      return;
    }

    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        update({
          lat: position.coords.latitude.toFixed(4),
          lng: position.coords.longitude.toFixed(4),
          radiusKm: filters.radiusKm ?? 10,
          sort: "distance",
        });
      },
      () => {
        setLocating(false);
        setLocationError(t("browse.geoFailed"));
      },
      { timeout: 10000 }
    );
  }

  function clearAll() {
    setDraft({ q: "", city: "", minPrice: "", maxPrice: "" });
    setSearchParams(filters.view === "map" ? { view: "map" } : {});
  }

  const filtered = hasAnyFilter(filters);
  const panelCount = panelFilterCount(filters);
  const origin =
    filters.lat !== undefined && filters.lng !== undefined ? { lat: filters.lat, lng: filters.lng } : null;
  const total = result.pagination?.total ?? 0;

  // One removable chip per active filter, so it's clear what narrowed the results.
  const activeChips: { key: string; label: ReactNode; text: string; remove: () => void }[] = [];
  if (filters.q) {
    activeChips.push({ key: "q", label: <>“{filters.q}”</>, text: filters.q, remove: () => { setDraft({ ...draft, q: "" }); update({ q: null }); } });
  }
  if (filters.city) {
    activeChips.push({ key: "city", label: <><MapPin aria-hidden="true" className="h-3.5 w-3.5" />{filters.city}</>, text: filters.city, remove: () => { setDraft({ ...draft, city: "" }); update({ city: null }); } });
  }
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const text =
      filters.minPrice !== undefined && filters.maxPrice !== undefined
        ? t("browse.priceRange", { min: filters.minPrice, max: filters.maxPrice })
        : filters.minPrice !== undefined
          ? t("browse.priceFrom", { min: filters.minPrice })
          : t("browse.priceUpTo", { max: filters.maxPrice ?? "" });
    activeChips.push({ key: "price", label: text, text, remove: () => { setDraft({ ...draft, minPrice: "", maxPrice: "" }); update({ minPrice: null, maxPrice: null }); } });
  }
  if (filters.minRating !== undefined) {
    const text = t("browse.andUp", { rating: filters.minRating });
    activeChips.push({ key: "rating", label: <><Star aria-hidden="true" className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{text}</>, text, remove: () => update({ minRating: null }) });
  }
  if (filters.date) {
    const day = new Date(`${filters.date}T00:00`).toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short" });
    const text = filters.time ? `${day}, ${filters.time}` : day;
    activeChips.push({ key: "date", label: <><CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />{text}</>, text, remove: () => update({ date: null, time: null, duration: null }) });
  }
  if (origin) {
    const text = t("browse.within", { km: filters.radiusKm ?? 10 });
    activeChips.push({ key: "near", label: <><Navigation aria-hidden="true" className="h-3.5 w-3.5" />{text}</>, text, remove: toggleNearMe });
  }
  for (const amenity of filters.amenities) {
    const text = amenityLabel(amenity);
    activeChips.push({ key: `amenity-${amenity}`, label: text, text, remove: () => toggleAmenity(amenity) });
  }

  return (
    <div>
      <PageHeader title={t("nav.browseVenues")} description={t("browse.subtitle")} />

      <form
        onSubmit={applySearch}
        role="search"
        className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-raised sm:flex-row sm:items-center"
      >
        <label className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 transition focus-within:bg-slate-50">
          <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">{t("common.search")}</span>
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder={t("browse.qPlaceholder")}
            className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          />
        </label>
        <span aria-hidden="true" className="hidden h-8 w-px bg-slate-200 sm:block" />
        <label className="flex min-h-12 items-center gap-3 rounded-xl px-3 transition focus-within:bg-slate-50 sm:w-56">
          <MapPin aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">{t("browse.city")}</span>
          <input
            value={draft.city}
            onChange={(event) => setDraft({ ...draft, city: event.target.value })}
            placeholder={t("browse.cityPlaceholder")}
            className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          />
        </label>
        <button type="submit" className={`${btnPrimary} min-h-12 rounded-xl sm:px-6`}>
          <Search aria-hidden="true" className="h-4 w-4" />
          {t("common.search")}
        </button>
      </form>

      <div role="group" aria-label={t("browse.sportsLabel")} className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip active={!filters.sport} onClick={() => update({ sport: null })}>
          {t("browse.allSports")}
        </Chip>
        {SPORTS.map((sport) => (
          <Chip key={sport} active={filters.sport === sport} onClick={() => update({ sport: filters.sport === sport ? null : sport })}>
            {sportLabel(sport)}
          </Chip>
        ))}
      </div>

      {!filtered && popular.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{t("browse.popular")}</h2>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {popular.map((venue) => (
              <VenueCard key={venue.id} venue={venue} to={`/customer/venues/${venue.id}`} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600" aria-live="polite">
          {loading ? t("browse.searching") : total === 1 ? t("browse.foundOne") : t("browse.found", { count: total })}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowFilters(true)} className={`${btnSecondary} min-h-10`}>
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            {t("browse.filters")}
            {panelCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">
                {panelCount}
              </span>
            ) : null}
          </button>

          <select
            value={filters.sort ?? "recommended"}
            onChange={(event) => update({ sort: event.target.value === "recommended" ? null : event.target.value })}
            aria-label={t("browse.sortBy")}
            className={`${inputWidth("w-auto")} min-h-10 py-2`}
          >
            {SORT_OPTIONS.filter((option) => option.value !== "distance" || origin).map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>

          <SegmentedControl
            label={t("browse.viewLabel")}
            value={filters.view}
            onChange={(view) => update({ view: view === "list" ? null : view, page: null })}
            options={[
              { value: "list", label: t("browse.view.list"), icon: LayoutGrid },
              { value: "map", label: t("browse.view.map"), icon: MapIcon },
            ]}
          />
        </div>
      </div>

      {activeChips.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
              {chip.label}
              <button
                type="button"
                onClick={chip.remove}
                aria-label={t("browse.removeFilter", { label: chip.text })}
                className="flex h-6 w-6 items-center justify-center rounded-full text-brand-600 transition hover:bg-brand-100 hover:text-brand-800"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <button type="button" onClick={clearAll} className="ml-1 text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">
            {t("browse.clearAll")}
          </button>
        </div>
      ) : null}

      {result.error && !loading ? <div className={`mb-4 ${alertError}`}>{result.error}</div> : null}

      {filters.view === "map" ? (
        <VenueMap venues={loading ? [] : result.venues} linkFor={(venue) => `/customer/venues/${venue.id}`} origin={origin} />
      ) : loading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <VenueCardSkeleton key={index} />
          ))}
        </div>
      ) : result.venues.length === 0 && !result.error ? (
        <EmptyState
          icon={SearchX}
          title={t("browse.none")}
          hint={t("browse.noneHint")}
          action={
            filtered ? (
              <button type="button" onClick={clearAll} className={btnSecondary}>
                {t("browse.clearAll")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {result.venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} to={`/customer/venues/${venue.id}`} />
            ))}
          </div>
          <Pager
            pagination={result.pagination}
            onPageChange={(page) => {
              update({ page });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={loading}
          />
        </>
      )}

      <Sheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        title={t("browse.filters")}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={resetPanel} className="text-sm font-semibold text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">
              {t("browse.reset")}
            </button>
            <button type="button" onClick={() => applyPanel()} className={btnPrimary}>
              {t("browse.showResults")}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          <PanelSection title={t("browse.price")}>
            <form onSubmit={applyPanel} className="grid grid-cols-2 gap-3">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={draft.minPrice}
                onChange={(event) => setDraft({ ...draft, minPrice: event.target.value })}
                placeholder={t("browse.min")}
                aria-label={t("browse.minLabel")}
                className={input}
              />
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={draft.maxPrice}
                onChange={(event) => setDraft({ ...draft, maxPrice: event.target.value })}
                placeholder={t("browse.max")}
                aria-label={t("browse.maxLabel")}
                className={input}
              />
            </form>
          </PanelSection>

          <PanelSection title={t("browse.whenWhere")}>
            <label htmlFor="browse-date" className={label}>
              {t("browse.availableOn")}
            </label>
            <input
              id="browse-date"
              type="date"
              min={todayInputValue()}
              value={filters.date ?? ""}
              onChange={(event) =>
                update({ date: event.target.value, ...(event.target.value ? {} : { time: null, duration: null }) })
              }
              className={input}
            />
            {filters.date ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="time"
                  step={1800}
                  value={filters.time ?? ""}
                  onChange={(event) => update({ time: event.target.value })}
                  aria-label={t("browse.startTime")}
                  className={input}
                />
                <select
                  value={filters.duration ?? 60}
                  onChange={(event) => update({ duration: event.target.value })}
                  disabled={!filters.time}
                  aria-label={t("browse.duration")}
                  className={input}
                >
                  {DURATIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p className="mt-1.5 text-xs text-slate-500">{filters.time ? t("browse.freeWhole") : t("browse.freeAny")}</p>

            <p className={`${label} mt-5`}>{t("browse.nearMe")}</p>
            <button
              type="button"
              onClick={toggleNearMe}
              disabled={locating}
              aria-pressed={Boolean(origin)}
              className={`w-full ${origin ? btnPrimary : btnSecondary}`}
            >
              <Navigation aria-hidden="true" className="h-4 w-4" />
              {locating ? t("browse.locating") : origin ? t("browse.nearMeOn") : t("browse.useLocation")}
            </button>
            {origin ? (
              <div role="group" aria-label={t("browse.distance")} className="mt-3 flex flex-wrap gap-2">
                {RADII.map((km) => (
                  <Chip key={km} active={(filters.radiusKm ?? 10) === km} onClick={() => update({ radiusKm: km })}>
                    {t("browse.within", { km })}
                  </Chip>
                ))}
              </div>
            ) : null}
            {locationError ? <p className="mt-1.5 text-xs text-rose-600">{locationError}</p> : null}
          </PanelSection>

          <PanelSection title={t("browse.rating")}>
            <div className="flex flex-wrap gap-2">
              <Chip active={filters.minRating === undefined} onClick={() => update({ minRating: null })}>
                {t("browse.anyRating")}
              </Chip>
              {RATINGS.map((rating) => (
                <Chip key={rating} active={filters.minRating === rating} onClick={() => update({ minRating: rating })}>
                  <Star aria-hidden="true" className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {t("browse.andUp", { rating })}
                </Chip>
              ))}
            </div>
          </PanelSection>

          <PanelSection title={t("vd.amenities")}>
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map((amenity) => (
                <Chip key={amenity} active={filters.amenities.includes(amenity)} onClick={() => toggleAmenity(amenity)}>
                  {amenityLabel(amenity)}
                </Chip>
              ))}
            </div>
          </PanelSection>
        </div>
      </Sheet>
    </div>
  );
}

export default BrowseVenues;
