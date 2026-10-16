import { isEmailRequiredCategory } from "../notifications/notice_validation";
import type { EmailMessage } from "./email_transport";
import { signUnsubscribeToken } from "./email_tokens";

export interface EmailLinkSettings {
  frontendUrl: string;
  publicApiUrl: string;
  linkSigningSecret: string;
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

function paragraphsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function wrapHtml(inner: string): string {
  return (
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    inner +
    "</div>"
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

/**
 * The email for one platform notice (#2169): subject is the notice title, the
 * body is the notice body plus an absolute link, and a footer says why the
 * person received it. Optional categories carry an unsubscribe link and the
 * RFC 8058 one-click headers; required categories explain they cannot be
 * turned off and carry neither.
 */
export function renderNoticeEmail(input: NoticeEmailInput, settings: EmailLinkSettings): EmailMessage {
  const required = isEmailRequiredCategory(input.category);
  const link = input.link ? `${settings.frontendUrl}${input.link}` : `${settings.frontendUrl}/`;
  const settingsUrl = `${settings.frontendUrl}/settings?section=email`;

  const footerLines = [
    "You are receiving this because you added this address to your Resonate account for platform notices. We never use it for marketing.",
  ];
  const headers: Record<string, string> = {};
  let unsubscribeUrl: string | null = null;
  if (required) {
    footerLines.push(
      `This is a required ${input.category} notice, so it is sent while this address is on your account. You can remove the address in your settings: ${settingsUrl}`,
    );
  } else {
    unsubscribeUrl = unsubscribePageUrl(settings, input.userId, input.category);
    footerLines.push(`Manage email notices: ${settingsUrl}`);
    footerLines.push(`Stop ${input.category} emails: ${unsubscribeUrl}`);
    headers["List-Unsubscribe"] = `<${oneClickUnsubscribeUrl(settings, input.userId, input.category)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const text = [input.body, "", `Open Resonate: ${link}`, "", "--", ...footerLines].join("\n");
  const html = wrapHtml(
    paragraphsHtml(input.body) +
      `<p style="margin:0 0 16px"><a href="${escapeHtml(link)}">Open Resonate</a></p>` +
      '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
      '<p style="margin:0 0 8px;font-size:12px;color:#555">You are receiving this because you added this address to your Resonate account for platform notices. We never use it for marketing.</p>' +
      (required
        ? `<p style="margin:0;font-size:12px;color:#555">This is a required ${escapeHtml(input.category)} notice, so it is sent while this address is on your account. You can remove the address in your <a href="${escapeHtml(settingsUrl)}">settings</a>.</p>`
        : `<p style="margin:0;font-size:12px;color:#555"><a href="${escapeHtml(settingsUrl)}">Manage email notices</a> &middot; <a href="${escapeHtml(unsubscribeUrl ?? settingsUrl)}">Stop ${escapeHtml(input.category)} emails</a></p>`),
  );

  return { to: input.to, subject: singleLine(input.title), text, html, headers };
}

/** The double opt-in message. Not a notice: it carries no unsubscribe link. */
export function renderConfirmationEmail(
  to: string,
  rawToken: string,
  settings: Pick<EmailLinkSettings, "frontendUrl">,
): EmailMessage {
  const url = `${settings.frontendUrl}/email/confirm?token=${encodeURIComponent(rawToken)}`;
  const text = [
    "Confirm this address to receive Resonate platform notices by email.",
    "",
    `Confirm: ${url}`,
    "",
    "The link works once and expires in 24 hours. If you did not ask for this, ignore this message: nothing is sent to this address until it is confirmed.",
  ].join("\n");
  const html = wrapHtml(
    '<p style="margin:0 0 12px">Confirm this address to receive Resonate platform notices by email.</p>' +
      `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}">Confirm this address</a></p>` +
      '<p style="margin:0;font-size:12px;color:#555">The link works once and expires in 24 hours. If you did not ask for this, ignore this message: nothing is sent to this address until it is confirmed.</p>',
  );
  return { to, subject: "Confirm your email for Resonate notices", text, html };
}
