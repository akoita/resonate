import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UploadLimitsPanel, { getUploadLimitsConfirmCopy, type UploadLimitsState } from "./UploadLimitsPanel";

function render(state: UploadLimitsState) {
  return renderToStaticMarkup(
    <UploadLimitsPanel state={state} busy={false} onRequest={() => {}} onRetry={() => {}} />,
  );
}

describe("UploadLimitsPanel (#2659)", () => {
  it("offers to lift the limits of a new account", () => {
    const html = render({ status: "ready", lifted: false, verified: false });
    expect(html).toContain("upload limits of a new account");
    expect(html).toContain("Lift upload limits");
  });

  it("offers to restore lifted limits", () => {
    const html = render({ status: "ready", lifted: true, verified: false });
    expect(html).toContain("Upload limits are lifted");
    expect(html).toContain("Restore upload limits");
  });

  it("has nothing to change for a verified artist", () => {
    const html = render({ status: "ready", lifted: false, verified: true });
    expect(html).toContain("Verified artists have no upload limits.");
    expect(html).not.toContain("<button");
  });

  it("shows a load error with a retry", () => {
    const html = render({ status: "error", message: "Could not load upload limits." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  it("words the confirmation for each direction", () => {
    expect(getUploadLimitsConfirmCopy(true, "Ada").title).toBe("Lift upload limits?");
    expect(getUploadLimitsConfirmCopy(false, "Ada").message).toContain("Ada will have the daily and total limits");
  });
});
