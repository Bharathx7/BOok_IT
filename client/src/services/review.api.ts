import api from "./api";

export interface CreateReviewRequest {
  bookingId: string;
  rating: number;
  review?: string;
}

export interface Review {
  id: string;
  userId: string;
  venueId: string;
  bookingId: string;
  rating: number;
  review: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateReviewResponse {
  message: string;
  review: Review;
}

interface VenueRatingResponse {
  message: string;
  rating: {
    averageRating: number;
    totalReviews: number;
  };
}

export const createReview = async (
  data: CreateReviewRequest
): Promise<Review> => {
  const response = await api.post<CreateReviewResponse>(
    "/reviews",
    data
  );

  return response.data.review;
};

export const getVenueRating = async (
  venueId: string
) => {
  const response = await api.get<VenueRatingResponse>(
    `/reviews/${venueId}/rating`
  );

  return response.data.rating;
};
/** Flags a review for the admins; each person can report a review once. */
export const reportReview = async (reviewId: string, reason: string) => {
  await api.post(`/reviews/${reviewId}/report`, { reason });
};
