# BookIt Upgrade Roadmap

Phased plan for upgrading BookIt. AI features are out of scope for now.
Each phase is meant to ship as its own branch/PR, fully tested, before the next one starts.

Legend: `[ ]` todo · `[x]` done

---

## Phase 0 — Hardening & Foundation

Fix correctness/security gaps so everything built later is on safe ground. **Must be done before payments.**

### Backend
- [x] **Prevent double booking**: wrap overlap check + insert in a transaction and add a Postgres exclusion constraint (`btree_gist`, `tstzrange(startTime, endTime)` on `venueId` where status in PENDING/CONFIRMED) so the DB rejects overlaps even under concurrency — migration `20260923000000_booking_overlap_constraints` written, **not yet applied** to any database
- [x] Remove or admin-protect `POST /api/email/test` (currently an open spam relay)
- [x] Wire up `express-rate-limit` (global limit + stricter limit on `/api/auth/*`)
- [x] Restrict CORS (HTTP + Socket.io) to `CLIENT_URL` env var instead of `*`
- [x] Typed errors: `AppError` with `NotFoundError` (404), `ForbiddenError` (403), `ConflictError` (409), `ValidationError` (400), `UnauthorizedError` (401); error middleware maps them and returns 500 with a generic message for unknown errors
- [x] Zod validation errors return field-level details
- [x] Emails no longer fail the request (fire-and-forget with error logging for now; moved to a queue in Phase 2)
- [x] Socket.io: authenticate connections with JWT; emit to rooms (`user:<id>`, `venue:<id>`, `admin`) instead of `io.emit` to everyone
- [x] Pagination helper (`page`, `limit`, `total`) applied to all list endpoints (bookings, venues, admin lists)
- [x] Remove duplicate Swagger mount in `server.ts`; move `socket.io-client` to devDependencies
- [x] Structured logging with `pino` + request IDs
- [x] Env validation at startup with Zod (fail fast on missing `DATABASE_URL`, `JWT_*`, SMTP vars)
- [x] Explicit timezone handling: store UTC, add `timezone` to Venue (default `Asia/Kolkata`), format in venue timezone for emails/UI — client helpers in `client/src/lib/datetime.ts`; slot creation converts venue wall-clock time to UTC

### Frontend
- [x] Handle paginated responses (pager on list pages; dashboards/calendar/browse fetch all pages until Phase 3 search)
- [x] Show proper error messages per status code (403/404/409)
- [x] Socket client sends JWT (`auth.token`) and reconnects on login/logout

### Tooling & docs
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): server typecheck + migrations + tests against a Postgres service + build; client lint + build — *server has no ESLint setup and the client has no tests yet*
- [x] Update `docs/ER-diagram.md` and `docs/user-stories.md` to match the actual schema (plus `docs/booking-lifecycle.md`)
- [x] Tests: concurrent double-booking test, rate limit test, socket room test — run against local Docker Postgres (`npm run test:setup && npm test` in `server/`)

**Done when:** two simultaneous bookings for the same slot → exactly one succeeds; CI is green.

---

## Phase 1 — Auth & Account Upgrade

### Schema
- `User`: `status` (`ACTIVE | SUSPENDED | BANNED`), `emailVerified`, `phone`, `avatarUrl`, `lastLoginAt`
- New `RefreshToken` (hashed token, userId, expiresAt, revokedAt, userAgent) — enables revocation/rotation
- New `VerificationToken` (type: `EMAIL_VERIFY | PASSWORD_RESET`, hashed token, expiresAt)

