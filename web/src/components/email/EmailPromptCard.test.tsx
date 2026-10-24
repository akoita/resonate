/**
 * #2182: every state of the optional email prompt, rendered statically (the
 * unit suite has no DOM). The show/hide/dismiss rules are in `lib/emailPrompt.test.ts`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_PROMPT_CONTEXTS, EMAIL_PROMPT_COPY, EMAIL_PROMPT_SETTINGS_HREF } from "../../lib/emailPrompt";
import { EmailPromptCardView, type EmailPromptCardViewProps } from "./EmailPromptCard";

function render(overrides: Partial<EmailPromptCardViewProps> = {}) {
  const props: EmailPromptCardViewProps = {
    context: "onboarding",
    inline: true,
    expanded: false,
    draft: "",
    draftError: null,
    actionError: null,
    busy: false,
    sent: false,
    onExpand: vi.fn(),
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onOpenSettings: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(<EmailPromptCardView {...props} />);
}

describe("onboarding step", () => {
  it("offers the optional email with a one-tap Skip, and no field until asked", () => {
    const html = render();
    expect(html).toContain("Want important notices by email too?");
    expect(html).toContain("Refunds owed, account decisions, terms changes");
    expect(html).toContain("Add an email");
    expect(html).toContain("Skip");
    expect(html).not.toContain("<input");
  });

  it("opens the address form with the wallet-link disclosure and still offers Skip", () => {
    const html = render({ expanded: true });
    expect(html).toContain("<input");
    expect(html).toContain('type="email"');
    expect(html).toContain("links it to your account, and so to your wallet");
    expect(html).toContain("never marketing");
    expect(html).toContain("Send confirmation");
    expect(html).toContain("Skip");
  });

  it("shows a typing problem or a failed send next to the field", () => {
    const html = render({ expanded: true, draftError: "That does not look like an email address.", actionError: "Something went wrong." });
    expect(html).toContain("That does not look like an email address.");
    expect(html).toContain("Something went wrong.");
    expect(html).toContain('role="alert"');
  });

  it("disables the field while sending", () => {
    const html = render({ expanded: true, busy: true });
    expect(html).toContain("Sending...");
    expect(html).toContain("disabled");
  });

  it("says to check the inbox once the confirmation was sent", () => {
    const html = render({ expanded: true, sent: true });
    expect(html).toContain("Check your inbox");
    expect(html).toContain("nothing is emailed to you");
    expect(html).not.toContain("<input");
  });
});

describe("contextual prompts", () => {
  it.each(EMAIL_PROMPT_CONTEXTS.filter((context) => context !== "onboarding"))(
    "%s links to Settings and can be dismissed, without an inline form",
    (context) => {
      const html = render({ context, inline: false });
      expect(html).toContain(EMAIL_PROMPT_COPY[context].heading);
      expect(html).toContain(`href="${EMAIL_PROMPT_SETTINGS_HREF}"`);
      expect(html).toContain("Not now");
      expect(html).not.toContain("<input");
    },
  );

  it("asks about refunds after a pledge", () => {
    expect(render({ context: "pledge", inline: false })).toContain(
      "Get an email if a refund is ever owed to you",
    );
  });
});
