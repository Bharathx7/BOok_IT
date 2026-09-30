import { useState } from "react";
import { useAuth } from "../../context/useAuth";
import { useToast } from "../../context/toast-context";
import { addFavorite, removeFavorite } from "../../services/venue.api";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";

interface FavoriteButtonProps {
  venueId: string;
  isFavorite: boolean;
  onChange?: (isFavorite: boolean) => void;
  className?: string;
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
    </svg>
  );
}

/** Heart toggle; updates optimistically and rolls back if the request fails. */
function FavoriteButton({ venueId, isFavorite, onChange, className = "" }: FavoriteButtonProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t } = useI18n();
  const [saved, setSaved] = useState(isFavorite);
  const [busy, setBusy] = useState(false);

  // Only customers keep favourites.
  if (user?.role !== "USER") return null;

  async function toggle(event: React.MouseEvent) {
    // Cards are links; don't navigate when tapping the heart.
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);

    try {
      await (next ? addFavorite(venueId) : removeFavorite(venueId));
      onChange?.(next);
    } catch (error) {
      setSaved(!next);
      showToast({ title: t("fav.updateFailed"), body: getErrorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? t("fav.remove") : t("fav.add")}
      title={saved ? t("fav.remove") : t("fav.add")}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200 transition hover:scale-105 ${
        saved ? "text-rose-500" : "text-slate-500 hover:text-rose-500"
      } ${className}`}
    >
      <HeartIcon filled={saved} />
    </button>
  );
}

export default FavoriteButton;
