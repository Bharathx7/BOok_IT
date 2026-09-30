import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import type { VenueImage } from "../../services/venue.api";
import { useI18n } from "../../i18n/useI18n";

interface PhotoGalleryProps {
  images: VenueImage[];
  venueName: string;
}

const arrow =
  "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-raised transition hover:bg-white";

/**
 * Venue photos. Three or more show as a bento grid (one large, up to four
 * small) on wider screens; fewer, or a phone, get a single photo with arrows.
 * Any photo opens a full-screen viewer; arrow keys browse, Escape closes.
 */
function PhotoGallery({ images, venueName }: PhotoGalleryProps) {
  const { t } = useI18n();
  // Cover first, then the rest in their saved order.
  const ordered = [...images].sort((a, b) => Number(b.isCover) - Number(a.isCover));
  const count = ordered.length;
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const step = (value: number, by: number) => (value + by + count) % count;
  // Only opening and closing the viewer matters to the effect, not which photo shows.
  const viewerOpen = viewer !== null;

  useEffect(() => {
    if (!viewerOpen) return;

    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(null);
      if (event.key === "ArrowRight") setViewer((value) => (value === null ? value : (value + 1) % count));
      if (event.key === "ArrowLeft") setViewer((value) => (value === null ? value : (value - 1 + count) % count));
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [viewerOpen, count]);

  if (count === 0) {
    return (
      <div
        aria-hidden="true"
        className="relative flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400 sm:h-48"
      >
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px]" />
        <span className="relative text-7xl font-bold text-white/85">{venueName.charAt(0)}</span>
      </div>
    );
  }

  const alt = (i: number) => t("gallery.alt", { venue: venueName, n: i + 1, count });
  const rest = ordered.slice(1, 5);
  // Spread the small tiles so the grid has no holes when there are fewer than four.
  const tileSpan = (i: number) =>
    rest.length === 2 || (rest.length === 3 && i === 2) ? "col-span-2" : "";

  const single = (
    <div className="relative overflow-hidden rounded-2xl bg-slate-100">
      <button type="button" onClick={() => setViewer(index)} className="block w-full" aria-label={t("gallery.open")}>
        <img
          src={ordered[index]!.url}
          alt={alt(index)}
          // The first thing on the venue page: fetch it before anything else.
          fetchPriority="high"
          className="aspect-[4/3] w-full object-cover sm:aspect-[16/7]"
        />
      </button>
      {count > 1 ? (
        <>
          <button type="button" onClick={() => setIndex((v) => step(v, -1))} aria-label={t("gallery.prev")} className={`${arrow} left-3`}>
            <ChevronLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setIndex((v) => step(v, 1))} aria-label={t("gallery.next")} className={`${arrow} right-3`}>
            <ChevronRight aria-hidden="true" className="h-5 w-5" />
          </button>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            {index + 1} / {count}
          </span>
        </>
      ) : null}
    </div>
  );

  return (
    <div>
      {count >= 3 ? (
        <>
          <div className="md:hidden">{single}</div>
          <div className="relative hidden h-[26rem] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:grid">
            {[ordered[0]!, ...rest].map((image, i) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setViewer(i)}
                aria-label={t("gallery.show", { n: i + 1 })}
                className={`group relative overflow-hidden bg-slate-100 ${i === 0 ? "col-span-2 row-span-2" : tileSpan(i - 1)}`}
              >
                <img
                  src={image.url}
                  alt={alt(i)}
                  fetchPriority={i === 0 ? "high" : undefined}
                  loading={i === 0 ? undefined : "lazy"}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105 group-hover:brightness-90"
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setViewer(0)}
              className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-lg bg-white/90 px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-raised backdrop-blur transition hover:bg-white"
            >
              <Images aria-hidden="true" className="h-4 w-4" />
              {t("vd.showAllPhotos", { count })}
            </button>
          </div>
        </>
      ) : (
        single
      )}

      {viewer !== null
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("gallery.photos")}
              className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-12"
              onClick={() => setViewer(null)}
            >
              <img
                src={ordered[viewer]!.url}
                alt={alt(viewer)}
                className="max-h-full max-w-full rounded-xl object-contain"
                onClick={(event) => event.stopPropagation()}
              />
              <span className="absolute left-1/2 top-5 -translate-x-1/2 text-sm font-medium text-white/80">
                {viewer + 1} / {count}
              </span>
              <button
                ref={closeButton}
                type="button"
                onClick={() => setViewer(null)}
                aria-label={t("common.close")}
                className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
              {count > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setViewer((v) => step(v ?? 0, -1));
                    }}
                    aria-label={t("gallery.prev")}
                    className={`${arrow} left-4`}
                  >
                    <ChevronLeft aria-hidden="true" className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setViewer((v) => step(v ?? 0, 1));
                    }}
                    aria-label={t("gallery.next")}
                    className={`${arrow} right-4`}
                  >
                    <ChevronRight aria-hidden="true" className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default PhotoGallery;
