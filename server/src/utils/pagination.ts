import { z } from "zod";
import { ValidationError } from "./errors.js";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export const parsePagination = (query: unknown): PaginationParams => {
  const result = paginationSchema.safeParse(query ?? {});

  if (!result.success) {
    throw new ValidationError(
      "Invalid pagination parameters",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  const { page, limit } = result.data;

  return { page, limit, skip: (page - 1) * limit };
};

export const buildPaginationMeta = (
  { page, limit }: PaginationParams,
  total: number
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});
