import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { VenueCardSkeleton } from "../../components/ui/Skeleton";
import VenueCard from "../../components/venue/VenueCard";
import { getFavoriteVenues, type Venue } from "../../services/venue.api";
import type { Pagination } from "../../lib/pagination";
import { alertError, btnPrimary } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import EmptyState from "../../components/ui/EmptyState";
import { Heart } from "lucide-react";

function Favorites() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loadedPage, setLoadedPage] = useState(0);
  const [error, setError] = useState("");
  const loading = loadedPage !== page;

  useEffect(() => {
    let cancelled = false;

    getFavoriteVenues({ page, limit: 12 })
      .then((data) => {
        if (cancelled) return;
        setVenues(data.items);
        setPagination(data.pagination);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("fav.loadFailed")));
      })
      .finally(() => {
        if (!cancelled) setLoadedPage(page);
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <div>
      <PageHeader title={t("nav.favourites")} description={t("fav.subtitle")} />

      {error ? <div className={`mb-4 ${alertError}`}>{error}</div> : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <VenueCardSkeleton key={index} />
          ))}
        </div>
      ) : venues.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t("fav.empty")}
          hint={t("fav.emptyHint")}
          action={<Link to="/customer/venues" className={btnPrimary}>{t("cdash.browse")}</Link>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {venues.map((venue) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                to={`/customer/venues/${venue.id}`}
                // Un-hearting removes it from this list straight away.
                onFavoriteChange={(isFavorite) => {
                  if (!isFavorite) setVenues((current) => current.filter((v) => v.id !== venue.id));
                }}
              />
            ))}
          </div>
          <Pager pagination={pagination} onPageChange={setPage} disabled={loading} />
        </>
      )}
    </div>
  );
}

export default Favorites;
