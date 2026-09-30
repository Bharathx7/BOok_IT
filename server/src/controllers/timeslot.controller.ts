import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

import {
  createTimeSlot,
  getVenueTimeSlots,
  updateTimeSlot,
  deleteTimeSlot,
  checkAvailability,
} from "../services/timeslot.service.js";

export const createTimeSlotController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { venueId, startTime, endTime } = req.body;

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const timeSlot = await createTimeSlot({
    venueId,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    userId: req.user.id,
    userRole: req.user.role,
  });

  return res.status(201).json({
    message: "Time slot created successfully",
    timeSlot,
  });
};

export const getVenueTimeSlotsController = async (
  req: Request,
  res: Response
) => {
  const { venueId } = req.params;

  if (!venueId || Array.isArray(venueId)) {
    return res.status(400).json({
      message: "Valid venueId is required",
    });
  }

  const timeSlots = await getVenueTimeSlots(venueId);

  return res.status(200).json({
    timeSlots,
  });
};

export const updateTimeSlotController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;
  const { startTime, endTime } = req.body;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid time slot id is required",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const timeSlot = await updateTimeSlot({
    id,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    userId: req.user.id,
    userRole: req.user.role,
  });

  return res.status(200).json({
    message: "Time slot updated successfully",
    timeSlot,
  });
};

export const deleteTimeSlotController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({
      message: "Valid time slot id is required",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  await deleteTimeSlot(
    id,
    req.user.id,
    req.user.role
  );

  return res.status(200).json({
    message: "Time slot deleted successfully",
  });
};

export const checkAvailabilityController = async (
  req: Request,
  res: Response
) => {
  const { venueId } = req.params;
  const { startTime, endTime } = req.query;

  if (!venueId || Array.isArray(venueId)) {
    return res.status(400).json({
      message: "Valid venueId is required",
    });
  }

  if (
    typeof startTime !== "string" ||
    typeof endTime !== "string"
  ) {
    return res.status(400).json({
      message: "startTime and endTime are required",
    });
  }

  const availability = await checkAvailability(
    venueId,
    new Date(startTime),
    new Date(endTime)
  );

  return res.status(200).json(availability);
};