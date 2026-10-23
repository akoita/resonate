import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useHydrated } from "./useHydrated";

function Probe() {
  return <section id={useHydrated() ? "unique-id" : undefined} />;
}

describe("useHydrated", () => {
  it("is false in server-rendered HTML, so a streamed hidden copy carries no unique id", () => {
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain("<section");
    expect(html).not.toContain("unique-id");
  });
});
