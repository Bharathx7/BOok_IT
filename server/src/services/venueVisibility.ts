import prisma from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { NotFoundError } from "../utils/errors.js";

// A venue is public - searchable, bookable, open to waitlists - when its
// owner listed it (isActive), an admin approved it and the owner's account
// is in good standing. Owners and admins can still see and manage it.

export const publicVenueWhere = {
  isActive: true,
  approvalStatus: "APPROVED",
  owner: { status: "ACTIVE" },
} satisfies Prisma.VenueWhereInput;

/** The same rule for raw SQL, with the venue aliased as `v`. */
export const PUBLIC_VENUE_SQL = Prisma.sql`(
  v."isActive" = true
  AND v."approvalStatus" = 'APPROVED'
  AND EXISTS (SELECT 1 FROM "User" o WHERE o.id = v."ownerId" AND o."status" = 'ACTIVE')
)`;

/** The same rule for a venue already loaded with its owner's status. */
export const isPublicVenue = (venue: { isActive: boolean; approvalStatus: string; owner: { status: string } }) =>
  venue.isActive && venue.approvalStatus === "APPROVED" && venue.owner.status === "ACTIVE";

type Client = Pick<typeof prisma, "venue">;

/** Loads a venue customers may use, or 404s (hidden venues simply don't exist to them). */
export async function findPublicVenue(venueId: string, client: Client = prisma) {
  const venue = await client.venue.findFirst({ where: { id: venueId, ...publicVenueWhere } });
  if (!venue) throw new NotFoundError("Venue not found");
  return venue;
}

/** Like findPublicVenue, but the owner and admins also see it while it's hidden or in review. */
export async function findViewableVenue(venueId: string, viewer?: { id: string; role: string }) {
  if (viewer) {
    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (venue && (viewer.role === "ADMIN" || venue.ownerId === viewer.id)) return venue;
  }
  return findPublicVenue(venueId);
}
