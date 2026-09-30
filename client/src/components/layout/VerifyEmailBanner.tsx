import { useState } from "react";
import { useAuth } from "../../context/useAuth";
import { resendVerificationEmail } from "../../services/auth.api";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import Trans from "../../i18n/Trans";

/** Reminds signed-in users to confirm their email; booking needs it. */
function VerifyEmailBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  if (!user || user.emailVerified) {
    return null;
  }

  async function handleResend() {
    setState("sending");
    setError("");

    try {
      await resendVerificationEmail();
      setState("sent");
    } catch (err) {
      setError(getErrorMessage(err, t("verify.sendFailed")));
      setState("idle");
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        <Trans k="verify.banner" values={{ email: <strong>{user.email}</strong> }} />
        {error ? <span className="ml-1 text-rose-700">{error}</span> : null}
      </p>

      {state === "sent" ? (
        <span className="shrink-0 font-semibold">{t("verify.linkSent")}</span>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={state === "sending"}
          className="shrink-0 font-semibold underline disabled:opacity-60"
        >
          {state === "sending" ? t("verify.sending") : t("verify.resend")}
        </button>
      )}
    </div>
  );
}

export default VerifyEmailBanner;
