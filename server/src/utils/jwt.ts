import jwt from "jsonwebtoken";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

interface TokenUser {
  id: string;
  email: string;
  role: string;
}

interface AuthTokenPayload extends JwtPayload {
  id: string;
  email: string;
  role: string;
}

export function generateAccessToken(user: TokenUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"] & string,
    }
  );
}

export function verifyAccessToken(
  token: string
): AuthTokenPayload {
  const decoded = jwt.verify(
    token,
    env.JWT_ACCESS_SECRET
  );

  if (typeof decoded === "string") {
    throw new Error("Invalid access token");
  }

  return decoded as AuthTokenPayload;
}
