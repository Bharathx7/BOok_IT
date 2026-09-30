import { randomUUID } from "node:crypto";
import sharp from "sharp";

import prisma from "../config/prisma.js";
import { removeQuietly, storage } from "../storage/index.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import { venueChanged } from "./venueCache.js";

export const MAX_IMAGES_PER_VENUE = 10;
const MAX_DIMENSION = 1600;

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
}

async function assertCanManage(venueId: string, userId: string, isAdmin: boolean) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { ownerId: true },
  });

  if (!venue) {
    throw new NotFoundError("Venue not found");
  }

  if (!isAdmin && venue.ownerId !== userId) {
    throw new ForbiddenError("You do not have permission to manage this venue");
  }
}

export const listVenueImages = (venueId: string) =>
  prisma.venueImage.findMany({
    where: { venueId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

/**
 * Re-encodes every upload: this proves it really is an image (the browser's
 * MIME type is not trusted), caps its size, and drops metadata such as the
 * GPS location phones embed in photos.
 */
async function processImage(file: UploadedFile) {
  try {
    const { data, info } = await sharp(file.buffer, { failOn: "error" })
      .rotate() // apply EXIF orientation before metadata is dropped
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
  } catch {
    throw new ValidationError(`"${file.originalname}" is not a valid JPEG, PNG or WebP image`);
  }
}

export async function addVenueImages(
  venueId: string,
  userId: string,
  isAdmin: boolean,
  files: UploadedFile[]
) {
  await assertCanManage(venueId, userId, isAdmin);

  if (files.length === 0) {
    throw new ValidationError("Choose at least one image");
  }

  const existing = await listVenueImages(venueId);

  if (existing.length + files.length > MAX_IMAGES_PER_VENUE) {
    throw new ValidationError(
      `A venue can have at most ${MAX_IMAGES_PER_VENUE} photos (it has ${existing.length})`
    );
  }

  // Validate everything before storing anything.
  const processed = await Promise.all(files.map(processImage));

  const stored: { key: string; url: string; width: number; height: number }[] = [];

  try {
    for (const image of processed) {
      const file = await storage.put(
        `venues/${venueId}/${randomUUID()}.webp`,
        image.data,
        "image/webp"
      );
      stored.push({ ...file, width: image.width, height: image.height });
    }
  } catch (error) {
    await removeQuietly(stored.map((file) => file.key));
    throw error;
  }

  const nextPosition = existing.reduce((max, image) => Math.max(max, image.position + 1), 0);
  const hasCover = existing.some((image) => image.isCover);

  await prisma.venueImage.createMany({
    data: stored.map((file, index) => ({
      venueId,
      url: file.url,
      storageKey: file.key,
      width: file.width,
      height: file.height,
      position: nextPosition + index,
      isCover: !hasCover && index === 0,
    })),
  });

  venueChanged(venueId);
  return listVenueImages(venueId);
}

export async function setCoverImage(
  venueId: string,
  imageId: string,
  userId: string,
  isAdmin: boolean
) {
  await assertCanManage(venueId, userId, isAdmin);

  const image = await prisma.venueImage.findFirst({ where: { id: imageId, venueId } });

  if (!image) {
    throw new NotFoundError("Image not found");
  }

  await prisma.$transaction([
    prisma.venueImage.updateMany({ where: { venueId }, data: { isCover: false } }),
    prisma.venueImage.update({ where: { id: imageId }, data: { isCover: true } }),
  ]);

  venueChanged(venueId);
  return listVenueImages(venueId);
}

export async function reorderImages(
  venueId: string,
  imageIds: string[],
  userId: string,
  isAdmin: boolean
) {
  await assertCanManage(venueId, userId, isAdmin);

  const existing = await listVenueImages(venueId);
  const existingIds = new Set(existing.map((image) => image.id));

  if (imageIds.length !== existing.length || !imageIds.every((id) => existingIds.has(id))) {
    throw new ValidationError("Send every image of this venue exactly once, in the new order");
  }

  await prisma.$transaction(
    imageIds.map((id, position) =>
      prisma.venueImage.update({ where: { id }, data: { position } })
    )
  );

  venueChanged(venueId);
  return listVenueImages(venueId);
}

export async function deleteVenueImage(
  venueId: string,
  imageId: string,
  userId: string,
  isAdmin: boolean
) {
  await assertCanManage(venueId, userId, isAdmin);

  const image = await prisma.venueImage.findFirst({ where: { id: imageId, venueId } });

  if (!image) {
    throw new NotFoundError("Image not found");
  }

  await prisma.venueImage.delete({ where: { id: imageId } });

  // Keep a cover as long as there are photos.
  if (image.isCover) {
    const next = await prisma.venueImage.findFirst({
      where: { venueId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    if (next) {
      await prisma.venueImage.update({ where: { id: next.id }, data: { isCover: true } });
    }
  }

  await removeQuietly([image.storageKey]);

  venueChanged(venueId);
  return listVenueImages(venueId);
}
