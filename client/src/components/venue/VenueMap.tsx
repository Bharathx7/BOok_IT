import { useEffect } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, CircleMarker, useMap } from "react-leaflet";
import { DEFAULT_CENTER, L, OSM_TILES } from "../../lib/leaflet";
import type { Venue } from "../../services/venue.api";
import { useI18n } from "../../i18n/useI18n";

interface VenueMapProps {
  venues: Venue[];
  linkFor: (venue: Venue) => string;
  /** The searcher's position, if "near me" is on. */
  origin?: { lat: number; lng: number } | null;
  className?: string;
}

type Pinned = Venue & { latitude: number; longitude: number };

/** Zooms to show every pin (and the searcher) whenever the results change. */
function FitToPins({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 1) {
      map.setView(points[0]!, 14);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    }
  }, [map, points]);

  return null;
}

function VenueMap({ venues, linkFor, origin, className = "h-[32rem]" }: VenueMapProps) {
  const { t } = useI18n();
  const pinned = venues.filter(
    (venue): venue is Pinned => venue.latitude !== null && venue.longitude !== null
  );
  const points: [number, number][] = [
    ...pinned.map((venue): [number, number] => [venue.latitude, venue.longitude]),
    ...(origin ? [[origin.lat, origin.lng] as [number, number]] : []),
  ];
  const hidden = venues.length - pinned.length;

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-slate-200/80 ${className}`}>
      <MapContainer center={DEFAULT_CENTER} zoom={5} scrollWheelZoom className="h-full w-full">
        <TileLayer url={OSM_TILES.url} attribution={OSM_TILES.attribution} />
        <FitToPins points={points} />

        {origin ? (
          <CircleMarker
            center={[origin.lat, origin.lng]}
            radius={8}
            pathOptions={{ color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.9 }}
          >
            <Popup>{t("map.here")}</Popup>
          </CircleMarker>
        ) : null}

        {pinned.map((venue) => (
          <Marker key={venue.id} position={[venue.latitude, venue.longitude]}>
            <Popup>
              <div className="min-w-40">
                <p className="font-semibold text-slate-900">{venue.name}</p>
                <p className="text-xs text-slate-500">
                  ₹{Number(venue.pricePerHour)} {t("common.perHour")}
                  {venue.distanceKm !== null ? ` · ${venue.distanceKm} km` : ""}
                </p>
                <Link to={linkFor(venue)} className="mt-1 inline-block text-sm font-semibold text-brand-700">
                  {t("map.view")}
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {hidden > 0 ? (
        <p className="absolute bottom-3 left-3 z-[400] rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">
          {hidden === 1 ? t("map.hiddenOne") : t("map.hidden", { count: hidden })}
        </p>
      ) : null}
    </div>
  );
}

export default VenueMap;
