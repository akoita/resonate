import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ current: "checking" as string }));
vi.mock("./useCampaignManageAccess", () => ({
  useCampaignManageAccess: () => access.current,
}));

import { CampaignDraftEditGate } from "./CampaignDraftEditGate";

const draft = {
  id: "my-show",
  backendId: "3f0c1a52-8f5e-4c1e-9d7a-2b6f1e0c9a41",
  rawStatus: "draft",
};

function render() {
  return renderToStaticMarkup(
    <CampaignDraftEditGate campaign={draft}>
      <form data-testid="draft-form" />
    </CampaignDraftEditGate>,
  );
}

afterEach(() => {
  access.current = "checking";
});

describe("CampaignDraftEditGate (#2130)", () => {
  it("shows the editor to a viewer allowed to manage the campaign", () => {
    access.current = "allowed";
    expect(render()).toContain('data-testid="draft-form"');
  });

  it("lets signed-out viewers reach the form's own connect prompt", () => {
    access.current = "signed-out";
    expect(render()).toContain('data-testid="draft-form"');
  });

  it("explains a denial instead of rendering a form that cannot save", () => {
    access.current = "denied";
    const html = render();

    expect(html).toContain("You can&#x27;t edit this draft");
    expect(html).toContain("Only the campaign&#x27;s artist or a Resonate operator can edit it.");
    expect(html).toMatch(/<a[^>]*href="\/shows\/my-show"[^>]*>Back to campaign<\/a>/);
    expect(html).not.toContain("draft-form");
  });

  it("shows a checking panel while access is resolved", () => {
    const html = render();

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Checking edit access…");
    expect(html).not.toContain("draft-form");
  });
});
