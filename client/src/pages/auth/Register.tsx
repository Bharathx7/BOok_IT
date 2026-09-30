import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import AuthLayout from "../../components/layout/AuthLayout";
import { alertError, alertSuccess, btnPrimary, input, label } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import Trans from "../../i18n/Trans";

function Register() {
  const { register } = useAuth();
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const user = await register({
        name,
        email,
        password,
      });

      setRegisteredEmail(user.email);
    } catch (error) {
      setError(getErrorMessage(error, t("register.failed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={t("register.eyebrow")}
      heading={t("register.heading")}
      blurb={t("register.blurb")}
      footnote={t("register.footnote")}
      title={registeredEmail ? t("register.checkEmail") : t("register.title")}
      subtitle={registeredEmail ? undefined : t("register.subtitle")}
    >
      {registeredEmail ? (
        <>
          <div className={`mt-5 ${alertSuccess}`}>
            <Trans k="register.sent" values={{ email: <strong>{registeredEmail}</strong> }} />
          </div>

          <Link to="/login" className={`mt-6 block w-full text-center ${btnPrimary}`}>
            {t("register.goToSignIn")}
          </Link>
        </>
      ) : (
        <>
          {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="name" className={label}>
                {t("common.name")}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className={input}
                placeholder={t("register.namePlaceholder")}
              />
            </div>

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

            <div>
              <label htmlFor="password" className={label}>
                {t("common.password")}
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

            <button type="submit" disabled={loading} className={`w-full ${btnPrimary}`}>
              {loading ? t("register.submitting") : t("register.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            {t("register.haveAccount")}{" "}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              {t("register.signIn")}
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

export default Register;
