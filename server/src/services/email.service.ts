import transporter from "../config/email.js";
import { env } from "../config/env.js";
import { renderEmail, type EmailContent } from "../emails/layout.js";
import { enqueue, QUEUES, registerHandler } from "../jobs/queue.js";
import { logger } from "../utils/logger.js";

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[] | undefined;
}

/** Sends immediately. Used by the email queue worker; throws so the job is retried. */
export async function sendEmailNow(message: EmailMessage) {
  if (!env.EMAIL_ENABLED) {
    logger.warn({ to: message.to, subject: message.subject }, "Email not configured, skipping send");
    return;
  }

  const redirectTo = env.EMAIL_REDIRECT_TO;

  await transporter.sendMail({
    from: `BookIt <${env.EMAIL_USER}>`,
    to: redirectTo ?? message.to,
    subject: redirectTo ? `[to ${message.to}] ${message.subject}` : message.subject,
    text: message.text,
    html: message.html,
    ...(message.attachments?.length && { attachments: message.attachments }),
  });
}

registerHandler<EmailMessage>(QUEUES.email, sendEmailNow);

/** Queues an email; a failing mail server never fails the request. */
export async function queueEmail(
  to: string,
  subject: string,
  content: EmailContent,
  attachments?: EmailAttachment[]
) {
  await enqueue(QUEUES.email, {
    to,
    subject,
    ...renderEmail(content),
    ...(attachments?.length && { attachments }),
  } satisfies EmailMessage);
}

interface AccountEmailDetails {
  to: string;
  userName: string;
}

export async function sendTestEmail(to: string) {
  await queueEmail(to, "BookIt Email Test", {
    preview: "Your BookIt backend can send email.",
    heading: "It works!",
    paragraphs: ["This is a test email from your BookIt backend."],
  });
}

export async function sendVerificationEmail(details: AccountEmailDetails & { link: string }) {
  await queueEmail(details.to, "BookIt - Verify your email", {
    preview: "Confirm your email address to start booking.",
    heading: "Verify your email",
    greeting: `Hello ${details.userName},`,
    paragraphs: ["Please confirm your email address to start booking venues."],
    button: { label: "Verify email", url: details.link },
    footnote: "This link expires in 24 hours. If you didn't create a BookIt account, you can ignore this email.",
  });
}

export async function sendPasswordResetEmail(details: AccountEmailDetails & { link: string }) {
  await queueEmail(details.to, "BookIt - Reset your password", {
    preview: "Choose a new password for your BookIt account.",
    heading: "Reset your password",
    greeting: `Hello ${details.userName},`,
    paragraphs: ["We received a request to reset your BookIt password."],
    button: { label: "Choose a new password", url: details.link },
    footnote:
      "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email - your password stays the same.",
  });
}

export async function sendPasswordChangedEmail(details: AccountEmailDetails) {
  await queueEmail(details.to, "BookIt - Your password was changed", {
    preview: "Your password was just changed.",
    heading: "Your password was changed",
    greeting: `Hello ${details.userName},`,
    paragraphs: [
      "The password for your BookIt account was just changed, and you were signed out on all other devices.",
    ],
    button: { label: "Reset password", url: `${env.APP_URL}/forgot-password` },
    footnote: "If this wasn't you, reset your password straight away.",
  });
}
