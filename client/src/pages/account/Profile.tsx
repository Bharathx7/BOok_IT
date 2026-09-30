import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { useAuth } from "../../context/useAuth";
import { changePassword, resendVerificationEmail, updateMe } from "../../services/auth.api";
import {
  alertError,
  alertSuccess,
  btnDanger,
  btnPrimary,
  btnSecondary,
  card,
  initials,
  input,
  label,
} from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";

function ProfileDetails() {
  const { t } = useI18n();
  const { user, setUser } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (!user) return null;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      setUser(await updateMe({ name, phone, avatarUrl }));
      setSuccess(t("profile.saved"));
    } catch (err) {
      setError(getErrorMessage(err, t("profile.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleResend() {
    setError("");
    setSuccess("");
    setSending(true);

    try {
      await resendVerificationEmail();
      setSuccess(t("profile.linkSent", { email: user!.email }));
    } catch (err) {
      setError(getErrorMessage(err, t("profile.sendFailed")));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-4">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-14 w-14 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-base font-semibold text-brand-800">
            {initials(user.name)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{user.email}</p>
          {user.emailVerified ? (
            <p className="text-sm text-brand-700">{t("verify.done")}</p>
          ) : (
            <p className="text-sm text-amber-700">
              {t("profile.notVerified")}{" "}
              <button
                type="button"
                onClick={handleResend}
                disabled={sending}
                className="font-semibold underline disabled:opacity-60"
              >
                {sending ? t("profile.resending") : t("profile.resend")}
              </button>
            </p>
          )}
        </div>
      </div>

      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}
      {success ? <div className={`mt-5 ${alertSuccess}`}>{success}</div> : null}

      <form onSubmit={handleSave} className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={label}>
            {t("common.name")}
          </label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            className={input}
          />
        </div>

        <div>
          <label htmlFor="phone" className={label}>
            {t("common.phone")} <span className="font-normal text-slate-400">({t("common.optional")})</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={input}
            placeholder="+91 98765 43210"
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className={label}>
            {t("profile.photo")} <span className="font-normal text-slate-400">({t("common.optional")})</span>
          </label>
          <input
            id="avatarUrl"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            className={input}
            placeholder="https://..."
          />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? t("common.saving") : t("profile.save")}
          </button>
        </div>
      </form>
    </section>
  );
}

function ChangePassword() {
  const { t } = useI18n();
  const { applySession } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError(t("profile.mismatch"));
      return;
    }

    setSaving(true);

    try {
      const session = await changePassword(currentPassword, newPassword);
      applySession(session.user, session.accessToken);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(t("profile.pwChanged"));
    } catch (err) {
      setError(getErrorMessage(err, t("profile.pwFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("profile.changePw")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("profile.changePwHint")}
      </p>

      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}
      {success ? <div className={`mt-5 ${alertSuccess}`}>{success}</div> : null}

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="currentPassword" className={label}>
            {t("profile.currentPw")}
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            className={input}
          />
        </div>

        <div>
          <label htmlFor="newPassword" className={label}>
            {t("reset.newPassword")}
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            className={input}
          />
        </div>

        <div>
          <label htmlFor="confirmNewPassword" className={label}>
            {t("reset.confirmPassword")}
          </label>
          <input
            id="confirmNewPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            className={input}
          />
        </div>

        <div className="sm:col-span-3">
          <button type="submit" disabled={saving} className={btnSecondary}>
            {saving ? t("profile.changing") : t("profile.changePw")}
          </button>
        </div>
      </form>
    </section>
  );
}

function Sessions() {
  const { t } = useI18n();
  const { logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleLogoutEverywhere() {
    if (!window.confirm(t("profile.confirmSignOut"))) {
      return;
    }

    setWorking(true);
    setError("");

    try {
      await logoutEverywhere();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, t("profile.signOutFailed")));
      setWorking(false);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("profile.devices")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("profile.devicesHint")}
      </p>

      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

      <button
        type="button"
        onClick={handleLogoutEverywhere}
        disabled={working}
        className={`mt-5 ${btnDanger}`}
      >
        {working ? t("profile.signingOut") : t("profile.signOutAll")}
      </button>
    </section>
  );
}

function Profile() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("nav.profile")} description={t("profile.subtitle")} />

      <div className="space-y-6">
        <ProfileDetails />
        <ChangePassword />
        <Sessions />
      </div>
    </div>
  );
}

export default Profile;
