import { z } from "zod";

export const createBookingSchema = z
  .object({
    venueId: z
      .string()
      .uuid("Invalid venue ID"),

    startTime: z
      .string()
      .datetime("Invalid start time"),

    endTime: z
      .string()
      .datetime("Invalid end time"),

    couponCode: z
      .string()
      .trim()
      .max(40, "Invalid coupon code")
      .optional(),
  })
  .refine(
    (data) => new Date(data.startTime) < new Date(data.endTime),
    {
      message: "Start time must be before end time",
      path: ["endTime"],
    }
  );