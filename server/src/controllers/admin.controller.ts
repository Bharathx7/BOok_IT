import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

import {
  getAdminDashboard,
  getAdminBookings,
  getAdminUsers,
  getAdminVenues,
} from "../services/admin.service.js";
import { parsePagination } from "../utils/pagination.js";
import {
  bookingListQuerySchema,
  userListQuerySchema,
  venueListQuerySchema,
} from "../validators/admin.schema.js";

export const getAdminDashboardController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const dashboard = await getAdminDashboard();

  return res.status(200).json({
    dashboard,
  });
};

export const getAdminBookingsController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { items, pagination } = await getAdminBookings(
    parsePagination(req.query),
    bookingListQuerySchema.parse(req.query)
  );

  return res.status(200).json({
    bookings: items,
    pagination,
  });
};

export const getAdminUsersController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { items, pagination } = await getAdminUsers(
    parsePagination(req.query),
    userListQuerySchema.parse(req.query)
  );

  return res.status(200).json({
    users: items,
    pagination,
  });
};

export const getAdminVenuesController = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { items, pagination } = await getAdminVenues(
    parsePagination(req.query),
    venueListQuerySchema.parse(req.query)
  );

  return res.status(200).json({
    venues: items,
    pagination,
  });
};
