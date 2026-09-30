import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../../components/layout/AuthLayout";
import { requestPasswordReset } from "../../services/auth.api";
import { alertError, alertSuccess, btnPrimary, input, label } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";

function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentMessage, setSentMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      setSentMessage(await requestPasswordReset(email));
    } catch (err) {
      setError(getErrorMessage(err, t("forgot.failed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={t("forgot.eyebrow")}
      heading={t("forgot.heading")}
      blurb={t("forgot.blurb")}
      footnote={t("forgot.footnote")}
      title={t("forgot.title")}
      subtitle={sentMessage ? undefined : t("forgot.subtitle")}
    >
      {sentMessage ? (
        <div className={`mt-5 ${alertSuccess}`}>
          {sentMessage} {t("forgot.checkInbox")}
        </div>
      ) : (
        <>
          {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="email" className={label}>
                {t("common.email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className={input}
                placeholder="you@example.com"
              />
            </div>

            <button type="submit" disabled={loading} className={`w-full ${btnPrimary}`}>
              {loading ? t("forgot.submitting") : t("forgot.submit")}
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        {t("forgot.remembered")}{" "}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          {t("forgot.backToSignIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}

export default ForgotPassword;
