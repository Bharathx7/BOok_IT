import type { Request, Response } from "express";
import {
  createReview,
  getVenueRating,
} from "../services/review.service.js";

export const createReviewController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const { bookingId, rating, review } = req.body;

  if (!bookingId) {
    return res.status(400).json({
      message: "Booking ID is required",
    });
  }

  const createdReview = await createReview({
    userId,
    bookingId,
    rating,
    review,
  });

  return res.status(201).json({
    message: "Review created successfully",
    review: createdReview,
  });
};

export const getVenueRatingController = async (
  req: Request,
  res: Response
) => {
  const venueId = req.params.venueId as string;

  if (!venueId) {
    return res.status(400).json({
      message: "Venue ID is required",
    });
  }

  const rating = await getVenueRating(venueId);

  return res.status(200).json({
    message: "Venue rating fetched successfully",
    rating,
  });
};