// Minimal branded email layout. Table-based with inline styles, because
// most email clients ignore <style> blocks and modern CSS.

export interface EmailContent {
  /** Short line shown after the subject in inbox previews. */
  preview: string;
  heading: string;
  greeting?: string | undefined;
  paragraphs: string[];
  /** Label/value rows, e.g. venue and time. */
  details?: [string, string][] | undefined;
  button?: { label: string; url: string } | undefined;
  footnote?: string | undefined;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const BRAND = "#0d9488"; // teal-600, matches the app

export function renderEmail(content: EmailContent): RenderedEmail {
  const paragraphsHtml = [content.greeting, ...content.paragraphs]
    .filter((line): line is string => Boolean(line))
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(line)}</p>`
    )
    .join("");

  const detailsHtml = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border:1px solid #e2e8f0;border-radius:12px;">
        ${content.details
          .map(
            ([label, value]) =>
              `<tr>
                <td style="padding:10px 16px;font-size:13px;color:#64748b;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:10px 16px;font-size:14px;color:#0f172a;font-weight:600;">${escapeHtml(value)}</td>
              </tr>`
          )
          .join("")}
      </table>`
    : "";

  const buttonHtml = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
        <tr><td style="border-radius:12px;background:${BRAND};">
          <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(content.button.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 16px;font-size:12px;line-height:18px;color:#94a3b8;">Or paste this link into your browser:<br>${escapeHtml(content.button.url)}</p>`
    : "";

  const footnoteHtml = content.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#64748b;">${escapeHtml(content.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.heading)}</title></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preview)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td style="padding:0 8px 16px;">
            <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;background:${BRAND};color:#ffffff;font-weight:700;">B</span>
            <span style="margin-left:8px;font-size:16px;font-weight:600;color:#0f172a;vertical-align:middle;">BookIt</span>
          </td></tr>
          <tr><td style="background:#ffffff;border-radius:20px;padding:32px;border:1px solid #e2e8f0;">
            <h1 style="margin:0 0 20px;font-size:22px;line-height:30px;color:#0f172a;">${escapeHtml(content.heading)}</h1>
            ${paragraphsHtml}
            ${detailsHtml}
            ${buttonHtml}
            ${footnoteHtml}
          </td></tr>
          <tr><td style="padding:16px 8px;font-size:12px;color:#94a3b8;">
            You're receiving this because you have a BookIt account. You can change which emails you get in your notification settings.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    content.heading,
    "",
    ...[content.greeting, ...content.paragraphs].filter((line): line is string => Boolean(line)),
    ...(content.details?.length
      ? ["", ...content.details.map(([label, value]) => `${label}: ${value}`)]
      : []),
    ...(content.button ? ["", `${content.button.label}: ${content.button.url}`] : []),
    ...(content.footnote ? ["", content.footnote] : []),
  ].join("\n");

  return { html, text };
}
