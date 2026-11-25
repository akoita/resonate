import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UploadAllowance } from "../../lib/api";
import UploadLimitsNotice, { describeUploadAllowance } from "./UploadLimitsNotice";

const allowance = (over: Partial<UploadAllowance> = {}): UploadAllowance => ({
  artistId: "artist-1",
  limited: true,
  liftedAt: null,
  limits: { releasesPerDay: 5, tracksPerDay: 50, releasesTotal: 50, tracksTotal: 500 },
  used: { releasesPerDay: 1, tracksPerDay: 48, releasesTotal: 3, tracksTotal: 60 },
  remaining: { releasesPerDay: 4, tracksPerDay: 2, releasesTotal: 47, tracksTotal: 440 },
  ...over,
});

describe("UploadLimitsNotice (#2659)", () => {
  it("shows nothing for an account without limits", () => {
    expect(describeUploadAllowance(allowance({ limited: false }), 3)).toBeNull();
    expect(describeUploadAllowance(null, 3)).toBeNull();
    expect(renderToStaticMarkup(<UploadLimitsNotice allowance={allowance({ limited: false })} trackCount={3} />)).toBe("");
  });

  it("lists what is left without blocking an upload that fits", () => {
    const html = renderToStaticMarkup(<UploadLimitsNotice allowance={allowance()} trackCount={2} />);
    expect(html).toContain("<strong>2</strong> of 50 tracks today left");
    expect(html).not.toContain('role="alert"');
    expect(describeUploadAllowance(allowance(), 2)?.blocking).toBeNull();
  });

  it("blocks an upload one track past the daily limit", () => {
    const described = describeUploadAllowance(allowance(), 3);
    expect(described?.blocking?.key).toBe("tracksPerDay");
    const html = renderToStaticMarkup(<UploadLimitsNotice allowance={allowance()} trackCount={3} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again tomorrow");
  });

  it("leaves out a limit that is turned off", () => {
    const html = renderToStaticMarkup(
      <UploadLimitsNotice
        allowance={allowance({
          limits: { releasesPerDay: null, tracksPerDay: 50, releasesTotal: 50, tracksTotal: 500 },
        })}
        trackCount={1}
      />,
    );
    expect(html).not.toContain("releases today");
  });
});
