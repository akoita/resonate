import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth: { token: string | null } = { token: null };
const connectPrivy = vi.fn();
const addCrateItem = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ token: auth.token, connectPrivy }),
}));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("../../lib/api", () => ({
  addCrateItem: (...args: unknown[]) => addCrateItem(...args),
  listCrates: vi.fn(),
}));

import { AddToCrateControl, addTrackToCrate } from "./AddToCrateControl";

const CRATE = { id: "crate 1", title: "Friday warm-up" };

function apiError(code: string | null, status: number, message = "Conflict") {
  return Object.assign(new Error(message), {
    status,
    details: code ? { code, message } : { message },
  });
}

beforeEach(() => {
  auth.token = null;
  connectPrivy.mockReset();
  addCrateItem.mockReset();
});

describe("addTrackToCrate (#2032)", () => {
  it("returns the toast copy and a link to the crate on success", async () => {
    addCrateItem.mockResolvedValue({ crate: { id: CRATE.id } });

    const result = await addTrackToCrate("tok", CRATE, "track-1", "Paper Lanterns");

    expect(addCrateItem).toHaveBeenCalledWith("tok", "crate 1", "track-1");
    expect(result).toEqual({
      ok: true,
      title: "Added to crate",
      message: '"Paper Lanterns" is now in Friday warm-up.',
      crateHref: "/crates/crate%201",
    });
  });

  it("falls back to generic copy for an untitled crate and unknown track", async () => {
    addCrateItem.mockResolvedValue({ crate: { id: "c2" } });

    const result = await addTrackToCrate("tok", { id: "c2", title: null }, "track-1");

    expect(result).toMatchObject({ ok: true, message: "That track is now in Untitled crate." });
  });

  it("says plainly when the track is already in that crate", async () => {
    addCrateItem.mockRejectedValue(apiError("line_exists", 409));

    expect(await addTrackToCrate("tok", CRATE, "track-1")).toEqual({
      ok: false,
      message: "Already in that crate.",
    });
  });

  it("explains a full crate and a track that is gone", async () => {
    addCrateItem.mockRejectedValueOnce(apiError("crate_full", 409));
    addCrateItem.mockRejectedValueOnce(apiError("track_not_found", 404));

    expect(await addTrackToCrate("tok", CRATE, "t")).toEqual({
      ok: false,
      message: "That crate is full. Remove a line to make room.",
    });
    expect(await addTrackToCrate("tok", CRATE, "t")).toEqual({
      ok: false,
      message: "That track is no longer available.",
    });
  });

  it("uses a fallback for an unreadable failure", async () => {
    addCrateItem.mockRejectedValue(new Error("boom"));

    expect(await addTrackToCrate("tok", CRATE, "t")).toEqual({
      ok: false,
      message: "We could not add that track. Please try again.",
    });
  });
});

describe("AddToCrateControl", () => {
  it("renders a plain Add to crate button when signed out", () => {
    const html = renderToStaticMarkup(<AddToCrateControl trackId="track-1" trackTitle="Paper Lanterns" />);

    expect(html).toContain("Add to crate");
    expect(html).toContain('aria-label="Add to crate: Paper Lanterns"');
    expect(html).not.toContain("aria-expanded");
  });

  it("renders a collapsed disclosure button when signed in", () => {
    auth.token = "tok";
    const html = renderToStaticMarkup(<AddToCrateControl trackId="track-1" />);

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("New crate from this track");
  });

  it("renders nothing without a track id", () => {
    expect(renderToStaticMarkup(<AddToCrateControl trackId="" />)).toBe("");
  });
});
