import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { ZodError } from "zod";

import { AppError } from "../utils/errors.js";
import {
  isExclusionViolation,
  isRecordNotFound,
  isUniqueViolation,
} from "../utils/dbErrors.js";
import { logger } from "../utils/logger.js";
import { reportError } from "../utils/monitoring.js";

interface ErrorBody {
  message: string;
  errors?: { field: string; message: string }[];
  requestId?: string;
}

const toResponse = (error: unknown): { status: number; body: ErrorBody } => {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: error.errors
        ? { message: error.message, errors: error.errors }
        : { message: error.message },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        message: "Validation failed",
        errors: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }

  if (error instanceof jwt.TokenExpiredError) {
    return { status: 401, body: { message: "Token has expired" } };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return { status: 401, body: { message: "Invalid token" } };
  }

  // File uploads: too large, too many, unexpected field.
  if (error instanceof multer.MulterError) {
    const messages: Partial<Record<multer.ErrorCode, string>> = {
      LIMIT_FILE_SIZE: "Each image must be 5 MB or smaller",
      LIMIT_FILE_COUNT: "Too many files in one upload",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field; use 'images'",
    };
    return { status: 400, body: { message: messages[error.code] ?? "Invalid file upload" } };
  }

  if (isExclusionViolation(error)) {
    return { status: 409, body: { message: "This time is already booked" } };
  }

  if (isUniqueViolation(error)) {
    return { status: 409, body: { message: "Resource already exists" } };
  }

  if (isRecordNotFound(error)) {
    return { status: 404, body: { message: "Resource not found" } };
  }

  // Malformed JSON body from express.json()
  if (
    error instanceof SyntaxError &&
    (error as SyntaxError & { type?: string }).type === "entity.parse.failed"
  ) {
    return { status: 400, body: { message: "Malformed JSON body" } };
  }

  return { status: 500, body: { message: "Internal server error" } };
};

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const { status, body } = toResponse(error);
  const log = req.log ?? logger;

  if (status >= 500) {
    log.error({ err: error }, "Unhandled error");
    reportError(error, {
      requestId: req.id ? String(req.id) : undefined,
      userId: req.user?.id,
      route: `${req.method} ${req.baseUrl}${req.route?.path ?? ""}`,
    });
  } else {
    log.warn({ status, message: body.message }, "Request failed");
  }

  if (status >= 500 && req.id) {
    body.requestId = String(req.id);
  }

  return res.status(status).json(body);
};

export const notFoundMiddleware = (req: Request, res: Response) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};
