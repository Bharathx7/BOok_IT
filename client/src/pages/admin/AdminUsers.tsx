import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminUsers, type AdminUser, type UserRole } from "../../services/admin.api";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { Badge, UserStatusBadge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import type { Pagination } from "../../lib/pagination";
import { alertError, initials, tableCard, inputWidth } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate, translateOr } from "../../i18n/translate";
import EmptyState from "../../components/ui/EmptyState";
import { UsersRound } from "lucide-react";

const th = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

/** All accounts, or only one role (the Providers page). */
function AdminUsers({ role }: { role?: UserRole }) {
  const [params] = useSearchParams();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [roleFilter, setRoleFilter] = useState<string>(role ?? "");
  const [status, setStatus] = useState(() => params.get("status") ?? "");

  // Search after a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error } = useLoad(
    JSON.stringify({ page, q, roleFilter, status }),
    () => getAdminUsers({ page, q, role: roleFilter, status }),
    translate("ausers.loadFailed")
  );
  const users: AdminUser[] = data?.items ?? [];
  const pagination: Pagination | null = data?.pagination ?? null;

  const title = role === "PROVIDER" ? t("nav.providers") : t("nav.users");

  return (
    <div>
      <PageHeader
        title={title}
        description={role === "PROVIDER" ? t("ausers.providersHint") : t("ausers.usersHint")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("ausers.search")}
          aria-label={t("ausers.search")}
          className={`${inputWidth("w-64")}`}
        />
        {role ? null : (
          <select
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              setPage(1);
            }}
            className={`${inputWidth("w-auto")}`}
            aria-label={t("ausers.role")}
          >
            <option value="">{t("ausers.allRoles")}</option>
            <option value="USER">{t("ausers.customers")}</option>
            <option value="PROVIDER">{t("nav.providers")}</option>
            <option value="ADMIN">{t("ausers.admins")}</option>
          </select>
        )}
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
          <option value="ACTIVE">{t("userStatus.ACTIVE")}</option>
          <option value="SUSPENDED">{t("userStatus.SUSPENDED")}</option>
          <option value="BANNED">{t("userStatus.BANNED")}</option>
        </select>
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>

      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      <div className={tableCard}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("common.name")}</th>
                <th className={th}>{t("ausers.role")}</th>
                <th className={th}>{t("common.status")}</th>
                <th className={th}>{t("ausers.lastLogin")}</th>
                <th className={th}>{t("ausers.joined")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/80">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          user.role === "ADMIN" ? "bg-brand-600 text-white" : user.role === "PROVIDER" ? "bg-sky-100 text-sky-800" : "bg-brand-100 text-brand-700"
                        }`}
                      >
                        {initials(user.name)}
                      </span>
                      <div className="min-w-0">
                        <Link to={`/admin/users/${user.id}`} className="text-sm font-semibold text-slate-900 hover:text-brand-700">
                          {user.name}
                        </Link>
                        <div className="text-sm text-slate-500">
                          {user.email}
                          {user.emailVerifiedAt ? null : <span className="ml-2 text-xs font-medium text-amber-700">{t("ausers.unverified")}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <Badge tone={user.role === "ADMIN" ? "blue" : "grey"}>{translateOr(`role.${user.role}`, user.role)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <UserStatusBadge status={user.status} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString(currentLocale()) : t("ausers.never")}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                    {new Date(user.createdAt).toLocaleDateString(currentLocale())}
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState bare icon={UsersRound} title={t("ausers.none", { what: title.toLowerCase() })} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pager pagination={pagination} onPageChange={setPage} disabled={loading} />
    </div>
  );
}

export default AdminUsers;
