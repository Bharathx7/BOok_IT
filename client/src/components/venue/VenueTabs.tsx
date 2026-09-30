import { NavLink } from "react-router-dom";
import { CalendarClock, IndianRupee, SlidersHorizontal } from "lucide-react";
import { useI18n } from "../../i18n/useI18n";

/** Details / Schedule / Pricing tabs of a provider's venue. */
function VenueTabs({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const tabs = [
    { label: t("vtabs.details"), to: `/provider/venues/${venueId}/edit`, icon: SlidersHorizontal },
    { label: t("vtabs.schedule"), to: `/provider/venues/${venueId}/schedule`, icon: CalendarClock },
    { label: t("vtabs.pricing"), to: `/provider/venues/${venueId}/pricing`, icon: IndianRupee },
  ];

  return (
    <nav className="no-scrollbar -mt-2 mb-6 flex gap-6 overflow-x-auto border-b border-slate-200">
      {tabs.map(({ label, to, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm font-semibold transition ${
              isActive ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
            }`
          }
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default VenueTabs;
