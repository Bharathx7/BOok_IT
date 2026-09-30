# BookIt — User Stories

What each role can do today, and where the rest is planned. Status reflects the code on `phase-0-hardening`;
phases refer to [`ROADMAP.md`](ROADMAP.md).

Legend: ✅ done · 🟡 partial · ⏳ planned (phase)

## Roles

| Role | How you get it |
|---|---|
| `USER` (customer) | Signing up. Registration always creates a `USER`. |
| `PROVIDER` (venue owner) | Set on the account by an admin/DB — there is no provider sign-up flow yet (⏳ Phase 1/6). |
| `ADMIN` | Set directly in the database. |

## Customer (`USER`)

| Status | Story |
|---|---|
| ✅ | As a customer I can sign up and log in, and stay logged in via a refresh token. |
| ✅ | I can browse all venues, page by page. |
| 🟡 | I can filter venues by location (address text), category and date. *Filtering happens in the browser; server-side search, sport/price/rating filters and "near me" are ⏳ Phase 3.* |
| ✅ | I can open a venue and see its available time slots, shown in the venue's local time. |
| ✅ | I can book a time inside an available slot; if someone else already holds that time I get a clear "already booked" error, even if we click at the same moment. |
| ✅ | I can see my bookings with their status (Pending / Confirmed / Cancelled / Completed), page by page. |
| ✅ | I can cancel my own booking unless it is already cancelled or completed. |
| ✅ | I get emails when a booking is confirmed or cancelled, and a reminder within 24 hours before a confirmed booking. |
| 🟡 | I see my booking status change live without refreshing. *The server already sends private Socket.io events to the right people, but no page reacts to them yet — notification bell and toasts are ⏳ Phase 2.* |
| ✅ | I can rate (1–5) and review a booking once it is completed — one review per booking. |
| ⏳ | Reschedule a booking, recurring bookings, waitlist, invite friends, QR check-in — Phase 5. |
| ⏳ | Favourite venues, map view, photo gallery — Phase 3. |
| ⏳ | Verify email, reset password, edit profile, log out everywhere — Phase 1. |
| ⏳ | Pay online and get refunds per the cancellation policy — Phase 8. |

## Provider (`PROVIDER`)

| Status | Story |
|---|---|
| ✅ | As a provider I can create, edit and delete my venues (delete is blocked once a venue has bookings, slots or reviews). |
| ✅ | I can open availability slots on a calendar, in my venue's timezone; overlapping slots are rejected. |
| ✅ | I can edit and delete my slots. |
| ✅ | I can see bookings for my venues, page by page. |
| ✅ | I can confirm a pending booking, mark a confirmed booking completed, or cancel a booking for my venue. |
| ✅ | I have a dashboard and a calendar list of upcoming bookings. |
| ⏳ | Bulk slot templates, blackout dates, peak pricing, cancellation policies, reply to reviews, analytics, CSV export — Phase 4. |
| ⏳ | Choose a venue's timezone in the venue form (stored and used already; defaults to `Asia/Kolkata`). |

## Admin (`ADMIN`)

| Status | Story |
|---|---|
| ✅ | As an admin I can see platform stats on a dashboard. |
| ✅ | I can list all users, providers/venues and bookings, page by page. |
| ✅ | I can confirm, complete or cancel any booking, and edit or delete any venue or slot. |
| ⏳ | Suspend/ban users, approve new venues, moderate reviews, coupons, audit log, analytics with date ranges — Phase 6. |

## Rules enforced by the API

- A booking must start in the future, end after it starts, and fit inside one of the venue's time slots.
- Two `PENDING`/`CONFIRMED` bookings for the same venue can never overlap (enforced by the database, see
  [`ER-diagram.md`](ER-diagram.md)).
- Status changes follow [`booking-lifecycle.md`](booking-lifecycle.md).
- Customers only see and manage their own bookings; providers only their own venues' bookings, venues and slots.
