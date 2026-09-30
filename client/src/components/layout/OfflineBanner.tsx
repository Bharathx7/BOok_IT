import { useSyncExternalStore } from "react";
import { useI18n } from "../../i18n/useI18n";

const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/** Tells people why nothing loads while their connection is down. */
function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const { t } = useI18n();
  if (online) return null;

  return (
    <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {t("offline.banner")}
    </div>
  );
}

export default OfflineBanner;
