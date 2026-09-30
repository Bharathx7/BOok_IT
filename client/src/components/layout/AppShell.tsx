import { Suspense, useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar, { MobileDrawer } from "./Sidebar";
import VerifyEmailBanner from "./VerifyEmailBanner";
import OfflineBanner from "./OfflineBanner";
import { useI18n } from "../../i18n/useI18n";

function AppShell() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("nav.skipToContent")}
      </a>

      <Sidebar />
      <MobileDrawer open={menuOpen} onClose={closeMenu} />

      <div className="lg:pl-64">
        <Navbar onOpenMenu={() => setMenuOpen(true)} />
        <main id="main" tabIndex={-1} className="px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">
            <OfflineBanner />
            <VerifyEmailBanner />
            <Suspense fallback={<p className="py-10 text-center text-sm text-slate-400" role="status">{t("common.loading")}</p>}>
              <div className="animate-rise">
                <Outlet />
              </div>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
