import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminBookings } from "../../services/admin.api";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { Badge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { rupees } from "../../lib/admin";
import { alertError, tableCard, inputWidth } from "../../lib/ui";
import { formatDateTime } from "../../lib/datetime";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import EmptyState from "../../components/ui/EmptyState";
import { CalendarX2 } from "lucide-react";

const th = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

function AdminBookings() {
  const [params] = useSearchParams();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error } = useLoad(
    JSON.stringify({ page, q, status }),
    () => getAdminBookings({ page, q, status }),
    translate("mybook.loadFailed")
  );
  const bookings = data?.items ?? [];

  return (
    <div>
      <PageHeader title={t("abook.title")} description={t("abook.subtitle")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("abook.searchPlaceholder")}
          aria-label={t("abook.search")}
          className={`${inputWidth("w-72")}`}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className={`${inputWidth("w-auto")}`}
          aria-label={t("common.status")}
        >
          <option value="">{t("ausers.anyStatus")}</option>
          {(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"] as const).map((value) => (
            <option key={value} value={value}>{t(`status.${value}`)}</option>
          ))}
        </select>
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>

      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      <div className={tableCard}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("abook.code")}</th>
                <th className={th}>{t("common.customer")}</th>
                <th className={th}>{t("common.venue")}</th>
                <th className={th}>{t("detail.when")}</th>
                <th className={`${th} text-right`}>{t("common.price")}</th>
                <th className={th}>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-700">{booking.bookingCode ?? "—"}</td>
                  <td className="px-6 py-4">
                    {booking.source === "ONLINE" ? (
                      <>
                        <Link to={`/admin/users/${booking.user.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700 hover:underline">
                          {booking.user.name}
                        </Link>
                        <div className="text-sm text-slate-500">{booking.user.email}</div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-700">
                        {booking.guestName ?? (booking.source === "BLOCK" ? t("pbook.blocked") : t("source.WALK_IN"))}
                        <Badge tone="grey">{booking.source === "BLOCK" ? t("source.BLOCK") : t("source.WALK_IN")}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-900">{booking.venue.name}</div>
                    <Link to={`/admin/users/${booking.venue.owner.id}`} className="text-sm text-slate-500 hover:text-brand-700 hover:underline">
                      {booking.venue.owner.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                    {formatDateTime(booking.startTime, booking.venue.timezone)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-slate-700">
                    {booking.totalPrice === null ? "—" : rupees(booking.totalPrice)}
                    {booking.coupon ? (
                      <div className="text-xs text-brand-700">{booking.coupon.code} −{rupees(booking.discountAmount)}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <StatusBadge status={booking.status} />
                  </td>
                </tr>
              ))}
              {data && bookings.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState bare icon={CalendarX2} title={t("abook.none")} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
    </div>
  );
}

export default AdminBookings;
