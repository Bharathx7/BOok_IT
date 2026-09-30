import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/useI18n";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

interface AuthLayoutProps {
  eyebrow: string;
  heading: string;
  blurb: string;
  footnote: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Split-screen frame shared by the sign-in, sign-up and account-recovery pages. */
function AuthLayout({ eyebrow, heading, blurb, footnote, title, subtitle, children }: AuthLayoutProps) {
  const { t } = useI18n();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Soft glow and a faint grid behind the copy. */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-sky-500/20 blur-3xl" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />

        <div className="relative">
          <Logo tone="light" />
        </div>

        <div className="relative max-w-lg">
          <p className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-200">
            {eyebrow}
          </p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.15] tracking-tight xl:text-5xl">{heading}</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">{blurb}</p>

          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            {(["auth.feature1", "auth.feature2", "auth.feature3"] as const).map((key) => (
              <li key={key} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-300" aria-hidden />
                {t(key)}
              </li>
            ))}
          </ul>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {[
              ["24+", "auth.statVenues"],
              ["8", "auth.statCities"],
              ["< 1 min", "auth.statInstant"],
            ].map(([value, key]) => (
              <div key={key}>
                <dt className="text-xs text-sidebar-muted">{t(key as "auth.statVenues")}</dt>
                <dd className="mt-1 text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-sidebar-muted">{footnote}</p>
      </div>

      <div className="relative flex flex-col bg-white">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-6">
          <span className="lg:invisible">
            <Logo showTagline={false} />
          </span>
          <span className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <div className="w-full max-w-[26rem] animate-rise">
            <h1 className="text-[1.75rem] font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
