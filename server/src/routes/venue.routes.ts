import { Router } from "express";
import multer from "multer";

import {
  addFavoriteController,
  createVenueController,
  deleteImageController,
  deleteVenueController,
  getMyVenuesController,
  getPopularVenuesController,
  getVenueByIdController,
  getVenueReviewsController,
  listImagesController,
  removeFavoriteController,
  reorderImagesController,
  searchVenuesController,
  setCoverImageController,
  updateVenueController,
  uploadImagesController,
} from "../controllers/venue.controller.js";
import {
  authenticate,
  optionalAuthenticate,
  requireVerifiedEmail,
} from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { MAX_IMAGES_PER_VENUE } from "../services/venueImage.service.js";
import {
  createVenueSchema,
  reorderImagesSchema,
  updateVenueSchema,
} from "../validators/venue.schema.js";
import { ValidationError } from "../utils/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Images are held in memory only long enough to be re-encoded by sharp.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_IMAGES_PER_VENUE },
  fileFilter: (_req, file, callback) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new ValidationError(`"${file.originalname}" must be a JPEG, PNG or WebP image`));
    }
  },
});

const manage = [authenticate, authorize("ADMIN", "PROVIDER")] as const;

/**
 * @swagger
 * /venues:
 *   get:
 *     summary: Search venues (only active ones)
 *     tags: [Venues]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: "Words in name, description, address or city" }
 *       - { in: query, name: sport, schema: { type: string } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: minPrice, schema: { type: number } }
 *       - { in: query, name: maxPrice, schema: { type: number } }
 *       - { in: query, name: minRating, schema: { type: number } }
 *       - { in: query, name: amenities, schema: { type: string }, description: "Comma-separated; all must match" }
 *       - { in: query, name: date, schema: { type: string, example: "2026-10-03" }, description: "Has free time that day (venue timezone)" }
 *       - { in: query, name: time, schema: { type: string, example: "18:00" }, description: "With date - free from this time" }
 *       - { in: query, name: duration, schema: { type: integer, default: 60 }, description: "Minutes, with time" }
 *       - { in: query, name: lat, schema: { type: number } }
 *       - { in: query, name: lng, schema: { type: number } }
 *       - { in: query, name: radiusKm, schema: { type: number, default: 10 } }
 *       - { in: query, name: sort, schema: { type: string, enum: [recommended, relevance, price_asc, price_desc, rating, distance, popular, newest] } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: Page of venue summaries with coverImageUrl, distanceKm and isFavorite }
 *   post:
 *     summary: Create a venue (provider/admin, verified email)
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 */
router.get("/", optionalAuthenticate, asyncHandler(searchVenuesController));

router.post(
  "/",
  ...manage,
  requireVerifiedEmail,
  validate(createVenueSchema),
  asyncHandler(createVenueController)
);

/**
 * @swagger
 * /venues/popular:
 *   get:
 *     summary: Most booked venues in the last 30 days
 *     tags: [Venues]
 *     responses:
 *       200: { description: Venue summaries }
 */
router.get("/popular", optionalAuthenticate, asyncHandler(getPopularVenuesController));

/**
 * @swagger
 * /venues/my:
 *   get:
 *     summary: The provider's own venues, including hidden ones
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of venue summaries }
 */
router.get("/my", authenticate, authorize("PROVIDER"), asyncHandler(getMyVenuesController));

/**
 * @swagger
 * /venues/{id}:
 *   get:
 *     summary: Venue details with photos (hidden venues only for owner/admin)
 *     tags: [Venues]
 *     responses:
 *       200: { description: Venue }
 *       404: { description: Not found }
 *   put:
 *     summary: Update a venue
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Delete a venue (only without bookings, slots or reviews)
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Has history; hide it instead }
 */
router.get("/:id", optionalAuthenticate, asyncHandler(getVenueByIdController));
router.put("/:id", ...manage, validate(updateVenueSchema), asyncHandler(updateVenueController));
router.delete("/:id", ...manage, asyncHandler(deleteVenueController));

/**
 * @swagger
 * /venues/{id}/reviews:
 *   get:
 *     summary: Reviews of a venue, newest first
 *     tags: [Venues]
 *     responses:
 *       200: { description: Page of reviews }
 */
router.get("/:id/reviews", asyncHandler(getVenueReviewsController));

/**
 * @swagger
 * /venues/{id}/favorite:
 *   post:
 *     summary: Add to favourites
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Saved }
 *   delete:
 *     summary: Remove from favourites
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Removed }
 */
router.post("/:id/favorite", authenticate, asyncHandler(addFavoriteController));
router.delete("/:id/favorite", authenticate, asyncHandler(removeFavoriteController));

/**
 * @swagger
 * /venues/{id}/images:
 *   get:
 *     summary: Venue photos in display order
 *     tags: [Venues]
 *     responses:
 *       200: { description: Images }
 *   post:
 *     summary: Upload photos (multipart field "images", up to 10 per venue, 5 MB each)
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: All images of the venue }
 *       400: { description: Not an image, too large or too many }
 * /venues/{id}/images/order:
 *   put:
 *     summary: Reorder photos (send every image id in the new order)
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Images }
 * /venues/{id}/images/{imageId}/cover:
 *   put:
 *     summary: Make this photo the cover
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Images }
 * /venues/{id}/images/{imageId}:
 *   delete:
 *     summary: Delete a photo
 *     tags: [Venues]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Remaining images }
 */
router.get("/:id/images", asyncHandler(listImagesController));
router.post(
  "/:id/images",
  ...manage,
  upload.array("images", MAX_IMAGES_PER_VENUE),
  asyncHandler(uploadImagesController)
);
router.put(
  "/:id/images/order",
  ...manage,
  validate(reorderImagesSchema),
  asyncHandler(reorderImagesController)
);
router.put("/:id/images/:imageId/cover", ...manage, asyncHandler(setCoverImageController));
router.delete("/:id/images/:imageId", ...manage, asyncHandler(deleteImageController));

export default router;
