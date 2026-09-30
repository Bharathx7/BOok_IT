import type { CookieOptions, Request, Response } from "express";

import { env } from "../config/env.js";
import {
  changePassword,
  getProfile,
  login,
  logout,
  logoutAll,
  refreshSession,
  register,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  updateProfile,
  verifyEmail,
  type Session,
} from "../services/auth.service.js";
import { recordAudit } from "../services/audit.service.js";

// The refresh token lives only in this httpOnly cookie - never in the JSON
// body - so page scripts (and XSS) can't read it. Its path is /api so it
// reaches the auth endpoints under both /api/v1 and the old /api prefix. In production the frontend proxies /api to the backend, so the
// cookie is first-party and SameSite=Lax is enough to stop cross-site use.
export const REFRESH_COOKIE = "bookit_rt";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api",
};

// Cookies issued before API versioning were scoped to this path.
const LEGACY_COOKIE_PATH = "/api/auth";

const readRefreshCookie = (req: Request): string | undefined => {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const userAgentOf = (req: Request) => req.get("user-agent") ?? undefined;

/** Sets the refresh cookie and returns what the client may see. */
const sendSession = (res: Response, session: Session, status = 200) => {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions,
    expires: session.refreshTokenExpiresAt,
  });

  return res.status(status).json({
    user: session.user,
    accessToken: session.accessToken,
  });
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, path: LEGACY_COOKIE_PATH });
};

export async function registerController(req: Request, res: Response) {
  const { name, email, password } = req.body;

  const user = await register(name, email, password);

  return res.status(201).json({
    message: "Registration successful. Check your email to verify your address.",
    user,
  });
}

export async function loginController(req: Request, res: Response) {
  const { email, password } = req.body;

  return sendSession(res, await login(email, password, userAgentOf(req)));
}

export async function refreshTokenController(req: Request, res: Response) {
  const token = readRefreshCookie(req);

  // No cookie at all is a signed-out visitor, not an error: every page load
  // checks for a session, and a 401 here would log a console error each time.
  if (!token) {
    return res.status(204).end();
  }

  try {
    return sendSession(res, await refreshSession(token, userAgentOf(req)));
  } catch (error) {
    // A dead refresh cookie is useless; drop it so the browser stops sending it.
    clearRefreshCookie(res);
    throw error;
  }
}

export async function logoutController(req: Request, res: Response) {
  await logout(readRefreshCookie(req));
  clearRefreshCookie(res);

  return res.status(204).end();
}

export async function logoutAllController(req: Request, res: Response) {
  await logoutAll(req.user!.id);
  await recordAudit({ action: "auth.logout_all", entityType: "User", entityId: req.user!.id });
  clearRefreshCookie(res);

  return res.status(204).end();
}

export async function verifyEmailController(req: Request, res: Response) {
  const user = await verifyEmail(req.body.token);

  return res.status(200).json({ message: "Email verified", user });
}

export async function resendVerificationController(req: Request, res: Response) {
  await resendVerificationEmail(req.user!.id);

  return res.status(200).json({ message: "Verification email sent" });
}

export async function forgotPasswordController(req: Request, res: Response) {
  await requestPasswordReset(req.body.email);

  return res.status(200).json({
    message: "If an account exists for that email, a reset link has been sent.",
  });
}

export async function resetPasswordController(req: Request, res: Response) {
  await resetPassword(req.body.token, req.body.password);
  clearRefreshCookie(res);

  return res.status(200).json({
    message: "Password updated. Please sign in with your new password.",
  });
}

export async function getMeController(req: Request, res: Response) {
  return res.status(200).json({ user: await getProfile(req.user!.id) });
}

export async function updateMeController(req: Request, res: Response) {
  return res.status(200).json({ user: await updateProfile(req.user!.id, req.body) });
}

export async function changePasswordController(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body;

  return sendSession(
    res,
    await changePassword(req.user!.id, currentPassword, newPassword, userAgentOf(req))
  );
}
