import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address");

// bcrypt only uses the first 72 bytes of a password.
const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

const token = z.string().min(1, "Token is required").max(200);

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name is too long"),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, "Password is required"),
});

export const verifyEmailSchema = z.object({ token });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token,
  password: newPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword,
});

// Empty strings clear optional fields.
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? null : value), schema.nullable().optional());

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name is too long")
      .optional(),
    phone: optionalText(
      z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9\s-]{6,18}[0-9]$/, "Enter a valid phone number")
    ),
    avatarUrl: optionalText(
      z
        .url("Enter a valid image URL")
        .max(500)
        .refine((value) => /^https?:\/\//i.test(value), "Image URL must start with http(s)://")
    ),
  })
  .strict();
