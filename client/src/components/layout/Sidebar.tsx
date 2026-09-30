import { useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Heart,
  LayoutDashboard,
  LogOut,
  MapPinned,
  QrCode,
  ScrollText,
  Search,
  Settings,
  Star,
  Store,
  Ticket,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../context/useAuth";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/useI18n";
import { translateOr } from "../../i18n/translate";
import { initials } from "../../lib/ui";
import Logo from "./Logo";

type MenuItem = { label: MessageKey; path: string; icon: LucideIcon };
type MenuGroup = { label: MessageKey; items: MenuItem[] };

const customerMenu: MenuGroup[] = [
  {
    label: "nav.group.main",
    items: [
      { label: "nav.dashboard", path: "/customer", icon: LayoutDashboard },
      { label: "nav.browseVenues", path: "/customer/venues", icon: Search },
      { label: "nav.myBookings", path: "/customer/bookings", icon: CalendarDays },
      { label: "nav.favourites", path: "/customer/favorites", icon: Heart },
      { label: "nav.reviews", path: "/customer/reviews", icon: Star },
    ],
  },
];

const providerMenu: MenuGroup[] = [
  {
    label: "nav.group.overview",
    items: [
      { label: "nav.dashboard", path: "/provider", icon: LayoutDashboard },
      { label: "nav.analytics", path: "/provider/analytics", icon: BarChart3 },
      { label: "nav.earnings", path: "/provider/earnings", icon: Wallet },
    ],
  },
  {
    label: "nav.group.operations",
    items: [
      { label: "nav.bookings", path: "/provider/bookings", icon: ClipboardList },
      { label: "nav.calendar", path: "/provider/calendar", icon: CalendarDays },
      { label: "nav.checkIn", path: "/provider/check-in", icon: QrCode },
      { label: "nav.timeSlots", path: "/provider/time-slots", icon: CalendarClock },
    ],
  },
  {
    label: "nav.group.venues",
    items: [
      { label: "nav.myVenues", path: "/provider/venues", icon: Store },
      { label: "nav.reviews", path: "/provider/reviews", icon: Star },
    ],
  },
];

const adminMenu: MenuGroup[] = [
  {
    label: "nav.group.overview",
    items: [
      { label: "nav.dashboard", path: "/admin", icon: LayoutDashboard },
      { label: "nav.analytics", path: "/admin/analytics", icon: BarChart3 },
      { label: "nav.payments", path: "/admin/payments", icon: CreditCard },
    ],
  },
  {
    label: "nav.group.people",
    items: [
      { label: "nav.users", path: "/admin/users", icon: Users },
      { label: "nav.providers", path: "/admin/providers", icon: Building2 },
    ],
  },
  {
    label: "nav.group.marketplace",
    items: [
      { label: "nav.venues", path: "/admin/venues", icon: MapPinned },
      { label: "nav.bookings", path: "/admin/bookings", icon: ClipboardList },
      { label: "nav.reviews", path: "/admin/reviews", icon: Star },
      { label: "nav.coupons", path: "/admin/coupons", icon: Ticket },
    ],
  },
  {
    label: "nav.group.system",
    items: [
      { label: "nav.auditLog", path: "/admin/audit", icon: ScrollText },
      { label: "nav.settings", path: "/admin/settings", icon: Settings },
    ],
  },
];

function useMenu() {
  const { user } = useAuth();
  if (user?.role === "USER") return customerMenu;
  if (user?.role === "PROVIDER") return providerMenu;
  if (user?.role === "ADMIN") return adminMenu;
  return [];
}

const isDashboardPath = (path: string) => path === "/customer" || path === "/provider" || path === "/admin";

const profilePath = (role: string) =>
  role === "ADMIN" ? "/admin/profile" : role === "PROVIDER" ? "/provider/profile" : "/customer/profile";

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const menu = useMenu();
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo tone="light" />
      </div>

      {/* Sized to fit every role's menu without scrolling; on very short windows it
          tightens further, and any leftover overflow scrolls with no visible bar. */}
      <nav
        aria-label={t("nav.menu")}
        className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3 [@media(max-height:760px)]:space-y-3 [@media(max-height:760px)]:py-2"
      >
        {menu.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-sidebar-muted">
              {t(group.label)}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={isDashboardPath(item.path)}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm font-medium transition [@media(max-height:760px)]:py-1.5 ${
                        isActive
                          ? "bg-white/10 text-white"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400" aria-hidden /> : null}
                        <item.icon
                          className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-brand-300" : "text-slate-400 group-hover:text-slate-200"}`}
                          aria-hidden
                        />
                        {t(item.label)}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {user ? (
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-1">
            {/* The profile lives here rather than as its own menu group. */}
            <NavLink
              to={profilePath(user.role)}
              onClick={onNavigate}
              title={t("nav.profile")}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition ${isActive ? "bg-white/10" : "hover:bg-white/5"}`
              }
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500/20 text-xs font-semibold text-brand-200 ring-1 ring-white/10">
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
                <span className="block truncate text-xs text-sidebar-muted">
                  {translateOr(`role.${user.role}`, user.role)} · {t("nav.profile")}
                </span>
              </span>
            </NavLink>
            <button
              type="button"
              onClick={() => void handleLogout()}
              title={t("nav.logout")}
              aria-label={t("nav.logout")}
              className="rounded-md p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Fixed navy sidebar on large screens. */
function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar [color-scheme:dark] lg:block">
      <SidebarContent />
    </aside>
  );
}

/** The same menu as a slide-in drawer on small screens. */
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const location = useLocation();

  // Close when the route changes or Escape is pressed.
  useEffect(() => onClose(), [location.pathname, onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-950/50 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar [color-scheme:dark] transition-transform duration-200 ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-4 rounded-md p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        {open ? <SidebarContent onNavigate={onClose} /> : null}
      </aside>
    </div>
  );
}

export default Sidebar;
