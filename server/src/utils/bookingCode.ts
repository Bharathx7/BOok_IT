import { randomInt } from "node:crypto";

// No look-alikes (0/O, 1/I/L) so codes are easy to read out or type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** e.g. "BK-7F3K2Q" - 31^6 ≈ 900 million possibilities. */
export const newBookingCode = () =>
  `BK-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

/** Accepts "bk 7f3k2q", "BK-7F3K2Q", "7F3K2Q". */
export const normalizeBookingCode = (input: string) => {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BK/, "");
  return `BK-${raw}`;
};