### Backend
- [x] Refresh token in **httpOnly secure cookie**, rotated on every refresh, reuse detection revokes the whole family — opaque random token, SHA-256 hashed in DB; 30 s grace for two tabs refreshing at once
- [x] `POST /auth/logout` (revokes token), logout from all devices (`POST /auth/logout-all`)
- [x] Email verification on signup — unverified users can sign in but can't create bookings/venues/slots (`403 EMAIL_NOT_VERIFIED`); existing accounts backfilled as verified
- [x] Forgot / reset password flow — single-use 1 h links; reset signs out all devices
- [x] Change password (signs out other devices), update profile (name, phone, avatar URL) — `/api/users/me`
- [x] Block login and API access for `SUSPENDED` / `BANNED` users — checked on every request, not just at token expiry
- [ ] (Optional) Google OAuth login — skipped for now

### Frontend
- [x] Stop storing tokens in `localStorage` (access token in memory, refresh via cookie)
- [x] Axios interceptor: auto-refresh on 401, retry request
- [x] Pages: Verify email, Forgot password, Reset password, Profile/Settings
- [x] `/api` served same-origin (Vite proxy locally; **Vercel rewrite to Render needed at deploy**) so the cookie is first-party

**Done when:** logout truly invalidates sessions; no tokens in localStorage.

---

## Phase 2 — Background Jobs & Notifications

