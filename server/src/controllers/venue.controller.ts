import type { Request, Response } from "express";

import {
  addFavorite,
  createVenue,
  deleteVenue,
  getFavoriteVenues,
  getMyVenues,
  getPopularVenues,
  getVenueById,
  getVenueReviews,
  removeFavorite,
  searchVenues,
  updateVenue,
} from "../services/venue.service.js";
import {
  addVenueImages,
  deleteVenueImage,
  listVenueImages,
  reorderImages,
  setCoverImage,
} from "../services/venueImage.service.js";
import { UnauthorizedError, ValidationError } from "../utils/errors.js";
import { parsePagination } from "../utils/pagination.js";
import { venueSearchSchema } from "../validators/venue.schema.js";

const requireParam = (req: Request, name: string) => {
  const value = req.params[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Invalid ${name}`);
  }

  return value;
};

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  return req.user;
};

const isAdmin = (req: Request) => req.user?.role === "ADMIN";

export const createVenueController = async (req: Request, res: Response) => {
  const venue = await createVenue(req.body, requireUser(req));

  return res.status(201).json({
    message: "Venue created successfully",
    venue,
  });
};

/** GET /api/venues - search and filter; see venueSearchSchema for parameters. */
export const searchVenuesController = async (req: Request, res: Response) => {
  const filters = venueSearchSchema.parse(req.query);
  const { items, pagination } = await searchVenues(
    filters,
    parsePagination(req.query),
    req.user?.id
  );

  return res.status(200).json({
    venues: items,
    pagination,
  });
};

export const getPopularVenuesController = async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 24);

  return res.status(200).json({
    venues: await getPopularVenues(limit, req.user?.id),
  });
};

export const getMyVenuesController = async (req: Request, res: Response) => {
  const { items, pagination } = await getMyVenues(
    requireUser(req).id,
    parsePagination(req.query)
  );

  return res.status(200).json({
    venues: items,
    pagination,
  });
};

export const getVenueByIdController = async (req: Request, res: Response) => {
  const venue = await getVenueById(requireParam(req, "id"), req.user);

  return res.status(200).json({
    venue,
  });
};

export const getVenueReviewsController = async (req: Request, res: Response) => {
  return res
    .status(200)
    .json(await getVenueReviews(requireParam(req, "id"), parsePagination(req.query)));
};

export const updateVenueController = async (req: Request, res: Response) => {
  const venue = await updateVenue(
    requireParam(req, "id"),
    requireUser(req).id,
    isAdmin(req),
    req.body
  );

  return res.status(200).json({
    message: "Venue updated successfully",
    venue,
  });
};

export const deleteVenueController = async (req: Request, res: Response) => {
  const venue = await deleteVenue(requireParam(req, "id"), requireUser(req).id, isAdmin(req));

  return res.status(200).json({
    message: "Venue deleted successfully",
    venue,
  });
};

// Favourites

export const addFavoriteController = async (req: Request, res: Response) => {
  await addFavorite(requireUser(req).id, requireParam(req, "id"));
  return res.status(204).end();
};

export const removeFavoriteController = async (req: Request, res: Response) => {
  await removeFavorite(requireUser(req).id, requireParam(req, "id"));
  return res.status(204).end();
};

export const getFavoritesController = async (req: Request, res: Response) => {
  const { items, pagination } = await getFavoriteVenues(
    requireUser(req).id,
    parsePagination(req.query)
  );

  return res.status(200).json({ venues: items, pagination });
};

// Images

export const listImagesController = async (req: Request, res: Response) => {
  return res.status(200).json({ images: await listVenueImages(requireParam(req, "id")) });
};

export const uploadImagesController = async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const images = await addVenueImages(requireParam(req, "id"), requireUser(req).id, isAdmin(req), files);

  return res.status(201).json({ images });
};

export const setCoverImageController = async (req: Request, res: Response) => {
  const images = await setCoverImage(
    requireParam(req, "id"),
    requireParam(req, "imageId"),
    requireUser(req).id,
    isAdmin(req)
  );

  return res.status(200).json({ images });
};

export const reorderImagesController = async (req: Request, res: Response) => {
  const images = await reorderImages(
    requireParam(req, "id"),
    req.body.imageIds,
    requireUser(req).id,
    isAdmin(req)
  );

  return res.status(200).json({ images });
};

export const deleteImageController = async (req: Request, res: Response) => {
  const images = await deleteVenueImage(
    requireParam(req, "id"),
    requireParam(req, "imageId"),
    requireUser(req).id,
    isAdmin(req)
  );

  return res.status(200).json({ images });
};
