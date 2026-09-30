import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import AuthLayout from "../../components/layout/AuthLayout";
import { homePathFor } from "../../routes/homePath";
import { alertError, btnPrimary, input, label } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Where the user was heading before being sent here, if anywhere.
  const from = (location.state as { from?: string } | null)?.from;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const user = await login({
        email,
        password,
      });

      const home = homePathFor(user.role);
      const canReturn = from && (from.startsWith(home) || from.startsWith("/invites/"));
      navigate(canReturn ? from : home, { replace: true });
    } catch (error) {
      setError(getErrorMessage(error, t("login.failed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={t("auth.eyebrow")}
      heading={t("auth.heading")}
      blurb={t("auth.blurb")}
      footnote={t("auth.footnote")}
      title={t("login.title")}
      subtitle={t("login.subtitle")}
    >
      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label htmlFor="email" className={label}>
            {t("login.email")}
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

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className={label}>
              {t("login.password")}
            </label>
            <Link
              to="/forgot-password"
              className="mb-1.5 text-xs font-semibold text-brand-700 hover:underline"
            >
              {t("login.forgot")}
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className={input}
            placeholder={t("login.passwordPlaceholder")}
          />
        </div>

        <button type="submit" disabled={loading} className={`w-full ${btnPrimary}`}>
          {loading ? t("login.submitting") : t("login.submit")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {t("login.noAccount")}{" "}
        <Link to="/register" className="font-semibold text-brand-700 hover:underline">
          {t("login.createOne")}
        </Link>
      </p>
    </AuthLayout>
  );
}

export default Login;
