import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeferredMount } from "./DeferredMount";

describe("DeferredMount", () => {
  it("renders the placeholder, not the widget, on the server and on first paint", () => {
    const html = renderToStaticMarkup(
      <section>
        <DeferredMount fallback={<div className="placeholder" />}>
          <div className="widget" />
        </DeferredMount>
      </section>,
    );
    expect(html).toContain('class="placeholder"');
    expect(html).not.toContain('class="widget"');
  });

  it("keeps the placeholder a direct child of its parent, behind a zero-height sentinel", () => {
    const html = renderToStaticMarkup(
      <section>
        <DeferredMount fallback={<div className="placeholder" />}>
          <div className="widget" />
        </DeferredMount>
      </section>,
    );
    expect(html).toBe(
      '<section><span data-deferred-mount="" aria-hidden="true" style="display:block;height:0"></span><div class="placeholder"></div></section>',
    );
  });
});
