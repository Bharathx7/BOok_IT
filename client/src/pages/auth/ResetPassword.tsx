import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthLayout from "../../components/layout/AuthLayout";
import { useAuth } from "../../context/useAuth";
import { resetPassword } from "../../services/auth.api";
import { alertError, alertSuccess, btnPrimary, input, label } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { user, logout } = useAuth();
  const { t } = useI18n();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(token ? "" : t("reset.missingToken"));
  const [doneMessage, setDoneMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError(t("reset.mismatch"));
      return;
    }

    setError("");
    setLoading(true);

    try {
      const message = await resetPassword(token, password);
      // Every session was revoked on the server; drop this tab's too.
      if (user) {
        await logout();
      }
      setDoneMessage(message);
    } catch (err) {
      setError(getErrorMessage(err, t("reset.failed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={t("forgot.eyebrow")}
      heading={t("reset.heading")}
      blurb={t("reset.blurb")}
      footnote={t("reset.footnote")}
      title={doneMessage ? t("reset.done") : t("reset.title")}
    >
      {doneMessage ? (
        <>
          <div className={`mt-5 ${alertSuccess}`}>{doneMessage}</div>
          <Link to="/login" className={`mt-6 block w-full text-center ${btnPrimary}`}>
            {t("register.goToSignIn")}
          </Link>
        </>
      ) : (
        <>
          {error ? (
            <div className={`mt-5 ${alertError}`}>
              {error}{" "}
              <Link to="/forgot-password" className="font-semibold underline">
                {t("reset.newLink")}
              </Link>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="password" className={label}>
                {t("reset.newPassword")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={input}
                placeholder={t("register.passwordPlaceholder")}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className={label}>
                {t("reset.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                className={input}
              />
            </div>

            <button type="submit" disabled={loading || !token} className={`w-full ${btnPrimary}`}>
              {loading ? t("common.saving") : t("reset.submit")}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

export default ResetPassword;
