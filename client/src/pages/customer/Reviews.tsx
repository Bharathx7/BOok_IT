import { useEffect, useState } from "react";
import { createReview } from "../../services/review.api";
import { getBookings, type Booking } from "../../services/booking.api";
import PageHeader from "../../components/ui/PageHeader";
import { getErrorMessage } from "../../lib/errors";
import { fetchAllPages } from "../../lib/pagination";
import {
  alertError,
  btnPrimary,
  btnSecondary,
  card,
  input,
  label,
  } from "../../lib/ui";
import { formatDateTime } from "../../lib/datetime";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import EmptyState from "../../components/ui/EmptyState";
import { MessageSquareCheck, Star } from "lucide-react";

function Reviews() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadBookings = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchAllPages(getBookings);
        setBookings(data);
      } catch (err) {
        console.error("Failed to load bookings:", err);
        setError(getErrorMessage(err, translate("mybook.loadFailed")));
      } finally {
        setLoading(false);
      }
    };

    loadBookings();
  }, []);

  const completedBookings = bookings.filter(
    (booking) => booking.status === "COMPLETED"
  );
  const pendingReviews = completedBookings.filter((booking) => !booking.review);
  const submittedReviews = completedBookings.filter((booking) => booking.review);

  const handleSubmit = async () => {
    if (!selectedBooking) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const createdReview = await createReview({
        bookingId: selectedBooking.id,
        rating,
        review: reviewText.trim() || undefined,
      });

      setBookings((currentBookings) =>
        currentBookings.map((booking) =>
          booking.id === selectedBooking.id
            ? {
                ...booking,
                review: {
                  id: createdReview.id,
                  rating: createdReview.rating,
                  review: createdReview.review,
                },
              }
            : booking
        )
      );

      setSelectedBooking(null);
      setRating(5);
      setReviewText("");
    } catch (err) {
      console.error("Failed to create review:", err);
      setError(getErrorMessage(err, t("rev.submitFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageHeader title={t("nav.reviews")} description={t("rev.loading")} />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("nav.reviews")}
        description={t("rev.subtitle")}
      />

      {error && !selectedBooking ? (
        <div className={`mb-6 ${alertError}`}>{error}</div>
      ) : null}

      {pendingReviews.length === 0 ? (
        <EmptyState
          icon={completedBookings.length === 0 ? Star : MessageSquareCheck}
          title={completedBookings.length === 0 ? t("rev.noneCompleted") : t("rev.allDone")}
        />
      ) : (
        <div className="space-y-4">
          {pendingReviews.map((booking) => (
            <div key={booking.id} className={card}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {booking.venue.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDateTime(booking.startTime, booking.venue.timezone)}
                  </p>
                  <p className="mt-2">
                    <StatusBadge status={booking.status} />
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setSelectedBooking(booking);
                  }}
                  className={btnPrimary}
                >
                  {t("rev.leave")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {submittedReviews.length > 0 ? (
        <div className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            {t("rev.yours")}
          </h2>
          <div className="space-y-4">
            {submittedReviews.map((booking) => (
              <div key={booking.id} className={card}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {booking.venue.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDateTime(booking.startTime, booking.venue.timezone)}
                    </p>
                    {booking.review?.review ? (
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {booking.review.review}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                    {booking.review?.rating}/5
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedBooking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-slate-900">{t("cdash.review")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("rev.experienceAt")}{" "}
              <span className="font-semibold text-slate-700">
                {selectedBooking.venue.name}
              </span>
            </p>

            {error ? <div className={`mt-4 ${alertError}`}>{error}</div> : null}

            <div className="mt-5">
              <label className={label}>{t("browse.rating")}</label>
              <select
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
                className={input}
              >
                <option value={5}>5 - {t("rev.score5")}</option>
                <option value={4}>4 - {t("rev.score4")}</option>
                <option value={3}>3 - {t("rev.score3")}</option>
                <option value={2}>2 - {t("rev.score2")}</option>
                <option value={1}>1 - {t("rev.score1")}</option>
              </select>
            </div>

            <div className="mt-4">
              <label className={label}>{t("rev.yourReview")}</label>
              <textarea
                value={reviewText}
                onChange={(event) => setReviewText(event.target.value)}
                placeholder={t("rev.placeholder")}
                rows={5}
                className={`${input} resize-none`}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setSelectedBooking(null);
                }}
                disabled={submitting}
                className={btnSecondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className={btnPrimary}
              >
                {submitting ? t("rev.submitting") : t("rev.submit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Reviews;
