import { z } from "zod";

export const createTimeSlotSchema = z
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
  })
  .refine(
    (data) => new Date(data.startTime) < new Date(data.endTime),
    {
      message: "Start time must be before end time",
      path: ["endTime"],
    }
  );

export const updateTimeSlotSchema = z
  .object({
    startTime: z
      .string()
      .datetime("Invalid start time"),

    endTime: z
      .string()
      .datetime("Invalid end time"),
  })
  .refine(
    (data) => new Date(data.startTime) < new Date(data.endTime),
    {
      message: "Start time must be before end time",
      path: ["endTime"],
    }
  );