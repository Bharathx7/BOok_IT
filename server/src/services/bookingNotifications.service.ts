import { env } from "../config/env.js";
import type { EmailContent } from "../emails/layout.js";
import { formatInTimeZone } from "../utils/datetime.js";
import { notify } from "./notification.service.js";
import { buildIcs } from "../utils/ics.js";

// Who hears about each booking event, and how:
//
// | event      | customer              | venue owner          |
// |------------|-----------------------|----------------------|
// | requested  | -                     | in-app + email       |
// | confirmed  | in-app + email        | -                    |
// | cancelled  | email (+ in-app if    | in-app (unless they  |
// |            | someone else did it)  | cancelled it)        |
// | completed  | in-app (review nudge) | -                    |
// | expired    | in-app + email        | in-app               |
// | reminder   | in-app + email        | -                    |

interface Party {
  id: string;
  name: string;
  email: string;
}

export interface BookingWithParties {
  id: string;
  userId: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  expiresAt: Date | null;
  bookingCode?: string | null;
  user: Party;
  venue: {
    id: string;
    name: string;
    timezone: string;
    ownerId: string;
    owner: Party;
  };
}

const customerBookingsUrl = () => `${env.APP_URL}/customer/bookings`;
const ownerBookingsUrl = () => `${env.APP_URL}/provider/bookings`;

const startsAt = (booking: BookingWithParties) =>
  formatInTimeZone(booking.startTime, booking.venue.timezone);

const details = (booking: BookingWithParties): [string, string][] => [
  ["Venue", booking.venue.name],
  ["Starts", startsAt(booking)],
  ["Ends", formatInTimeZone(booking.endTime, booking.venue.timezone)],
];

const dataOf = (booking: BookingWithParties) => ({
  bookingId: booking.id,
  venueId: booking.venueId,
});

const email = (to: string, subject: string, content: EmailContent) => ({ to, subject, content });

/** Adds an .ics "add to calendar" file to a booking email. */
const withCalendar = (booking: BookingWithParties, message: ReturnType<typeof email>) => ({
  ...message,
  attachments: [
    {
      filename: "bookit-booking.ics",
      contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      content: buildIcs({
        uid: booking.id,
        start: booking.startTime,
        end: booking.endTime,
        summary: `BookIt: ${booking.venue.name}`,
        location: booking.venue.name,
        description: booking.bookingCode ? `Booking code ${booking.bookingCode}` : null,
        url: `${env.APP_URL}/customer/bookings/${booking.id}`,
      }),
    },
  ],
});

export async function notifyBookingRequested(booking: BookingWithParties) {
  const { owner } = booking.venue;
  const deadline = booking.expiresAt
    ? formatInTimeZone(booking.expiresAt, booking.venue.timezone)
    : undefined;

  await notify({
    userId: owner.id,
    type: "BOOKING_REQUESTED",
    title: "New booking request",
    body: `${booking.user.name} requested ${booking.venue.name} for ${startsAt(booking)}.${
      deadline ? ` Confirm by ${deadline}.` : ""
    }`,
    data: dataOf(booking),
    email: email(owner.email, `BookIt - New booking request for ${booking.venue.name}`, {
      preview: `${booking.user.name} wants to book ${booking.venue.name}.`,
      heading: "New booking request",
      greeting: `Hello ${owner.name},`,
      paragraphs: [
        `${booking.user.name} requested a booking at ${booking.venue.name}.`,
        deadline
          ? `Please confirm it by ${deadline}, otherwise the request expires and the time is released.`
          : "Please confirm or decline it.",
      ],
      details: details(booking),
      button: { label: "Review booking", url: ownerBookingsUrl() },
    }),
  });
}