### Infra
- ~~Redis + BullMQ~~ → **Postgres job queue (`pg-boss`)**, decided 2026-09-28: same retries/delays/schedules with no extra service (BullMQ's polling would exceed Upstash free limits; Render Redis needs a paid plan). Jobs live in the `pgboss` schema.
- Queues: `email` (6 retries, exponential backoff up to 1 h) and `booking-maintenance` (cron every minute)

### Schema
- New `Notification` (userId, type, title, body, data JSON, readAt, createdAt)
- New `NotificationPreference` (userId, type, channel `IN_APP | EMAIL`, enabled) — opt-outs only
- `Booking`: `expiresAt`, `reminder24hSentAt`, `reminder2hSentAt` (replaces `reminderSent`); status `EXPIRED`
- `Venue`: `pendingHoldMinutes` (default 1440)

### Backend
- [x] Move all emails to the queue with retries + backoff
- [x] Replace node-cron reminder with scheduled jobs (reminder 24h and 2h before) — a per-minute sweep over the DB, so nothing is missed after downtime
- [x] Auto-expire PENDING bookings after N minutes (configurable per venue, default 24 h, capped at start) → frees the slot; overdue requests are also released instantly when someone books over them, and can't be confirmed late
- [x] Auto-mark CONFIRMED bookings as COMPLETED after end time (with a review nudge)
- [x] In-app notification center API: list, unread count, mark read / mark all read, preferences (`/api/notifications`)
- [x] HTML email templates (branded layout, plain-text fallback)
- [x] Fix: simultaneous overlapping bookings could deadlock on the exclusion constraint (500) — booking creation now takes a per-venue advisory lock
- [ ] (Optional) Web push (PWA), SMS/WhatsApp via provider (e.g. Twilio / MSG91)

### Frontend
- [x] Notification bell with unread badge + dropdown, live via socket
- [x] Notification preferences page (`/<role>/notifications`, with full history)
- [x] Toasts for real-time booking events
- [x] Venue form: "Confirm requests within"; "confirm by" / expired messages on booking lists

**Done when:** a failing SMTP server never breaks a booking; stale PENDING bookings release their slot automatically.

---

## Phase 3 — Venue Discovery & Rich Listings

### Schema
- `Venue`: `city`, `latitude`, `longitude`, `sportTypes[]`, `amenities[]`, `rules`, `openingHours` JSON, `isActive`, `avgRating`, `reviewCount` (denormalized)
- New `VenueImage` (venueId, url, storageKey, width, height, position, isCover)
- New `Favorite` (userId, venueId, unique pair)

### Backend
- [x] Image upload with size/type validation; reorder, set cover, delete — **Supabase Storage** in production (decided 2026-09-28), local disk in development; every upload re-encoded with `sharp` (≤1600 px WebP, EXIF/GPS stripped), max 10 per venue, 5 MB each
- [x] `GET /venues` server-side search: text, sport (any of the venue's sports), city, price range, min rating, amenities (all), **available on date/time** (in the venue's timezone; expired holds don't count), sort (recommended, relevance, price, rating, distance, popular, newest), pagination
- [x] Geo search: "near me" by lat/lng + radius (bounding box + Haversine)
- [x] Postgres full-text search index on name/description/address/city (prefix matching)
- [x] Keep `avgRating` / `reviewCount` updated on review create (backfilled in the migration)
- [x] Favorites API (`POST/DELETE /venues/:id/favorite`, `GET /users/me/favorites`, `isFavorite` on results)
- [x] Popular / trending venues endpoint (most booked in 30 days)
- [x] Venue reviews list; hidden (`isActive=false`) venues visible only to owner/admin

### Frontend
- [x] Filter sidebar + URL-synced query params (shareable searches)
- [x] Map view (Leaflet + OpenStreetMap) with venue pins; location picker with address search for providers
- [x] Image gallery / carousel on venue details (full screen, keyboard)
- [x] Amenities chips, opening hours, rules, reviews, directions on venue details
- [x] Favorites page + heart toggle
- [x] Skeleton loaders, empty states, pager
- [x] Provider venue editor page (all fields, photos, map pin, listed/hidden)

**Done when:** a customer can find "football turf near me, available Saturday 6pm, under ₹1500" without client-side filtering.

---

## Phase 4 — Provider Tools

Decided 2026-09-28: time slots stay **opening windows**; customers pick a start time and length inside them, in the venue's booking step (`Venue.slotMinutes`, default 60) up to `maxBookingMinutes`.

### Schema
- New `SlotTemplate` (venueId, daysOfWeek[], startTime, endTime, validFrom, validTo, isActive); `TimeSlot.templateId`
- New `BlackoutDate` (venueId, start, end, reason)
- New `PricingRule` (venueId, name, daysOfWeek[], startTime, endTime, FIXED ₹/h or MULTIPLIER, priority, validFrom/To, isActive)
- Cancellation policy as `Venue.cancellationPolicy` JSON tiers (e.g. `>=24h: 100%`, `>=6h: 50%`, else 0%)
- `Review`: `providerReply`, `providerRepliedAt`
- `Booking`: `totalPrice`, `priceBreakdown`, `source` (`ONLINE | WALK_IN | BLOCK`), guest name/phone, note, `cancelledAt`, `cancelledById`, `refundPercent`, `refundAmount`

### Backend
- [x] Generate slots in bulk from templates (preview first; days with slots skipped; nightly job keeps 30 days filled)
- [x] Blackout dates block bookings and hide availability (search + booking page)
- [x] Price calculation service using pricing rules (5-minute steps, overnight rules, priority) → stored on booking; public quote endpoint
- [x] Cancellation policy evaluated on cancel (refund % and amount recorded; venue cancellations and unconfirmed requests refund fully)
- [x] Provider reply to reviews
- [x] Provider analytics API: revenue, occupancy %, weekday × hour heatmap, top customers, cancellation rate, rating trend, per venue
- [x] Walk-in / offline booking and blocked time by provider
- [x] Export bookings to CSV (Excel-safe, formula injection defused)
- [x] Day schedule endpoint for the booking page; provider calendar endpoint

### Frontend
- [x] Booking picker for customers: day → free start times → length, live price breakdown, refund policy shown (replaces "book the whole slot")
- [x] Slot template builder + preview
- [x] Calendar upgrade: week/day views, drag-to-block (or add a walk-in), color by status/source, click for details/confirm/cancel
- [x] Pricing rules editor with price calculator; cancellation policy editor with presets
- [x] Analytics dashboard (stat tiles, daily revenue chart with table view, occupancy heatmap, top customers, rating trend, per venue)
- [x] Review replies UI; replies shown on the venue page
- [x] Refund shown before cancelling; prices on booking lists

**Done when:** a provider can set up a full month of priced slots in under a minute.

---

## Phase 5 — Advanced Booking Features

### Schema
- `Booking`: `rescheduledFromId`, `recurringGroupId`, `bookingCode` (short human-readable, e.g. `BK-7F3K2`)
- New `RecurringBooking` (userId, venueId, rule: weekly day/time, startDate, endDate/count)
- New `Waitlist` (userId, venueId, startTime, endTime, notifiedAt)
- New `BookingParticipant` (bookingId, userId or email, status INVITED/ACCEPTED)

### Backend
- [x] Reschedule booking (atomic in one locked transaction: old marked moved, new created with the same status and repriced, guests carried over; until 2 h before start)
- [x] Recurring bookings (same local time weekly, 2–12 weeks) with per-occurrence conflict report and preview; cancel whole series
- [x] Waitlist: first in line is notified when a matching time frees up (cancel, expiry, reschedule, closure removed); 30 min to book, then the next person
- [x] Invite friends to a booking (email link, accept/decline), participant list; accepted guests can view the booking
- [x] Booking code (`BK-XXXXXX`) + QR; provider check-in endpoint (1 h before start to end), no-show marking, today's arrivals
- [x] Add-to-calendar (.ics file) in confirmation emails

### Frontend
- [x] Reschedule with the booking picker (own time shown as free)
- [x] "Repeat every week" option with per-week availability
- [x] "Join waitlist" on taken times; waitlist list on My Bookings
- [x] Booking detail page with QR code, participants, series and timeline
- [x] Provider check-in page with camera QR scanning (jsQR) and code entry

**Done when:** a customer can reschedule, book a weekly series, and join a waitlist.

---

## Phase 6 — Admin & Platform Management

### Schema
- New `AuditLog` (actorId, action, entityType, entityId, before/after JSON, ip, createdAt)
- `Venue`: `approvalStatus` (`PENDING | APPROVED | REJECTED`), `rejectionReason`
- `Review`: `status` (`VISIBLE | HIDDEN | FLAGGED`), `ReviewReport` table (reporter, reason)
- New `Coupon` (code, type percent/flat, value, maxUses, perUserLimit, minAmount, validFrom/To, venueId nullable)
- New `PlatformSetting` (key/value — commission %, hold minutes, etc.)

### Backend
- [x] Suspend / ban / reactivate users (reason required, emailed to the user; signs them out everywhere; a suspended provider's venues disappear from search; admins can't act on themselves or other admins)
- [x] Venue approval workflow: providers' new venues start `PENDING` and are hidden until approved; rejecting needs a note and editing sends the venue back to the queue; the owner is notified (`VENUE_REVIEWED`). Admin-created venues go live at once. Can be switched off with the `requireVenueApproval` setting
- [x] Review moderation: anyone signed in can report a review once (it becomes `FLAGGED`); admins hide/restore it; hidden reviews leave the venue page and its rating
- [x] Coupons: percent (optional cap) or flat, min amount, total and per-customer limits, validity window, one venue or all; checked when booking under a per-code lock so the last use can't be taken twice; cancelled/expired bookings give the use back; the code carries over on reschedule; not for weekly series; used codes can only be switched off, not deleted
- [x] Audit log (`AuditLog`): request middleware records actor, IP and user agent; written for every admin action plus password change/reset, "sign out everywhere" and venue deletion; before/after of changed fields only
- [x] Platform analytics: GMV, bookings per day, conversion of online requests, estimated commission, coupon discounts, top venues and cities, monthly signup cohorts (6 months), date range up to a year
- [x] Admin search across users, venues and bookings (name, email, city, booking code or id)
- [x] Platform settings (`requireVenueApproval`, `commissionPercent`, `defaultPendingHoldMinutes`), validated and audit-logged

### Frontend
- [x] Admin user detail page with suspend/ban/reactivate, bookings, venues, sessions and history
- [x] Approval queue (with rejection notes), review moderation queue with reports
- [x] Coupon manager
- [x] Audit log viewer with filters and before/after view
- [x] Analytics dashboard with date range picker (GMV chart with table view, conversion, cohorts heatmap)
- [x] Coupon input at checkout (customer), discount shown on the booking
- [x] Dashboard "needs attention" queues and global search; user/booking lists with search and filters
- [x] Providers see "Awaiting approval" / "Needs changes" with the admin's note; customers can report reviews

Migration `20260928140000_admin_platform` (not yet applied to Supabase).

**Done when:** every admin action is audit-logged and new venues require approval.

---

## Phase 7 — Quality, Performance & UX Polish

- [x] Sentry (server + client) error tracking — off until `SENTRY_DSN` (server) / `VITE_SENTRY_DSN` (client) are set; reports 5xx errors, failed background tasks and jobs, uncaught client errors and crashed pages (error boundary). No tracing, no personal data; the client SDK is only downloaded when a DSN is set
- [ ] Playwright E2E tests for critical flows (signup; search → book → cancel; provider creates a venue, opens it with a template, admin approves it) — written and now run by the `e2e` job in CI (seeded Postgres, API, `vite preview`); the search test was clicking a "Search" button that doesn't exist (the form's button is "Apply"), fixed. Only the signup test has passed so far (the laptop can't run the rest), so tick this once the CI job is green after the next push
- [x] Caching for venue pages and the popular list — decided 2026-09-28: **in-process cache** (TTL + explicit invalidation + shared in-flight loads) instead of Redis, same reasoning as Phase 2 (single API instance, no extra service). Swap `server/src/utils/cache.ts` for a shared store if the API is scaled out
- [x] DB index review with `EXPLAIN` on hot queries — `server/scripts/explain-hot-queries.ts` (auto_explain on seeded data); added `Booking(venueId, createdAt)` and `Review(venueId, createdAt)`; everything else already used good plans at ~9k bookings
- [x] Code-splitting routes (main bundle 911 kB → 290 kB), image lazy-loading, gallery image fetched first
- [ ] Lighthouse ≥ 90 — Lighthouse CI runs in the same `e2e` job on /login and /register (`client/lighthouserc.json`): accessibility, best practices and SEO must reach 90, performance warns only (runner speed varies). Signed-out page loads no longer log a 401 (`POST /auth/refresh` without a cookie now answers 204). Not measured yet; tick once CI reports
- [x] PWA (installable, offline shell) — hand-written service worker: network-first pages, cached hashed assets, API never cached; offline banner
- [x] Dark mode (device / light / dark toggle, no flash on load), accessibility pass (skip link, keyboard focus ring, labelled landmarks, reduced motion, WCAG AA contrast for grey text and teal buttons, nested form bug fixed)
- [x] i18n (English + Hindi) — every page translated (~1,100 strings in `client/src/i18n/messages/<area>.ts`, Hindi in `messages/hi/`, a missing Hindi string fails the type check); Hindi is downloaded only when chosen (≈19 kB gzipped); dates, times, weekdays, sports, amenities and statuses follow the language. Still English: text written by the server (emails, notification titles and bodies, API error messages, pricing rule names)
- [x] API versioning (`/api/v1`, old `/api` kept with a `Deprecation` header) and complete Swagger docs (87 paths)
- [x] Seed script with realistic demo data — 6 providers, 80 customers, 24 venues in 8 cities, ~8.5k bookings over 4 months, reviews, coupons, admin queues; deterministic; re-running replaces only `@bookit.local` data

Migration `20260928170000_index_review` (not yet applied to Supabase).

---

## Phase 8 — Real Payments (last)

Gateway: **Razorpay** (decided 2026-09-29; India: UPI, cards, netbanking). **Per-venue choice**: each venue is *pay at the venue* (default — every existing venue keeps working unchanged) or *pay online when booking*.

### Schema
- `Venue.paymentMode` (`PAY_AT_VENUE | PAY_ONLINE`); `BookingStatus.AWAITING_PAYMENT` (holds the time — overlap constraint extended); notification type `PAYMENT_REFUNDED`
- `Payment` (booking, amount in paise, gateway order/payment ids, status `CREATED | AUTHORIZED | CAPTURED | FAILED | PARTIALLY_REFUNDED | REFUNDED`, method, raw), `Refund` (amount, reason, status, gateway refund id, attempts), `WebhookEvent` (gateway event id — dedupe), `LedgerEntry` (SALE/REFUND: gross, commission, provider share, payout), `Payout`
- Decided: no `REFUNDED` booking status — a cancelled booking's money state lives on its payment. No `ProviderPayoutAccount` yet (payouts are recorded manually, see below)

Migrations `20260929120000_payments` and `20260929120100_payments_holds` (not yet applied to Supabase).

### Flow
- [x] Customer picks a time → booking `AWAITING_PAYMENT`, time held for `PAYMENT_HOLD_MINUTES` (10) by the expiry job; a free booking (100% coupon) is confirmed at once
- [x] Server prices it (Phase 4 pricing + Phase 6 coupon) and creates the gateway order — the client never sends an amount; if the gateway is down the booking is dropped and the time released
- [x] Checkout returns a signed result; the server checks the signature and re-fetches the payment from the gateway (captures it if the account doesn't auto-capture)
- [x] **Webhook is the source of truth**: signature checked on the raw body, stored by event id and processed once, failed processing left for the gateway to retry; a sweep asks the gateway about orders nobody reported (browser closed + webhook lost)
- [x] Settling is idempotent and takes the venue lock: paid → `CONFIRMED`; paid after the hold ran out → revived if the time is still free, otherwise refunded in full; duplicate payments refunded
- [x] Cancellation → Phase 4 policy decides the refund (venue cancellations refund fully) → refund job (retried; looks for its own receipt at the gateway first, so it can't refund twice) → `PARTIALLY_REFUNDED` / `REFUNDED`
- [x] Commission (platform setting) recorded per sale in the ledger; refunds take back the same share. [ ] Automatic payout via Razorpay Route — payouts are recorded by an admin after a bank transfer for now
- [ ] Invoices (PDF) — the confirmation email is the receipt for now
- Weekly series aren't offered at pay-online venues; a paid booking can only be moved to a time with the same price

### Also
- [ ] Split payment among participants (Phase 5 invites)
- [x] Provider earnings page (sales, refunds, commission, their share, to be paid out, entries, last payout)
- [x] Admin payments page: overview with reconciliation (orphan payments, confirmed-but-unpaid bookings, stuck and failed refunds with retry, failed webhooks), all payments with search, payouts (what's owed per provider, record a payout, history)
- [x] Fake gateway for development and tests (`PAYMENT_GATEWAY=fake`, refused in production); webhook tests with signed Razorpay-shaped payloads (`server/tests/payments.test.ts`). [ ] End-to-end run against Razorpay **test mode** (needs test keys)
- [x] Never trust amount from client; all money in integer paise

To go live: set `PAYMENT_GATEWAY=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` on Render, add the webhook `https://<render>/api/v1/payments/webhook` in the Razorpay dashboard (events `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`, `refund.processed`, `refund.failed`), then switch venues to *pay online*.

**Done when:** a paid booking survives webhook retries, browser close mid-payment, and hold expiry without double charges or ghost bookings. — covered by the payments test suite with the fake gateway; still to be tried with Razorpay test keys.

---

## Dependency order

```text
Phase 0 ──► Phase 1 ──► Phase 2 ──┬──► Phase 3 ──► Phase 5
                                  ├──► Phase 4 ──┘      │
                                  └──► Phase 6 ─────────┤
                                     Phase 7 (ongoing) ─┤
                                                        ▼
                                                    Phase 8
```

Phases 3, 4 and 6 can be reordered after Phase 2. Phase 8 needs 0 (double-booking fix), 2 (hold expiry), 4 (pricing + cancellation policy) and ideally 6 (coupons).
