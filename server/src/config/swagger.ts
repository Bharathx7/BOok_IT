import swaggerJSDoc from "swagger-jsdoc";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",

    info: {
      title: "BookIt API",
      version: "1.0.0",
      description:
        "Venue discovery, booking and venue management. All endpoints are under /api/v1; the unversioned /api prefix still works but is deprecated (responses carry a Deprecation header). Send the access token as a Bearer header; the refresh token travels in an httpOnly cookie.",
    },

    servers: [
      {
        url: "/api/v1",
        description: "This server",
      },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },

  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);