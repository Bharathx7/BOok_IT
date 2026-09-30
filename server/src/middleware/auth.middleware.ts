import type { NextFunction, Request, Response } from "express";

import prisma from "../config/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { setAuditActor } from "../services/audit.service.js";

export type AuthenticatedRequest = Request;

/**
 * Verifies the Bearer access token, then loads the user so that suspensions,
 * bans and role changes take effect immediately instead of when the token
 * expires.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Authorization header is required",
    });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Invalid authorization format",
    });
  }

  let userId: string;

  try {
    userId = verifyAccessToken(token).id;
  } catch {
    return res.status(401).json({
      message: "Invalid or expired access token",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, status: true, emailVerifiedAt: true },
    });

    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        message:
          user.status === "BANNED"
            ? "Your account has been banned."
            : "Your account is suspended. Please contact support.",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
    };
    setAuditActor(user);

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * For public endpoints that show a little more to signed-in users (e.g. which
 * venues are favourites). No header: carry on anonymously. A bad or expired
 * token still gets a 401, so the client refreshes it instead of silently
 * seeing the anonymous version.
 */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
}

/** Blocks actions that need a confirmed email address (booking, listing venues). */
export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.emailVerified) {
    return res.status(403).json({
      message: "Please verify your email address first. Check your inbox or resend the link from your profile.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }

  next();
}
