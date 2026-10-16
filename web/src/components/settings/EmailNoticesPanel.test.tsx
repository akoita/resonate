/**
 * #2169: every state of Settings → Email notices, rendered statically (the
 * unit suite has no DOM). The requests are covered in `lib/contactEmail.test.ts`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ContactEmailState } from "../../lib/api";
import { EmailNoticesView, formatConfirmationSent, type EmailNoticesViewProps } from "./EmailNoticesPanel";

const CATEGORIES: ContactEmailState["categories"] = [
  { category: "policy", required: false, enabled: true },
  { category: "terms", required: true, enabled: true },
  { category: "incident", required: false, enabled: false },
  { category: "moderation", required: false, enabled: true },
  { category: "account", required: true, enabled: true },
  { category: "refund", required: false, enabled: true },
];

function contact(overrides: Partial<ContactEmailState> = {}): ContactEmailState {
  return {
    available: true,
    address: "listener@example.com",
    status: "confirmed",
    disabledReason: null,
    confirmationSentAt: null,
    categories: CATEGORIES,
    ...overrides,
  };
}

function render(overrides: Partial<EmailNoticesViewProps> & { contact?: ContactEmailState } = {}) {
  const { contact: state, ...rest } = overrides;
  const props: EmailNoticesViewProps = {
    load: { status: "ready", contact: state ?? contact() },
    draft: "",
    draftError: null,
    actionError: null,
    busy: null,
    editing: false,
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onStartEditing: vi.fn(),
    onCancelEditing: vi.fn(),
    onResend: vi.fn(),
    onRemove: vi.fn(),
    onToggleCategory: vi.fn(),
    onRetry: vi.fn(),
    ...rest,
  };
  return renderToStaticMarkup(<EmailNoticesView {...props} />);
}

describe("loading and error", () => {
  it("shows a loading status", () => {
    const html = render({ load: { status: "loading" } });
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading your email settings");
  });

  it("shows the problem and a way to retry", () => {
    const html = render({ load: { status: "error", message: "Something went wrong. Please try again." } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
  });
});

describe("unavailable", () => {
  it("says so plainly and offers no form", () => {
    const html = render({ contact: contact({ available: false, address: null, status: "none", categories: [] }) });
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain("Email notices aren&#x27;t available on this deployment");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Send confirmation");
  });

  it("still lets someone remove an address that was saved earlier", () => {
    const html = render({ contact: contact({ available: false }) });
    expect(html).toContain("listener@example.com");
    expect(html).toContain("Remove address");
  });
});

describe("none", () => {
  it("shows the promise, an address field and the confirm button", () => {
    const html = render({ contact: contact({ address: null, status: "none", categories: [] }) });
    expect(html).toContain('data-state="none"');
    expect(html).toContain("Used only for platform notices. Never for marketing.");
    expect(html).toContain('type="email"');
    expect(html).toContain("Send confirmation");
    expect(html).toContain("Nothing is sent to an address you have not confirmed");
    expect(html).not.toContain("Which notices to email");
  });

  it("shows a typing problem next to the field", () => {
    const html = render({
      contact: contact({ address: null, status: "none", categories: [] }),
      draft: "nope",
      draftError: "That does not look like an email address.",
    });
    expect(html).toContain('value="nope"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("That does not look like an email address.");
  });

  it("disables the controls while saving", () => {
    const html = render({ contact: contact({ address: null, status: "none", categories: [] }), busy: "saving" });
    expect(html).toContain("Sending...");
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
  });

  it("shows a failed action beside the form", () => {
    const html = render({
      contact: contact({ address: null, status: "none", categories: [] }),
      actionError: "We could not send the confirmation email.",
    });
    expect(html).toContain("We could not send the confirmation email.");
  });
});

describe("pending", () => {
  const pending = contact({ status: "pending", confirmationSentAt: "2026-10-15T10:00:00.000Z", categories: [] });

  it("tells the person to check their inbox and offers resend, change and remove", () => {
    const html = render({ contact: pending });
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("listener@example.com");
    expect(html).toContain("Waiting for confirmation");
    expect(html).toContain("Check your inbox");
    expect(html).toContain("Resend confirmation");
    expect(html).toContain("Change address");
    expect(html).toContain("Remove");
    expect(html).not.toContain("Which notices to email");
    expect(html).not.toContain("<form");
  });

  it("opens the address form when changing", () => {
    const html = render({ contact: pending, editing: true });
    expect(html).toContain("<form");
    expect(html).toContain("Cancel");
    expect(html).toContain("A new address has to be confirmed");
    expect(html).not.toContain("Resend confirmation");
  });

  it("shows the busy label while resending", () => {
    expect(render({ contact: pending, busy: "resending" })).toContain("Sending...");
  });
});

describe("confirmed", () => {
  it("shows the address and a toggle per category", () => {
    const html = render();
    expect(html).toContain('data-state="confirmed"');
    expect(html).toContain("Confirmed");
    expect(html).toContain("Which notices to email");
    for (const label of ["Policy", "Terms", "Incident", "Moderation", "Account", "Refund"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Change address");
    expect(html).toContain("Remove");
  });

  it("locks the required categories, labels them and says why", () => {
    const html = render();
    const items = html.split("<li ").slice(1);
    const byCategory = (category: string) => items.find((item) => item.includes(`id="email-notices-${category}"`)) ?? "";

    for (const category of ["terms", "account"]) {
      const item = byCategory(category);
      expect(item).toContain('data-required="true"');
      expect(item).toMatch(/<input[^>]*checked=""[^>]*disabled=""|<input[^>]*disabled=""[^>]*checked=""/);
      expect(item).toContain(">Required<");
      expect(item).toContain("Required: ");
    }
    for (const category of ["policy", "incident", "moderation", "refund"]) {
      const item = byCategory(category);
      expect(item).toContain('data-required="false"');
      expect(item).not.toContain('disabled=""');
      expect(item).not.toContain(">Required<");
    }
  });

  it("reflects which optional categories are on", () => {
    const items = render().split("<li ").slice(1);
    const input = (category: string) => items.find((item) => item.includes(`id="email-notices-${category}"`)) ?? "";
    expect(input("policy")).toContain('checked=""');
    expect(input("incident")).not.toContain('checked=""');
  });

  it("freezes the toggles while a preference is saving", () => {
    expect(render({ busy: "preferences" })).toMatch(/<fieldset[^>]*disabled/);
  });
});

describe("disabled", () => {
  it("explains a bounce and asks for a new address", () => {
    const html = render({ contact: contact({ status: "disabled", disabledReason: "hard_bounce", categories: [] }) });
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain("Stopped");
    expect(html).toContain("bounced");
    expect(html).toContain("Notices still reach you in the app");
    expect(html).toContain("<form");
    expect(html).toContain("Send confirmation");
    expect(html).not.toContain("Which notices to email");
  });

  it("explains a complaint", () => {
    const html = render({ contact: contact({ status: "disabled", disabledReason: "complaint", categories: [] }) });
    expect(html).toContain("marked a notice as unwanted");
  });
});

describe("formatConfirmationSent", () => {
  it("formats a date and tolerates nothing", () => {
    expect(formatConfirmationSent("2026-10-15T10:00:00.000Z")).toMatch(/2026/);
    expect(formatConfirmationSent(null)).toBeNull();
    expect(formatConfirmationSent("not a date")).toBeNull();
  });
});
