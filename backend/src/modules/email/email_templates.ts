import { isEmailRequiredCategory } from "../notifications/notice_validation";
import type { EmailMessage } from "./email_transport";
import { signUnsubscribeToken } from "./email_tokens";

export interface EmailLinkSettings {
  frontendUrl: string;
  publicApiUrl: string;
  linkSigningSecret: string;
  /** Optional plain-text operator line for the footer (`EMAIL_FOOTER_TEXT`). */
  footerText?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A subject is one line: strip anything that could start another header. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const SUBJECT_PREFIX = "[Resonate] ";
/** Long subjects are cut by some clients and read as bulk mail: stay at about 78 characters. */
const SUBJECT_MAX = 78;

function noticeSubject(title: string): string {
  const line = singleLine(title) || "Platform notice";
  const room = SUBJECT_MAX - SUBJECT_PREFIX.length;
  return SUBJECT_PREFIX + (line.length > room ? `${line.slice(0, room - 3).trimEnd()}...` : line);
}

const CATEGORY_LABELS: Record<string, string> = {
  policy: "Policy update",
  terms: "Terms update",
  incident: "Incident",
  moderation: "Moderation",
  account: "Account",
  refund: "Refund",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "Platform notice";
}

// Email-client-safe presentation: tables and inline styles only, no remote
// images, no web fonts, no tracking.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT_COLOR = "#1f2328";
const MUTED_COLOR = "#59636e";
const ACCENT_COLOR = "#4338ca";
const FOOTER_STYLE = `margin:0 0 8px;font-size:12px;line-height:1.55;color:${MUTED_COLOR}`;

function paragraphsHtml(
  text: string,
  style = `margin:0 0 16px;font-size:16px;line-height:1.55;color:${TEXT_COLOR}`,
): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="${style}">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function linkHtml(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="color:${ACCENT_COLOR};text-decoration:underline">${escapeHtml(label)}</a>`;
}

/** A button (a table cell with a background, so it survives Outlook) plus the URL written out underneath. */
function buttonHtml(url: string, label: string): string {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr>' +
    `<td align="center" bgcolor="${ACCENT_COLOR}" style="border-radius:8px;background-color:${ACCENT_COLOR}">` +
    `<a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>` +
    "</td></tr></table>" +
    `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:${MUTED_COLOR}">If the button does not work, copy this link into your browser:</p>` +
    `<p style="margin:0 0 20px;font-size:13px;line-height:1.5;word-break:break-all">${linkHtml(url, url)}</p>`
  );
}

function footerParagraph(innerHtml: string): string {
  return `<p style="${FOOTER_STYLE}">${innerHtml}</p>`;
}

function footerLinksHtml(links: Array<[label: string, url: string]>): string {
  return footerParagraph(links.map(([label, url]) => linkHtml(url, label)).join(" &middot; "));
}

function operatorFooterHtml(footerText: string | undefined): string {
  const text = (footerText ?? "").trim();
  return text ? footerParagraph(escapeHtml(text).replace(/\n/g, "<br>")) : "";
}

interface LayoutParts {
  /** The document title. */
  title: string;
  /** Small uppercase label above the heading. */
  kicker?: string;
  heading: string;
  /** Already-escaped HTML for the main content. */
  contentHtml: string;
  /** Already-escaped HTML paragraphs for the footer. */
  footerHtml: string;
}

function layoutHtml(parts: LayoutParts): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    `<title>${escapeHtml(parts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:${FONT}">` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f5f7" style="background-color:#f4f5f7"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">' +
    `<tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:20px;font-weight:700;color:${TEXT_COLOR}">Resonate</td></tr>` +
    `<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #d8dce1;border-radius:10px;padding:28px 28px 8px;font-family:${FONT}">` +
    (parts.kicker
      ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:${ACCENT_COLOR}">${escapeHtml(parts.kicker)}</p>`
      : "") +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${TEXT_COLOR}">${escapeHtml(parts.heading)}</h1>` +
    parts.contentHtml +
    "</td></tr>" +
    `<tr><td style="padding:18px 4px 0;font-family:${FONT}">${parts.footerHtml}</td></tr>` +
    "</table></td></tr></table></body></html>"
  );
}

export function unsubscribePageUrl(settings: EmailLinkSettings, userId: string, category: string): string {
  const token = signUnsubscribeToken(userId, category, settings.linkSigningSecret);
  return `${settings.frontendUrl}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function oneClickUnsubscribeUrl(settings: EmailLinkSettings, userId: string, category: string): string {
  const token = signUnsubscribeToken(userId, category, settings.linkSigningSecret);
  return `${settings.publicApiUrl}/email/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
}

export interface NoticeEmailInput {
  userId: string;
  to: string;
  category: string;
  title: string;
  body: string;
  /** In-app path the notice leads to, if any. */
  link: string | null;
}

const WHY_RECEIVED_NOTICE =
  "You are receiving this because you added this address in Resonate Settings to receive platform notices. We never use it for marketing.";
const WHY_RECEIVED_CONFIRMATION =
  "You are receiving this because someone entered this address in Resonate Settings. We never use it for marketing.";

