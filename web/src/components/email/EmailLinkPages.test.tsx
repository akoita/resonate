/**
 * #2169: the confirm and unsubscribe pages. The unit suite has no DOM and does
 * not run effects, so states are asserted through the views, the first paint
 * through the clients, and the "needs a click" guarantee by checking that
 * rendering never calls the API.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  confirmContactEmail: vi.fn(() => new Promise(() => {})),
  unsubscribeEmail: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), ...api }));

import ConfirmEmailPage from "../../app/email/confirm/page";
import UnsubscribeEmailPage from "../../app/email/unsubscribe/page";
import {
  ConfirmEmailClient,
  ConfirmEmailView,
  UnsubscribeClient,
  UnsubscribeView,
} from "./EmailLinkPages";

beforeEach(() => {
  api.confirmContactEmail.mockClear();
  api.unsubscribeEmail.mockClear();
});

describe("ConfirmEmailView", () => {
  const noop = () => undefined;

  it("shows progress while confirming", () => {
    const html = renderToStaticMarkup(<ConfirmEmailView state={{ status: "working" }} onRetry={noop} />);
    expect(html).toContain("Confirming your email");
  });

  it("shows success with a link to Settings", () => {
    const html = renderToStaticMarkup(<ConfirmEmailView state={{ status: "confirmed" }} onRetry={noop} />);
    expect(html).toContain("Email confirmed");
    expect(html).toContain("never for marketing");
    expect(html).toContain('href="/settings?section=email"');
  });

  it("explains an expired or used link and links to Settings to resend", () => {
    const html = renderToStaticMarkup(<ConfirmEmailView state={{ status: "invalid" }} onRetry={noop} />);
    expect(html).toContain("This link does not work");
    expect(html).toContain("expired or was already used");
    expect(html).toContain('href="/settings?section=email"');
    expect(html).toContain("Go to email settings");
  });

  it("explains a missing token", () => {
    const html = renderToStaticMarkup(<ConfirmEmailView state={{ status: "missing" }} onRetry={noop} />);
    expect(html).toContain("needs the link from your confirmation email");
  });

  it("offers a retry after a failure that is not the link's fault", () => {
    const html = renderToStaticMarkup(
      <ConfirmEmailView state={{ status: "error", message: "Something went wrong. Please try again." }} onRetry={noop} />,
    );
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
  });
});

describe("UnsubscribeView", () => {
  const noop = () => undefined;

  it("shows the button first and says what it does", () => {
    const html = renderToStaticMarkup(<UnsubscribeView state={{ status: "ready" }} onUnsubscribe={noop} />);
    expect(html).toContain("Stop these emails");
    expect(html).toContain("still appears in the app");
    expect(html).toContain('href="/settings?section=email"');
    expect(html).not.toContain("You are unsubscribed");
  });

  it("disables the button while working", () => {
    const html = renderToStaticMarkup(<UnsubscribeView state={{ status: "working" }} onUnsubscribe={noop} />);
    expect(html).toContain("Stopping...");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("confirms which category was turned off", () => {
    const html = renderToStaticMarkup(
      <UnsubscribeView state={{ status: "done", category: "incident" }} onUnsubscribe={noop} />,
    );
    expect(html).toContain("You are unsubscribed");
    expect(html).toContain("Incident notices");
    expect(html).toContain('href="/settings?section=email"');
    expect(html).not.toContain("Stop these emails");
  });

  it("copes with a success that names no known category", () => {
    const html = renderToStaticMarkup(<UnsubscribeView state={{ status: "done", category: null }} onUnsubscribe={noop} />);
    expect(html).toContain("this kind of notice");
  });

  it("explains an invalid link", () => {
    const html = renderToStaticMarkup(<UnsubscribeView state={{ status: "invalid" }} onUnsubscribe={noop} />);
    expect(html).toContain("This link does not work");
    expect(html).toContain("not valid");
  });

  it("explains a missing token and a failure", () => {
    expect(renderToStaticMarkup(<UnsubscribeView state={{ status: "missing" }} onUnsubscribe={noop} />)).toContain(
      "needs the link from a notice email",
    );
    const failed = renderToStaticMarkup(
      <UnsubscribeView state={{ status: "error", message: "Something went wrong. Please try again." }} onUnsubscribe={noop} />,
    );
    expect(failed).toContain("Something went wrong");
    expect(failed).toContain("Try again");
  });
});

describe("the clients' first paint", () => {
  it("unsubscribe shows the button and never calls the API on its own", () => {
    const html = renderToStaticMarkup(<UnsubscribeClient token="tok" />);
    expect(html).toContain("Stop these emails");
    expect(api.unsubscribeEmail).not.toHaveBeenCalled();
  });

  it("unsubscribe without a token has no button", () => {
    const html = renderToStaticMarkup(<UnsubscribeClient token={null} />);
    expect(html).toContain("This link does not work");
    expect(html).not.toContain("Stop these emails");
  });

  it("confirm starts in the working state with a token, and reports a missing one", () => {
    expect(renderToStaticMarkup(<ConfirmEmailClient token="tok" />)).toContain("Confirming your email");
    expect(renderToStaticMarkup(<ConfirmEmailClient token={null} />)).toContain(
      "needs the link from your confirmation email",
    );
  });
});

describe("the pages read the token from the awaited searchParams", () => {
  it("confirm", async () => {
    const element = await ConfirmEmailPage({ searchParams: Promise.resolve({ token: "abc" }) });
    expect(element.props.token).toBe("abc");
    const none = await ConfirmEmailPage({ searchParams: Promise.resolve({}) });
    expect(none.props.token).toBeNull();
  });

  it("unsubscribe", async () => {
    const element = await UnsubscribeEmailPage({ searchParams: Promise.resolve({ token: "abc" }) });
    expect(element.props.token).toBe("abc");
    expect(renderToStaticMarkup(element)).toContain("Stop these emails");
    expect(api.unsubscribeEmail).not.toHaveBeenCalled();
  });
});