export async function notifyBookingConfirmed(booking: BookingWithParties) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_CONFIRMED",
    title: "Booking confirmed",
    body: `${booking.venue.name} confirmed your booking for ${startsAt(booking)}.`,
    data: dataOf(booking),
    email: withCalendar(booking, email(booking.user.email, "BookIt - Booking confirmed", {
      preview: `You're all set at ${booking.venue.name}.`,
      heading: "Your booking is confirmed",
      greeting: `Hello ${booking.user.name},`,
      paragraphs: [
        "Good news - the venue confirmed your booking.",
        ...(booking.bookingCode ? [`Show booking code ${booking.bookingCode} (or its QR code in the app) when you arrive.`] : []),
      ],
      details: [...details(booking), ...(booking.bookingCode ? [["Booking code", booking.bookingCode] as [string, string]] : [])],
      button: { label: "View booking", url: `${env.APP_URL}/customer/bookings/${booking.id}` },
      footnote: "The attached calendar file adds it to your calendar. We'll also send a reminder before it starts.",
    })),
  });
}

const rupeesText = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Online payment received: the booking is confirmed straight away. */
export async function notifyPaymentConfirmed(booking: BookingWithParties, amountPaise: number) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_CONFIRMED",
    title: "Payment received - booking confirmed",
    body: `You paid ${rupeesText(amountPaise)} for ${booking.venue.name} on ${startsAt(booking)}. See you there!`,
    data: dataOf(booking),
    email: withCalendar(booking, email(booking.user.email, "BookIt - Payment received, booking confirmed", {
      preview: `${rupeesText(amountPaise)} paid for ${booking.venue.name}.`,
      heading: "You're booked",
      greeting: `Hello ${booking.user.name},`,
      paragraphs: [
        `We received your payment of ${rupeesText(amountPaise)} and your booking is confirmed.`,
        ...(booking.bookingCode ? [`Show booking code ${booking.bookingCode} (or its QR code in the app) when you arrive.`] : []),
      ],
      details: [
        ...details(booking),
        ["Amount paid", rupeesText(amountPaise)],
        ...(booking.bookingCode ? [["Booking code", booking.bookingCode] as [string, string]] : []),
      ],
      button: { label: "View booking", url: `${env.APP_URL}/customer/bookings/${booking.id}` },
      footnote: "This email is your receipt. The attached calendar file adds the booking to your calendar.",
    })),
  });
}

/** The owner hears about a paid booking once the money is in (nothing to confirm). */
export async function notifyOwnerPaidBooking(booking: BookingWithParties, amountPaise: number) {
  const { owner } = booking.venue;
  const paid = amountPaise > 0 ? `and paid ${rupeesText(amountPaise)} ` : "(free with a coupon) ";
  await notify({
    userId: owner.id,
    type: "BOOKING_REQUESTED",
    title: "New paid booking",
    body: `${booking.user.name} booked ${paid}for ${booking.venue.name} on ${startsAt(booking)}. It's confirmed.`,
    data: dataOf(booking),
    email: email(owner.email, `BookIt - New booking at ${booking.venue.name}`, {
      preview: `${booking.user.name} paid ${rupeesText(amountPaise)}.`,
      heading: "New paid booking",
      greeting: `Hello ${owner.name},`,
      paragraphs: [`${booking.user.name} booked ${booking.venue.name} and paid online. The booking is confirmed; nothing else to do.`],
      details: [...details(booking), ["Paid", rupeesText(amountPaise)]],
      button: { label: "View bookings", url: ownerBookingsUrl() },
    }),
  });
}

/** Money is on its way back to the customer. */
export async function notifyRefundProcessed(booking: BookingWithParties, amountPaise: number) {
  await notify({
    userId: booking.user.id,
    type: "PAYMENT_REFUNDED",
    title: "Refund sent",
    body: `We refunded ${rupeesText(amountPaise)} for your booking at ${booking.venue.name}. Banks usually take 5-7 working days to show it.`,
    data: dataOf(booking),
    email: email(booking.user.email, "BookIt - Refund sent", {
      preview: `${rupeesText(amountPaise)} is on its way back to you.`,
      heading: "Your refund is on its way",
      greeting: `Hello ${booking.user.name},`,
      paragraphs: [
        `We've refunded ${rupeesText(amountPaise)} to the account you paid with.`,
        "Banks usually take 5-7 working days to show it.",
      ],
      details: [...details(booking), ["Refund", rupeesText(amountPaise)]],
      button: { label: "View booking", url: `${env.APP_URL}/customer/bookings/${booking.id}` },
    }),
  });
}

