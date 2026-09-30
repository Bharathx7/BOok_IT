import { createHash, randomBytes } from "node:crypto";

/** A random, URL-safe token (refresh tokens, email links). */
export const generateOpaqueToken = () => randomBytes(32).toString("base64url");

/**
 * Tokens are stored only as SHA-256 hashes, so a database leak does not hand
 * out working sessions or reset links. (They are long and random, so a fast
 * hash is fine - unlike passwords.)
 */
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
