import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  deleteVenueImage,
  getVenueImages,
  reorderVenueImages,
  setCoverImage,
  uploadVenueImages,
  type VenueImage,
} from "../../services/venue.api";
import { alertError, btnPrimary } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";

const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/** Upload, order, pick the cover and delete a venue's photos. */
function ImageManager({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const [images, setImages] = useState<VenueImage[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getVenueImages(venueId)
      .then((data) => {
        if (!cancelled) setImages(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("images.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const remaining = MAX_IMAGES - (images?.length ?? 0);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;

    // Catch obvious problems before uploading anything.
    const invalid = files.find((file) => !ACCEPTED.includes(file.type) || file.size > MAX_BYTES);
    if (invalid) {
      setError(t("images.invalid", { name: invalid.name }));
      return;
    }
    if (files.length > remaining) {
      setError(t("images.tooMany", { count: remaining }));
      return;
    }

    setError("");
    setProgress(0);
    try {
      setImages(await uploadVenueImages(venueId, files, setProgress));
    } catch (err) {
      setError(getErrorMessage(err, t("images.uploadFailed")));
    } finally {
      setProgress(null);
    }
  }

  async function run(imageId: string, action: () => Promise<VenueImage[]>) {
    setBusyId(imageId);
    setError("");
    try {
      setImages(await action());
    } catch (err) {
      setError(getErrorMessage(err, t("images.updateFailed")));
    } finally {
      setBusyId(null);
    }
  }

  function move(index: number, step: number) {
    if (!images) return;
    const order = images.map((image) => image.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + step, 0, moved!);
    void run(moved!, () => reorderVenueImages(venueId, order));
  }

  const iconButton =
    "rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-white disabled:opacity-50";

  return (
    <div>
      {error ? <div className={`mb-4 ${alertError}`}>{error}</div> : null}

      {images === null ? (
        <p className="text-sm text-slate-500">{t("images.loading")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <figure
              key={image.id}
              className={`relative overflow-hidden rounded-xl ring-2 ${image.isCover ? "ring-brand-500" : "ring-transparent"}`}
            >
              <img src={image.url} alt={t("images.alt", { n: index + 1 })} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
              {image.isCover ? (
                <span className="absolute left-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {t("images.cover")}
                </span>
              ) : null}
              <figcaption className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
                <button type="button" disabled={busyId !== null || index === 0} onClick={() => move(index, -1)} className={iconButton} aria-label={t("images.left")}>
                  ←
                </button>
                <button type="button" disabled={busyId !== null || index === images.length - 1} onClick={() => move(index, 1)} className={iconButton} aria-label={t("images.right")}>
                  →
                </button>
                {!image.isCover ? (
                  <button type="button" disabled={busyId !== null} onClick={() => void run(image.id, () => setCoverImage(venueId, image.id))} className={iconButton}>
                    {t("images.makeCover")}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => {
                    if (window.confirm(t("images.confirmDelete"))) void run(image.id, () => deleteVenueImage(venueId, image.id));
                  }}
                  className={`${iconButton} text-rose-600`}
                >
                  {t("common.delete")}
                </button>
              </figcaption>
            </figure>
          ))}

          {remaining > 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={progress !== null}
              className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 transition hover:border-brand-400 hover:text-brand-700"
            >
              {progress !== null ? (
                <>
                  <span className="font-semibold">{t("images.uploading", { percent: progress })}</span>
                  <span className="mt-2 h-1.5 w-2/3 overflow-hidden rounded-full bg-slate-200">
                    <span className="block h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
                  </span>
                </>
              ) : (
                <>
                  <span className="text-2xl">+</span>
                  <span className="font-semibold">{t("images.add")}</span>
                  <span className="text-xs">{t("images.left_count", { count: remaining })}</span>
                </>
              )}
            </button>
          ) : null}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        onChange={handleFiles}
        className="hidden"
      />

      {images && images.length === 0 && progress === null ? (
        <button type="button" onClick={() => fileInput.current?.click()} className={`mt-4 ${btnPrimary}`}>
          {t("images.first")}
        </button>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        {t("images.privacy")}
      </p>
    </div>
  );
}

export default ImageManager;
