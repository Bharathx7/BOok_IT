import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AuthLayout from "../components/layout/AuthLayout";
import { useAuth } from "../context/useAuth";
import { getInvite, respondToInvite, type Invite } from "../services/features.api";
import { formatTimeRange } from "../lib/datetime";
import { alertError, alertSuccess, btnPrimary, btnSecondary } from "../lib/ui";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../i18n/useI18n";
import Trans from "../i18n/Trans";
import { translate } from "../i18n/translate";

/** Public page behind the link in an invite email. */
function InviteResponse() {
  const { token = "" } = useParams<{ token: string }>();
  const { user } = useAuth();
  const { t } = useI18n();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ status: string; bookingId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInvite(token)
      .then((data) => {
        if (!cancelled) setInvite(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("invite.invalid")));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function respond(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      setResult(await respondToInvite(token, accept));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const status = result?.status ?? invite?.status;

  return (
    <AuthLayout
      eyebrow={t("invite.eyebrow")}
      heading={t("invite.heading")}
      blurb={t("invite.blurb")}
      footnote={t("invite.footnote")}
      title={invite ? t("invite.title", { name: invite.organiser }) : t("invite.titlePlain")}
    >
      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

      {invite ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">{invite.venue.name}</p>
            <p className="text-slate-600">{formatTimeRange(invite.startTime, invite.endTime, invite.venue.timezone)}</p>
            {invite.venue.address ? <p className="text-slate-500">{invite.venue.address}</p> : null}
          </div>

          {status === "ACCEPTED" ? (
            <div className={alertSuccess}>
              {t("invite.in")} {user && result ? <Link to={`/customer/bookings/${result.bookingId}`} className="font-semibold underline">{t("invite.see")}</Link> : null}
            </div>
          ) : status === "DECLINED" ? (
            <div className="text-sm text-slate-600">{t("invite.declined")}</div>
          ) : null}

          {status !== "ACCEPTED" ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => respond(true)} className={`flex-1 ${btnPrimary}`}>{t("invite.accept")}</button>
              {status !== "DECLINED" ? (
                <button type="button" disabled={busy} onClick={() => respond(false)} className={`flex-1 ${btnSecondary}`}>{t("invite.decline")}</button>
              ) : null}
            </div>
          ) : null}

          {!user ? (
            <p className="text-xs text-slate-500">
              <Trans
                k="invite.signIn"
                values={{
                  link: (
                    <Link to="/login" state={{ from: `/invites/${token}` }} className="font-semibold text-brand-700">
                      {t("invite.signInLink")}
                    </Link>
                  ),
                }}
              />
            </p>
          ) : null}
        </div>
      ) : !error ? (
        <p className="mt-5 text-sm text-slate-500">{t("common.loading")}</p>
      ) : null}
    </AuthLayout>
  );
}

export default InviteResponse;
