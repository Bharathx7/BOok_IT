import { Link } from "react-router-dom";
import { CalendarDays, Menu } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { homePathFor } from "../../routes/homePath";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/useI18n";
import { initials } from "../../lib/ui";
import Logo from "./Logo";

/** Top bar of the app: menu button and logo on small screens, tools on the right. */
function Navbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const profilePath = user ? `${homePathFor(user.role)}/profile` : "/login";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={t("nav.menu")}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Logo showTagline={false} />
      </div>
      <p className="hidden items-center gap-2 text-sm text-slate-500 lg:flex">
        <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
        {new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>

      <div className="flex items-center gap-2">
        <LanguageSwitcher className="hidden sm:block" />
        <ThemeToggle />
        <NotificationBell />
        <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />
        <Link
          to={profilePath}
          title={t("nav.profile")}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-2 ring-white transition hover:ring-brand-200"
        >
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user?.name)}
        </Link>
      </div>
    </header>
  );
}

export default Navbar;
