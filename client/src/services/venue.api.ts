import api from "./api";
import type { PageParams, Paginated, Pagination } from "../lib/pagination";

export interface CancellationTier {
  hoursBefore: number;
  refundPercent: number;
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type OpeningHours = Partial<Record<DayKey, { open: string; close: string } | null>>;

/** Card-sized venue as returned by search, favourites and "my venues". */
export type PaymentMode = "PAY_AT_VENUE" | "PAY_ONLINE";

export interface Venue {
  id: string;
  name: string;
  description: string | null;
  category: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  sportTypes: string[];
  amenities: string[];
  rules: string | null;
  openingHours: OpeningHours | null;
  isActive: boolean;
  /** New listings wait for an admin; only APPROVED venues are shown to customers. */
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  avgRating: number;
  reviewCount: number;
  pricePerHour: string;
  timezone: string;
  /** Minutes the owner has to confirm a request before it expires. */
  pendingHoldMinutes: number;
  /** Bookings are made in steps of this many minutes (also the minimum). */
  slotMinutes: number;
  maxBookingMinutes: number;
  cancellationPolicy: CancellationTier[] | null;
  /** PAY_ONLINE: customers pay when booking and it is confirmed once paid. */
  paymentMode: PaymentMode;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  coverImageUrl: string | null;
  imageCount: number;
  /** Only set when searching near a location. */
  distanceKm: number | null;
  isFavorite: boolean;
}

export interface VenueImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  position: number;
  isCover: boolean;
}

export interface VenueDetails extends Venue {
  images: VenueImage[];
  owner: { id: string; name: string };
}

export interface VenueReview {
  id: string;
  rating: number;
  review: string | null;
  createdAt: string;
  providerReply: string | null;
  providerRepliedAt: string | null;
  user: { name: string };
}

export type VenueSort =
  | "recommended"
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "rating"
  | "distance"
  | "popular"
  | "newest";

export interface VenueSearchParams extends PageParams {
  q?: string;
  sport?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  amenities?: string[];
  date?: string;
  time?: string;
  duration?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: VenueSort;
}

interface VenuesResponse {
  venues: Venue[];
  pagination: Pagination;
}

const toPage = (data: VenuesResponse): Paginated<Venue> => ({
  items: data.venues,
  pagination: data.pagination,
});

export const searchVenues = async (params: VenueSearchParams = {}): Promise<Paginated<Venue>> => {
  const { amenities, ...rest } = params;
  const response = await api.get<VenuesResponse>("/venues", {
    params: { ...rest, ...(amenities?.length && { amenities: amenities.join(",") }) },
  });

  return toPage(response.data);
};

/** First page of all venues (kept for callers that just need a list). */
export const getVenues = (params: PageParams = {}) => searchVenues(params);

export const getPopularVenues = async (limit = 8): Promise<Venue[]> => {
  const response = await api.get<{ venues: Venue[] }>("/venues/popular", { params: { limit } });
  return response.data.venues;
};

export const getMyVenues = async (params: PageParams = {}): Promise<Paginated<Venue>> => {
  const response = await api.get<VenuesResponse>("/venues/my", { params });
  return toPage(response.data);
};

export const getVenueById = async (venueId: string): Promise<VenueDetails> => {
  const response = await api.get<{ venue: VenueDetails }>(`/venues/${venueId}`);
  return response.data.venue;
};

export const getVenueReviews = async (
  venueId: string,
  params: PageParams = {}
): Promise<{ reviews: VenueReview[]; pagination: Pagination }> => {
  const response = await api.get<{ reviews: VenueReview[]; pagination: Pagination }>(
    `/venues/${venueId}/reviews`,
    { params }
  );
  return response.data;
};

export interface VenueFormData {
  name: string;
  description?: string;
  category: string;
  address?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  sportTypes?: string[];
  amenities?: string[];
  rules?: string | null;
  openingHours?: OpeningHours | null;
  isActive?: boolean;
  pricePerHour: number;
  pendingHoldMinutes?: number;
  slotMinutes?: number;
  maxBookingMinutes?: number;
  cancellationPolicy?: CancellationTier[] | null;
  paymentMode?: PaymentMode;
}

export type CreateVenueRequest = VenueFormData;
export type UpdateVenueRequest = Partial<VenueFormData>;

export const createVenue = async (data: CreateVenueRequest): Promise<Venue> => {
  const response = await api.post<{ venue: Venue }>("/venues", data);
  return response.data.venue;
};

export const updateVenue = async (venueId: string, data: UpdateVenueRequest): Promise<Venue> => {
  const response = await api.put<{ venue: Venue }>(`/venues/${venueId}`, data);
  return response.data.venue;
};

export const deleteVenue = async (venueId: string): Promise<void> => {
  await api.delete(`/venues/${venueId}`);
};

// Favourites

export const addFavorite = async (venueId: string): Promise<void> => {
  await api.post(`/venues/${venueId}/favorite`);
};

export const removeFavorite = async (venueId: string): Promise<void> => {
  await api.delete(`/venues/${venueId}/favorite`);
};

export const getFavoriteVenues = async (params: PageParams = {}): Promise<Paginated<Venue>> => {
  const response = await api.get<VenuesResponse>("/users/me/favorites", { params });
  return toPage(response.data);
};

// Photos

export const getVenueImages = async (venueId: string): Promise<VenueImage[]> => {
  const response = await api.get<{ images: VenueImage[] }>(`/venues/${venueId}/images`);
  return response.data.images;
};

export const uploadVenueImages = async (
  venueId: string,
  files: File[],
  onProgress?: (percent: number) => void
): Promise<VenueImage[]> => {
  const form = new FormData();
  for (const file of files) {
    form.append("images", file);
  }

  const response = await api.post<{ images: VenueImage[] }>(`/venues/${venueId}/images`, form, {
    // Let the browser set multipart/form-data with its boundary.
    headers: { "Content-Type": undefined },
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
  return response.data.images;
};

export const setCoverImage = async (venueId: string, imageId: string): Promise<VenueImage[]> => {
  const response = await api.put<{ images: VenueImage[] }>(
    `/venues/${venueId}/images/${imageId}/cover`
  );
  return response.data.images;
};

export const reorderVenueImages = async (
  venueId: string,
  imageIds: string[]
): Promise<VenueImage[]> => {
  const response = await api.put<{ images: VenueImage[] }>(`/venues/${venueId}/images/order`, {
    imageIds,
  });
  return response.data.images;
};

export const deleteVenueImage = async (venueId: string, imageId: string): Promise<VenueImage[]> => {
  const response = await api.delete<{ images: VenueImage[] }>(
    `/venues/${venueId}/images/${imageId}`
  );
  return response.data.images;
};
