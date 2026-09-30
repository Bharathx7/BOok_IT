import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";

import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import type { User, VerificationTokenType } from "../generated/prisma/client.js";
import { runInBackground } from "../utils/background.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors.js";
import { generateAccessToken } from "../utils/jwt.js";
import { logger } from "../utils/logger.js";
import { generateOpaqueToken, hashToken } from "../utils/tokens.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email.service.js";
import { recordAudit } from "./audit.service.js";

const HOUR = 60 * 60 * 1000;
const EMAIL_VERIFY_TTL_MS = 24 * HOUR;
const PASSWORD_RESET_TTL_MS = HOUR;
const BCRYPT_ROUNDS = 12;

// Two tabs can refresh at the same moment with the same cookie. The loser
// finds its token already rotated; within this window that is treated as a
// harmless race instead of token theft.
const REUSE_GRACE_MS = 30 * 1000;

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
const INVALID_LINK = "This link is invalid or has expired";

export const toPublicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  emailVerified: user.emailVerifiedAt !== null,
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt,
});

export type PublicUser = ReturnType<typeof toPublicUser>;

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

// Emails are stored lowercased; the case-insensitive match also covers
// accounts created before normalisation was added.
const findUserByEmail = (email: string) =>
  prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
  });

export const assertAccountActive = (user: Pick<User, "status">) => {
  if (user.status === "SUSPENDED") {
    throw new ForbiddenError("Your account is suspended. Please contact support.");
  }

  if (user.status === "BANNED") {
    throw new ForbiddenError("Your account has been banned.");
  }
};

// ---------------------------------------------------------------------------
// Sessions (refresh tokens)
// ---------------------------------------------------------------------------

async function issueSession(
  user: User,
  options: { familyId?: string | undefined; userAgent?: string | undefined } = {}
): Promise<Session> {
  const refreshToken = generateOpaqueToken();
  const refreshTokenExpiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * HOUR
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId: options.familyId ?? randomUUID(),
      expiresAt: refreshTokenExpiresAt,
      userAgent: options.userAgent?.slice(0, 255) ?? null,
    },
  });

  return {
    user: toPublicUser(user),
    accessToken: generateAccessToken(user),
    refreshToken,
    refreshTokenExpiresAt,
  };
}

const revokeFamily = (familyId: string) =>
  prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

const revokeAllForUser = (userId: string) =>
  prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 * The old refresh token stops working. Presenting an already-rotated token
 * means it was copied, so the whole login (token family) is revoked.
 */
export async function refreshSession(
  refreshToken: string | undefined,
  userAgent?: string
): Promise<Session> {
  if (!refreshToken) {
    throw new UnauthorizedError("Not signed in");
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!stored) {
    throw new UnauthorizedError(SESSION_EXPIRED);
  }

  if (stored.revokedAt) {
    const sinceRevoked = Date.now() - stored.revokedAt.getTime();

    if (sinceRevoked > REUSE_GRACE_MS) {
      logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        "Refresh token reuse detected; revoking session family"
      );
      await revokeFamily(stored.familyId);
    }

    throw new UnauthorizedError(SESSION_EXPIRED);
  }

  if (stored.expiresAt <= new Date()) {
    throw new UnauthorizedError(SESSION_EXPIRED);
  }

  if (stored.user.status !== "ACTIVE") {
    await revokeAllForUser(stored.userId);
    assertAccountActive(stored.user);
  }

  // Only one concurrent request may rotate a given token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) {
    throw new UnauthorizedError(SESSION_EXPIRED);
  }

  return issueSession(stored.user, { familyId: stored.familyId, userAgent });
}

/** Signs out the device holding this refresh token. */
export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) {
    return;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    select: { familyId: true },
  });

  if (stored) {
    await revokeFamily(stored.familyId);
  }
}

/** Signs the user out on every device. */
export async function logoutAll(userId: string) {
  await revokeAllForUser(userId);
}

// ---------------------------------------------------------------------------
// Email links (verification and password reset)
// ---------------------------------------------------------------------------

async function createVerificationToken(
  userId: string,
  type: VerificationTokenType,
  ttlMs: number
) {
  const token = generateOpaqueToken();

  // Only the newest link of each type works.
  await prisma.verificationToken.deleteMany({
    where: { userId, type, usedAt: null },
  });

  await prisma.verificationToken.create({
    data: {
      userId,
      type,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return token;
}

async function consumeVerificationToken(token: string, type: VerificationTokenType) {
  const stored = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!stored || stored.type !== type || stored.usedAt || stored.expiresAt <= new Date()) {
    throw new ValidationError(INVALID_LINK);
  }

  const { count } = await prisma.verificationToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (count === 0) {
    throw new ValidationError(INVALID_LINK);
  }

  return stored.user;
}

function sendVerificationLink(user: User, token: string) {
  runInBackground("verification email", () =>
    sendVerificationEmail({
      to: user.email,
      userName: user.name,
      link: `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`,
    })
  );
}

// ---------------------------------------------------------------------------
// Account flows
// ---------------------------------------------------------------------------

export async function register(name: string, email: string, password: string) {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    throw new ConflictError("User already exists");
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: "USER",
    },
  });

  const token = await createVerificationToken(user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_MS);
  sendVerificationLink(user, token);

  return toPublicUser(user);
}

export async function login(email: string, password: string, userAgent?: string) {
  const user = await findUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new UnauthorizedError("Invalid email or password");
  }

  assertAccountActive(user);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return issueSession(updated, { userAgent });
}

export async function verifyEmail(token: string) {
  const user = await consumeVerificationToken(token, "EMAIL_VERIFY");

  const updated = user.emailVerifiedAt
    ? user
    : await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });

  return toPublicUser(updated);
}

export async function resendVerificationEmail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.emailVerifiedAt) {
    throw new ConflictError("Your email is already verified");
  }

  const token = await createVerificationToken(user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_MS);
  sendVerificationLink(user, token);
}

/**
 * Always succeeds, whether or not the email belongs to an account, so the
 * endpoint can't be used to discover who has signed up.
 */
export async function requestPasswordReset(email: string) {
  const user = await findUserByEmail(email);

  if (!user || user.status === "BANNED") {
    return;
  }

  const token = await createVerificationToken(user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MS);

  runInBackground("password reset email", () =>
    sendPasswordResetEmail({
      to: user.email,
      userName: user.name,
      link: `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
    })
  );
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await consumeVerificationToken(token, "PASSWORD_RESET");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      // Opening the link proves they own the inbox.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  await revokeAllForUser(user.id);
  // Nobody is signed in on this request; the account owner is the actor.
  await recordAudit({
    action: "auth.password_reset",
    entityType: "User",
    entityId: user.id,
    actor: { id: user.id, email: user.email },
  });

  runInBackground("password changed email", () =>
    sendPasswordChangedEmail({ to: user.email, userName: user.name })
  );
}

/** Changes the password, signs out every other device and keeps this one signed in. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  userAgent?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ValidationError("Current password is incorrect", [
      { field: "currentPassword", message: "Current password is incorrect" },
    ]);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
  });

  await revokeAllForUser(userId);
  await recordAudit({ action: "auth.password_changed", entityType: "User", entityId: userId });

  runInBackground("password changed email", () =>
    sendPasswordChangedEmail({ to: user.email, userName: user.name })
  );

  return issueSession(updated, { userAgent });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  return toPublicUser(user);
}

export async function updateProfile(
  userId: string,
  data: {
    name?: string | undefined;
    phone?: string | null | undefined;
    avatarUrl?: string | null | undefined;
  }
) {
  // Only fields that were sent are changed.
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
    },
  });

  return toPublicUser(user);
}