/**
 * The email for one platform notice (#2169): a "[Resonate] <title>" subject, a
 * structured body (category, title, the notice body, a button plus the link
 * written out), and a footer saying why the person received it with links to
 * their email settings and the privacy policy. Optional categories carry an
 * unsubscribe link and the RFC 8058 one-click headers; required categories
 * explain they cannot be turned off and carry neither. The HTML and the
 * plain-text alternative are built from the same pieces.
 */
export function renderNoticeEmail(input: NoticeEmailInput, settings: EmailLinkSettings): EmailMessage {
  const required = isEmailRequiredCategory(input.category);
  const link = input.link ? `${settings.frontendUrl}${input.link}` : `${settings.frontendUrl}/`;
  const settingsUrl = `${settings.frontendUrl}/settings?section=email`;
  const privacyUrl = `${settings.frontendUrl}/privacy`;
  const label = categoryLabel(input.category);
  const operatorLine = (settings.footerText ?? "").trim();

  const headers: Record<string, string> = {};
  const textFooter = [WHY_RECEIVED_NOTICE];
  let footerHtml = footerParagraph(escapeHtml(WHY_RECEIVED_NOTICE));
  if (required) {
    const requiredLine = `This is a required ${input.category} notice, so it is sent while this address is on your account. You can remove the address in your email settings.`;
    textFooter.push(requiredLine, `Email settings: ${settingsUrl}`);
    footerHtml += footerParagraph(escapeHtml(requiredLine));
    footerHtml += footerLinksHtml([
      ["Email settings", settingsUrl],
      ["Privacy policy", privacyUrl],
    ]);
  } else {
    const unsubscribeUrl = unsubscribePageUrl(settings, input.userId, input.category);
    headers["List-Unsubscribe"] = `<${oneClickUnsubscribeUrl(settings, input.userId, input.category)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    textFooter.push(`Manage email notices: ${settingsUrl}`, `Stop ${input.category} emails: ${unsubscribeUrl}`);
    footerHtml += footerLinksHtml([
      ["Manage email notices", settingsUrl],
      [`Stop ${input.category} emails`, unsubscribeUrl],
      ["Privacy policy", privacyUrl],
    ]);
  }
  textFooter.push(`Privacy policy: ${privacyUrl}`);
  if (operatorLine) textFooter.push("", operatorLine);
  footerHtml += operatorFooterHtml(settings.footerText);

  const text = [
    `Resonate - ${label}`,
    "",
    singleLine(input.title),
    "",
    input.body,
    "",
    `Open Resonate: ${link}`,
    "",
    "--",
    ...textFooter,
  ].join("\n");

  const html = layoutHtml({
    title: singleLine(input.title),
    kicker: label,
    heading: singleLine(input.title),
    contentHtml: paragraphsHtml(input.body) + buttonHtml(link, "Open Resonate"),
    footerHtml,
  });

  return { to: input.to, subject: noticeSubject(input.title), text, html, headers };
}

/** The double opt-in message. Not a notice: it carries no unsubscribe link. */
export function renderConfirmationEmail(
  to: string,
  rawToken: string,
  settings: Pick<EmailLinkSettings, "frontendUrl" | "footerText">,
): EmailMessage {
  const url = `${settings.frontendUrl}/email/confirm?token=${encodeURIComponent(rawToken)}`;
  const settingsUrl = `${settings.frontendUrl}/settings?section=email`;
  const privacyUrl = `${settings.frontendUrl}/privacy`;
  const heading = "Confirm your email address";
  const intro =
    "You added this address in Resonate Settings to receive platform notices by email: important updates about your account, the terms and the service. Confirm it to start receiving them.";
  const expiry = "This link works once and expires in 24 hours.";
  const ignore =
    "If you did not ask for this, ignore this email. Nothing will be sent to this address unless you confirm it.";
  const operatorLine = (settings.footerText ?? "").trim();

  const text = [
    "Resonate",
    "",
    heading,
    "",
    intro,
    "",
    `Confirm this address: ${url}`,
    "",
    expiry,
    ignore,
    "",
    "--",
    WHY_RECEIVED_CONFIRMATION,
    `Email settings: ${settingsUrl}`,
    `Privacy policy: ${privacyUrl}`,
    ...(operatorLine ? ["", operatorLine] : []),
  ].join("\n");

  const html = layoutHtml({
    title: heading,
    heading,
    contentHtml:
      paragraphsHtml(intro) +
      buttonHtml(url, "Confirm this address") +
      paragraphsHtml(`${expiry}\n${ignore}`, `margin:0 0 20px;font-size:14px;line-height:1.55;color:${MUTED_COLOR}`),
    footerHtml:
      footerParagraph(escapeHtml(WHY_RECEIVED_CONFIRMATION)) +
      footerLinksHtml([
        ["Email settings", settingsUrl],
        ["Privacy policy", privacyUrl],
      ]) +
      operatorFooterHtml(settings.footerText),
  });
  return { to, subject: "Confirm your email for Resonate notices", text, html };
}