export async function notifyBookingCancelled(booking: BookingWithParties, cancelledById: string) {
  const byCustomer = cancelledById === booking.user.id;
  const byOwner = cancelledById === booking.venue.ownerId;

  await notify({
    userId: booking.user.id,
    type: "BOOKING_CANCELLED",
    title: "Booking cancelled",
    body: byCustomer
      ? `You cancelled your booking at ${booking.venue.name} for ${startsAt(booking)}.`
      : `Your booking at ${booking.venue.name} for ${startsAt(booking)} was cancelled by the venue.`,
    data: dataOf(booking),
    // The customer's own action needs a receipt, not an alert.
    inApp: !byCustomer,
    email: email(booking.user.email, "BookIt - Booking cancelled", {
      preview: `Your booking at ${booking.venue.name} was cancelled.`,
      heading: "Booking cancelled",
      greeting: `Hello ${booking.user.name},`,
      paragraphs: [
        byCustomer
          ? "As requested, your booking has been cancelled."
          : "Your booking was cancelled by the venue. We're sorry for the inconvenience.",
      ],
      details: details(booking),
      button: { label: "Find another slot", url: `${env.APP_URL}/customer/venues` },
      footnote: byCustomer ? "If you didn't cancel this, please contact support." : undefined,
    }),
  });

  if (!byOwner) {
    await notify({
      userId: booking.venue.owner.id,
      type: "BOOKING_CANCELLED",
      title: "Booking cancelled",
      body: `${booking.user.name}'s booking for ${startsAt(booking)} at ${booking.venue.name} was cancelled. The time is free again.`,
      data: dataOf(booking),
    });
  }
}

export async function notifyBookingCompleted(booking: BookingWithParties) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_COMPLETED",
    title: `How was ${booking.venue.name}?`,
    body: "Your booking is complete. Leave a quick review to help other players.",
    data: dataOf(booking),
  });
}

export async function notifyBookingExpired(booking: BookingWithParties) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_EXPIRED",
    title: "Booking request expired",
    body: `${booking.venue.name} didn't confirm your request for ${startsAt(booking)} in time, so it was released.`,
    data: dataOf(booking),
    email: email(booking.user.email, "BookIt - Booking request expired", {
      preview: `Your request at ${booking.venue.name} wasn't confirmed in time.`,
      heading: "Your booking request expired",
      greeting: `Hello ${booking.user.name},`,
      paragraphs: [
        "The venue didn't confirm your request in time, so it has expired and you won't be charged.",
        "The time may still be free - try booking again or pick another venue.",
      ],
      details: details(booking),
      button: { label: "Browse venues", url: `${env.APP_URL}/customer/venues` },
    }),
  });

  await notify({
    userId: booking.venue.owner.id,
    type: "BOOKING_EXPIRED",
    title: "Booking request expired",
    body: `${booking.user.name}'s request for ${startsAt(booking)} at ${booking.venue.name} expired before it was confirmed.`,
    data: dataOf(booking),
  });
}

/** An online booking whose payment wasn't completed in time (in-app only; nothing was charged). */
export async function notifyPaymentLapsed(booking: BookingWithParties) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_EXPIRED",
    title: "Payment not completed",
    body: `Your booking at ${booking.venue.name} for ${startsAt(booking)} wasn't paid in time, so the time was released. You haven't been charged.`,
    data: dataOf(booking),
  });
}

export async function notifyBookingReminder(booking: BookingWithParties, startsIn: string) {
  await notify({
    userId: booking.user.id,
    type: "BOOKING_REMINDER",
    title: `Coming up ${startsIn}`,
    body: `Your booking at ${booking.venue.name} starts ${startsIn} (${startsAt(booking)}).`,
    data: dataOf(booking),
    email: email(booking.user.email, `BookIt - Your booking starts ${startsIn}`, {
      preview: `${booking.venue.name}, ${startsAt(booking)}.`,
      heading: `Your booking starts ${startsIn}`,
      greeting: `Hello ${booking.user.name},`,
      paragraphs: ["Just a reminder about your upcoming booking."],
      details: details(booking),
      button: { label: "View booking", url: customerBookingsUrl() },
    }),
  });
}
