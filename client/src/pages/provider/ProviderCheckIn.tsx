import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import jsQR from "jsqr";
import PageHeader from "../../components/ui/PageHeader";
import { getMyVenues, type Venue } from "../../services/venue.api";
import { checkInByCode, getArrivals, setNoShow, type ArrivalBooking } from "../../services/features.api";
import { fetchAllPages } from "../../lib/pagination";
import { formatTime } from "../../lib/datetime";
import { alertError, alertSuccess, btnPrimary, btnSecondary, card, input, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import { CameraOff, CheckCircle2, ScanLine } from "lucide-react";

/** Camera QR scanner: decodes video frames with jsQR (works on any browser with a camera). */
function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const width = 480;
        const height = Math.round((video.videoHeight / video.videoWidth) * width) || 360;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          const found = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
          const now = Date.now();
          // Ignore the same code for a few seconds so one scan isn't sent twice.
          if (found?.data && (lastCode.current?.code !== found.data || now - lastCode.current.at > 4000)) {
            lastCode.current = { code: found.data, at: now };
            onCode(found.data);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          void videoRef.current.play();
        }
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setError(translate("checkin.noCamera")));

    if (!navigator.mediaDevices) {
      queueMicrotask(() => setError(translate("checkin.needsHttps")));
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  return (
    <div>
      {error ? (
        <p className="text-sm text-amber-700">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

export default function ProviderCheckIn() {
  const { t } = useI18n();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [arrivals, setArrivals] = useState<{ key: string; list: ArrivalBooking[] }>({ key: "", list: [] });
  const [reload, setReload] = useState(0);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllPages(getMyVenues)
      .then((list) => {
        if (cancelled) return;
        setVenues(list);
        if (list[0]) setVenueId(list[0].id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const key = `${venueId}:${reload}`;
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    getArrivals(venueId)
      .then((list) => {
        if (!cancelled) setArrivals({ key, list });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [venueId, key]);

  const submit = useCallback(async (value: string) => {
    setResult(null);
    try {
      const booking = await checkInByCode(value);
      const who = booking.source === "WALK_IN" ? booking.guestName : booking.user.name;
      const guests = booking._count.participants;
      setResult({
        tone: "success",
        text: translate(guests ? "checkin.doneGuests" : "checkin.done", {
          who: who ?? "",
          venue: booking.venue.name,
          time: `${formatTime(booking.startTime, booking.venue.timezone)}–${formatTime(booking.endTime, booking.venue.timezone)}`,
          guests,
        }),
      });
      setCode("");
      setReload((v) => v + 1);
    } catch (error) {
      setResult({ tone: "error", text: `${value}: ${getErrorMessage(error, translate("checkin.failed"))}` });
    }
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) void submit(code.trim());
  }

  const venue = venues.find((v) => v.id === venueId);

  return (
    <div>
      <PageHeader title={t("nav.checkIn")} description={t("checkin.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${card} space-y-4`}>
          {result ? <div className={result.tone === "success" ? alertSuccess : alertError}>{result.text}</div> : null}

          {scanning ? <Scanner onCode={submit} /> : null}
          <button type="button" onClick={() => setScanning((v) => !v)} className={scanning ? btnSecondary : btnPrimary}>
            {scanning ? <CameraOff aria-hidden="true" className="h-4 w-4" /> : <ScanLine aria-hidden="true" className="h-4 w-4" />}
            {scanning ? t("checkin.stop") : t("checkin.scan")}
          </button>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BK-7F3K2Q"
              className={`${input} font-mono tracking-widest`}
              aria-label={t("checkin.code")}
              autoCapitalize="characters"
            />
            <button type="submit" className={`${btnPrimary} shrink-0 whitespace-nowrap`}>{t("checkin.checkIn")}</button>
          </form>
          <p className="text-xs text-slate-500">{t("checkin.window")}</p>
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{t("common.today")}</h2>
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("common.venue")}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          {arrivals.key !== key ? (
            <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>
          ) : arrivals.list.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t("checkin.none")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {arrivals.list.map((b) => {
                const started = new Date(b.startTime) <= new Date();
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {formatTime(b.startTime, venue?.timezone)}–{formatTime(b.endTime, venue?.timezone)} · {b.source === "WALK_IN" ? b.guestName : b.user.name}
                      </p>
                      <p className="font-mono text-xs text-slate-400">{b.bookingCode}</p>
                    </div>
                    {b.checkedInAt ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-brand-700"><CheckCircle2 aria-hidden="true" className="h-4 w-4" /> {formatTime(b.checkedInAt, venue?.timezone)}</span>
                    ) : b.noShow ? (
                      <button type="button" onClick={async () => { await setNoShow(b.id, false); setReload((v) => v + 1); }} className="text-xs font-semibold text-rose-600 hover:underline">
                        {t("checkin.noShowUndo")}
                      </button>
                    ) : (
                      <span className="flex gap-2">
                        {b.bookingCode ? (
                          <button type="button" onClick={() => void submit(b.bookingCode!)} className={`${btnSecondary} whitespace-nowrap`}>{t("checkin.checkIn")}</button>
                        ) : null}
                        {started ? (
                          <button type="button" onClick={async () => { await setNoShow(b.id, true); setReload((v) => v + 1); }} className="text-xs font-semibold text-slate-500 hover:underline">
                            {t("checkin.noShow")}
                          </button>
                        ) : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
