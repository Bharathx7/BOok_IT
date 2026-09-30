import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_CENTER, OSM_TILES } from "../../lib/leaflet";
import { btnSecondary, input } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";

export interface LatLng {
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng | null) => void;
}

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function ClickToPlace({ onPick }: { onPick: (value: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: round(event.latlng.lat), lng: round(event.latlng.lng) });
    },
  });
  return null;
}

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();

  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15));
  }, [map, target]);

  return null;
}

/**
 * Drop a pin by clicking the map, dragging the marker, searching an address
 * (OpenStreetMap Nominatim, free) or using the device's location.
 */
function LocationPicker({ value, onChange }: LocationPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  // Only move the map for searches and "my location", not for every click.
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);

  const place = (next: LatLng, fly = false) => {
    onChange(next);
    if (fly) setFlyTarget(next);
  };

  // Not a <form>: the picker sits inside the venue form, and a nested form
  // would make "Search" (or Enter) submit the whole venue instead.
  async function handleSearch() {
    if (query.trim().length < 3) return;

    setSearching(true);
    setMessage("");

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } }
      );
      const data = (await response.json()) as GeocodeResult[];
      setResults(data);
      if (data.length === 0) setMessage(t("picker2.noMatches"));
    } catch {
      setMessage(t("picker2.unavailable"));
    } finally {
      setSearching(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage(t("browse.noGeo"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        place({ lat: round(position.coords.latitude), lng: round(position.coords.longitude) }, true),
      () => setMessage(t("browse.geoFailed"))
    );
  }

  return (
    <div className="space-y-3">
      <div role="search" className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSearch();
            }
          }}
          placeholder={t("picker2.search")}
          aria-label={t("picker2.search")}
          className={input}
        />
        <button type="button" onClick={() => void handleSearch()} disabled={searching} className={btnSecondary}>
          {searching ? "..." : t("common.search")}
        </button>
      </div>

      {results.length > 0 ? (
        <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-sm">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon}`}>
              <button
                type="button"
                onClick={() => {
                  place({ lat: round(Number(result.lat)), lng: round(Number(result.lon)) }, true);
                  setResults([]);
                }}
                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
              >
                {result.display_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? <p className="text-sm text-amber-700">{message}</p> : null}

      <div className="h-72 overflow-hidden rounded-xl border border-slate-200">
        <MapContainer
          center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
          zoom={value ? 15 : 5}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer url={OSM_TILES.url} attribution={OSM_TILES.attribution} />
          <ClickToPlace onPick={(next) => place(next)} />
          <FlyTo target={flyTarget} />
          {value ? (
            <Marker
              position={[value.lat, value.lng]}
              draggable
              eventHandlers={{
                dragend(event) {
                  const { lat, lng } = event.target.getLatLng();
                  place({ lat: round(lat), lng: round(lng) });
                },
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">
          {value ? t("picker2.pin", { lat: value.lat, lng: value.lng }) : t("picker2.click")}
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={useMyLocation} className="font-semibold text-brand-700 hover:underline">
            {t("browse.useLocation")}
          </button>
          {value ? (
            <button type="button" onClick={() => onChange(null)} className="font-semibold text-rose-600 hover:underline">
              {t("picker2.remove")}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export default LocationPicker;
