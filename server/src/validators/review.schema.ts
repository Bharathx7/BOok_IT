import { z } from "zod";

export const createReviewSchema = z.object({
  bookingId: z
    .string()
    .uuid("Invalid booking ID"),

  rating: z
    .number()
    .int("Rating must be a whole number")
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),

  review: z
    .string()
    .trim()
    .max(2000, "Review is too long")
    .optional(),
});

export const reportReviewSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Tell us briefly what's wrong")
    .max(500, "Keep it under 500 characters"),
});
