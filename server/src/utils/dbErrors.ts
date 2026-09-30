import { Prisma } from "../generated/prisma/client.js";

const EXCLUSION_VIOLATION = "23P01";

/**
 * Walks an error (and its meta / cause chain) looking for a Postgres
 * exclusion-constraint violation. Prisma's driver adapter surfaces it as a
 * generic "postgres" error, so the SQLSTATE code has to be dug out.
 */
export const isExclusionViolation = (error: unknown, depth = 0): boolean => {
  if (!error || typeof error !== "object" || depth > 5) {
    return false;
  }

  const candidate = error as Record<string, unknown>;

  if (candidate.code === EXCLUSION_VIOLATION || candidate.originalCode === EXCLUSION_VIOLATION) {
    return true;
  }

  if (
    typeof candidate.message === "string" &&
    candidate.message.includes("violates exclusion constraint")
  ) {
    return true;
  }

  return ["meta", "cause", "driverAdapterError"].some((key) =>
    isExclusionViolation(candidate[key], depth + 1)
  );
};

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const isRecordNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
