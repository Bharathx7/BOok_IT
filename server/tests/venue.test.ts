import request from "supertest";
import bcrypt from "bcrypt";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { jest } from "@jest/globals";

jest.setTimeout(15000);

describe("Venue API", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let adminToken: string;
  let userToken: string;
  let venueId: string;

  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = "Test@12345";

  beforeAll(async () => {
    // Create ADMIN directly in the database
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        name: "Venue Admin",
        email: adminEmail,
        passwordHash,
        role: "ADMIN",
        emailVerifiedAt: new Date(),
      },
    });

    // Create normal USER through registration API
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Venue Test User",
        email: userEmail,
        password,
      });

    // Login ADMIN
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: adminEmail,
        password,
      });

    expect(adminLogin.status).toBe(200);

    adminToken = adminLogin.body.accessToken;

    // Login USER
    const userLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: userEmail,
        password,
      });

    expect(userLogin.status).toBe(200);

    userToken = userLogin.body.accessToken;
  });

  // 1. Create Venue
  it("should create a venue successfully", async () => {
    const response = await request(app)
      .post("/api/venues")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Jest Test Turf",
        description: "Venue created by Jest",
        address: "Coimbatore",
        pricePerHour: 1000,
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Venue created successfully");

    expect(response.body.venue).toHaveProperty("id");
    expect(response.body.venue.name).toBe("Jest Test Turf");
    expect(response.body.venue.description).toBe("Venue created by Jest");
    expect(response.body.venue.address).toBe("Coimbatore");
    expect(response.body.venue.ownerId).toBeDefined();

    venueId = response.body.venue.id;
  });

  // 2. Get all Venues
  it("should get all venues successfully", async () => {
    const response = await request(app)
      .get("/api/venues");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("venues");
    expect(Array.isArray(response.body.venues)).toBe(true);

    const venue = response.body.venues.find(
      (venue: { id: string }) => venue.id === venueId
    );

    expect(venue).toBeDefined();
  });

  // 3. Get Venue by ID
  it("should get a venue by ID successfully", async () => {
    const response = await request(app)
      .get(`/api/venues/${venueId}`);

    expect(response.status).toBe(200);
    expect(response.body.venue.id).toBe(venueId);
    expect(response.body.venue.name).toBe("Jest Test Turf");
  });

  // 4. Venue not found
  it("should return 404 when venue does not exist", async () => {
    const fakeVenueId =
      "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .get(`/api/venues/${fakeVenueId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Venue not found");
  });

  // 5. Update Venue
  it("should update a venue successfully", async () => {
    const response = await request(app)
      .put(`/api/venues/${venueId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Updated Jest Turf",
        description: "Updated venue",
        address: "Updated Coimbatore",
        pricePerHour: 1200,
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Venue updated successfully");

    expect(response.body.venue.name).toBe("Updated Jest Turf");
    expect(response.body.venue.description).toBe("Updated venue");
    expect(response.body.venue.address).toBe("Updated Coimbatore");
  });

  // 6. Verify update
  it("should return the updated venue data", async () => {
    const response = await request(app)
      .get(`/api/venues/${venueId}`);

    expect(response.status).toBe(200);
    expect(response.body.venue.name).toBe("Updated Jest Turf");
    expect(response.body.venue.pricePerHour).toBe("1200");
  });

  // 7. Reject request without authentication
  it("should reject venue update without authentication", async () => {
    const response = await request(app)
      .put(`/api/venues/${venueId}`)
      .send({
        name: "Unauthorized Update",
      });

    expect(response.status).toBe(401);
  });

  // 8. Reject normal USER
  it("should reject venue update by normal USER", async () => {
    const response = await request(app)
      .put(`/api/venues/${venueId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "User Unauthorized Update",
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Access denied");
  });

  // 9. Delete Venue
  it("should delete a venue successfully", async () => {
    const response = await request(app)
      .delete(`/api/venues/${venueId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Venue deleted successfully");
    expect(response.body.venue.id).toBe(venueId);
  });

  // 10. Verify deletion
  it("should return 404 after venue is deleted", async () => {
    const response = await request(app)
      .get(`/api/venues/${venueId}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Venue not found");
  });
});