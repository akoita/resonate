import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SessionLookupView, { type SessionLookupViewProps } from "./SessionLookupView";

function render(overrides: Partial<SessionLookupViewProps> = {}) {
  return renderToStaticMarkup(
    <SessionLookupView allowed value="" error={null} onValueChange={vi.fn()} onSubmit={vi.fn()} {...overrides} />,
  );
}

describe("SessionLookupView (#2259)", () => {
  it("offers a session id field and a working submit, and says the lookup is logged", () => {
    const html = render({ value: "session-1" });
    expect(html).toContain("<h1>Session events</h1>");
    expect(html).toContain('value="session-1"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("Show events");
    expect(html).toContain("is logged");
    expect(html).toContain("never what the listener typed");
  });

  it("shows a validation error on the field", () => {
    const html = render({ error: "Enter a session id." });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Enter a session id.");
  });

  it("denies anyone who is not an admin, with no form", () => {
    const html = render({ allowed: false });
    expect(html).toContain("Admins only");
    expect(html).not.toContain("<form");
  });
});
