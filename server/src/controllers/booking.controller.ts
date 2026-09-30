import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

import {
  createBookingWithPayment,
  getUserBookings,
  getProviderBookings,
  getBookingById,
  cancelBooking,
  confirmBooking,
  completeBooking,
  BOOKING_SCOPES,
  type BookingScope,
} from "../services/booking.service.js";
import { parsePagination } from "../utils/pagination.js";

/** The ?scope= filter on booking lists; anything unknown means "all". */
const parseScope = (value: unknown) =>
  BOOKING_SCOPES.includes(value as BookingScope) ? (value as BookingScope) : undefined;

export const getProviderBookingsController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const providerId = req.user?.id;

  if (!providerId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const { items, pagination } = await getProviderBookings(
    providerId,
    parsePagination(req.query),
    parseScope(req.query.scope)
  );

  return res.status(200).json({
    bookings: items,
    pagination,
  });
};

export const completeBookingController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid booking id is required",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const booking = await completeBooking(
    id,
    req.user.id,
    req.user.role
  );

  return res.status(200).json({
    message: "Booking completed successfully",
    booking,
  });
};

export const createBookingController = async (
  req: Request,
  res: Response
) => {
  const { venueId, startTime, endTime, couponCode } = req.body;

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  // At a pay-online venue `payment` holds what the checkout needs.
  const { booking, payment } = await createBookingWithPayment({
    userId,
    venueId,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    couponCode: couponCode || undefined,
  });

  return res.status(201).json({
    message: payment ? "Booking created; waiting for payment" : "Booking created successfully",
    booking,
    payment,
  });
};

export const getUserBookingsController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const { items, pagination } = await getUserBookings(
    userId,
    parsePagination(req.query),
    parseScope(req.query.scope)
  );

  return res.status(200).json({
    bookings: items,
    pagination,
  });
};

export const getBookingByIdController = async (
  req: Request,
  res: Response
) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid booking id is required",
    });
  }

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const booking = await getBookingById(id, userId);

  return res.status(200).json({
    booking,
  });
};

export const cancelBookingController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid booking id is required",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const booking = await cancelBooking(
    id,
    req.user.id,
    req.user.role
  );

  return res.status(200).json({
    message: "Booking cancelled successfully",
    booking,
  });
};

export const confirmBookingController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid booking id is required",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const booking = await confirmBooking(
    id,
    req.user.id,
    req.user.role
  );

  return res.status(200).json({
    message: "Booking confirmed successfully",
    booking,
  });
};