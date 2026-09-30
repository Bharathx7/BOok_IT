import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthLayout from "../../components/layout/AuthLayout";
import { useAuth } from "../../context/useAuth";
import { homePathFor } from "../../routes/homePath";
import { verifyEmail, type User } from "../../services/auth.api";
import { alertError, alertSuccess, btnPrimary } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";

// Links are single-use, and React runs effects twice in development, so each
// token is only ever sent once per page load.
const verifications = new Map<string, Promise<User>>();

function verifyOnce(token: string) {
  let pending = verifications.get(token);

  if (!pending) {
    pending = verifyEmail(token);
    verifications.set(token, pending);
  }

  return pending;
}

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, setUser } = useAuth();
  const { t } = useI18n();

  const [status, setStatus] = useState<"verifying" | "done" | "failed">(
    token ? "verifying" : "failed"
  );
  const [error, setError] = useState(token ? "" : t("verify.missingToken"));

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    verifyOnce(token)
      .then((verifiedUser) => {
        if (cancelled) return;
        setStatus("done");
        // Update the signed-in user's banner if it's the same account.
        if (user?.id === verifiedUser.id) {
          setUser(verifiedUser);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("failed");
        setError(getErrorMessage(err, translate("verify.invalid")));
      });

    return () => {
      cancelled = true;
    };
  }, [token, user?.id, setUser]);

  const continuePath = user ? homePathFor(user.role) : "/login";

  return (
    <AuthLayout
      eyebrow={t("verify.eyebrow")}
      heading={t("verify.heading")}
      blurb={t("verify.blurb")}
      footnote={t("verify.footnote")}
      title={
        status === "verifying"
          ? t("verify.verifying")
          : status === "done"
            ? t("verify.done")
            : t("verify.failedTitle")
      }
    >
      {status === "done" ? (
        <div className={`mt-5 ${alertSuccess}`}>{t("verify.thanks")}</div>
      ) : null}

      {status === "failed" ? (
        <div className={`mt-5 ${alertError}`}>
          {error} {user ? t("verify.resendFromProfile") : t("verify.signInToResend")}
        </div>
      ) : null}

      {status !== "verifying" ? (
        <Link to={continuePath} className={`mt-6 block w-full text-center ${btnPrimary}`}>
          {user ? t("verify.continue") : t("register.goToSignIn")}
        </Link>
      ) : null}
    </AuthLayout>
  );
}

export default VerifyEmail;
