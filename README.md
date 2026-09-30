# BookIt

BookIt is a full-stack turf/venue booking application that allows customers to browse venues, view available time slots, create and manage bookings, while providers manage their venues and availability and administrators manage the platform.

## Features

### Authentication & Authorization
- User registration and login
- JWT authentication
- Refresh token support
- Password hashing with bcrypt
- Role-based access control
- USER, PROVIDER and ADMIN roles

### Customer
- Browse venues
- View venue details
- View available time slots
- Create bookings
- View bookings
- Cancel bookings
- Submit reviews for completed bookings
- Real-time booking updates

### Provider
- Create and manage venues
- Create and manage time slots
- Prevent overlapping time slots
- View bookings for owned venues
- Confirm/manage bookings

### Admin
- Admin-only routes
- User management
- Venue management
- Booking management
- Role-based access protection

### Notifications & Real-Time
- Booking confirmation emails
- Booking cancellation emails
- Day-of booking reminders
- Socket.io real-time booking events

### Reviews
- Reviews allowed only for completed bookings
- Rating validation from 1–5
- Average venue ratings

### Security
- Helmet
- CORS
- Rate limiting
- Zod validation
- JWT authentication
- RBAC
- bcrypt password hashing
- Centralized error handling

## Tech Stack

### Backend
- Node.js
- Express
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT
- bcrypt
- Zod
- Socket.io
- Nodemailer
- node-cron
- Swagger/OpenAPI
- Jest
- Supertest

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Socket.io Client

### Infrastructure
- PostgreSQL
- Docker / Docker Compose

## Project Structure

```text
BookIt/
├── client/          # React frontend
├── server/          # Express + TypeScript backend
├── docs/             # Project/API documentation
├── docker-compose.yml
├── .gitignore
└── README.md