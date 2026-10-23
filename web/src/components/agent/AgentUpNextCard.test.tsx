import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AgentUpNextCard from "./AgentUpNextCard";
import type { UpNextItem } from "../../lib/agentUpNext";

const item = (id: string, extra: Partial<UpNextItem> = {}): UpNextItem => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  artworkUrl: `https://cdn.test/${id}.jpg`,
  reason: `Reason ${id}`,
  sourceLabel: "Picked by the AI curator",
  queueIndex: 0,
  ...extra,
});

function baseProps(overrides: Partial<React.ComponentProps<typeof AgentUpNextCard>> = {}) {
  return {
    sessionLive: true,
    now: item("now", { reason: "Fits this session intent" }),
    upNext: [item("n1"), item("n2"), item("n3")],
    busy: null,
    onSkip: vi.fn(),
    onNotThis: vi.fn(),
    onMoreLikeThis: vi.fn(),
    ...overrides,
  };
}

type Node = React.ReactNode;
type ButtonProps = { "aria-label"?: string; onClick?: () => void; disabled?: boolean };
type Found = { label: string; onClick?: () => void; disabled?: boolean };

/** Expand the card's pure components and collect its buttons, so click handlers can be called. */
function buttons(node: Node, found: Found[] = []): Found[] {
  if (Array.isArray(node)) {
    node.forEach((child) => buttons(child, found));
    return found;
  }
  if (!React.isValidElement(node)) return found;
  const element = node as React.ReactElement<ButtonProps & { children?: Node }>;
  if (typeof element.type === "function") {
    return buttons((element.type as (props: unknown) => Node)(element.props), found);
  }
  if (element.type === "button") {
    found.push({ label: element.props["aria-label"] ?? "", onClick: element.props.onClick, disabled: element.props.disabled });
  }
  buttons(element.props.children, found);
  return found;
}

describe("AgentUpNextCard", () => {
  it("shows the playing track and the next picks with artwork, artist and one plain reason each", () => {
    const html = renderToStaticMarkup(<AgentUpNextCard {...baseProps()} />);
    expect(html).toContain("Now &amp; Up next");
    expect(html).toContain("Now playing");
    expect(html).toContain("Up next");
    for (const id of ["now", "n1", "n2", "n3"]) {
      expect(html).toContain(`Title ${id}`);
      expect(html).toContain(`Artist ${id}`);
      expect(html).toContain(`https://cdn.test/${id}.jpg`);
    }
    expect(html).toContain("Fits this session intent");
    expect(html).toContain("Reason n1");
    expect(html).toContain("Picked by the AI curator");
  });

  it("shows no score, runtime or developer strings", () => {
    const html = renderToStaticMarkup(<AgentUpNextCard {...baseProps()} />);
    expect(html).not.toMatch(/score/i);
    expect(html).not.toMatch(/runtime/i);
    expect(html).not.toContain("Next AI Pick");
    expect(html).not.toContain("BPM");
  });

  it("says a rule-based pick came from the filters and never claims an AI pick", () => {
    const rules = { sourceLabel: "Picked from your filters" };
    const html = renderToStaticMarkup(
      <AgentUpNextCard {...baseProps({ now: item("now", rules), upNext: [item("n1", rules)] })} />,
    );
    expect(html).toContain("Picked from your filters");
    expect(html).not.toContain("AI curator");
    expect(html).not.toContain("unavailable");
  });

  it("falls back to a placeholder when a pick has no artwork, and omits a missing reason", () => {
    const html = renderToStaticMarkup(
      <AgentUpNextCard {...baseProps({ now: null, upNext: [item("n1", { artworkUrl: null, reason: null })] })} />,
    );
    expect(html).toContain("aid-un-art--placeholder");
    expect(html).not.toContain("aid-un-reason");
  });

  it("idle: one line pointing to the prompt, no buttons", () => {
    const html = renderToStaticMarkup(
      <AgentUpNextCard {...baseProps({ sessionLive: false, now: null, upNext: [] })} />,
    );
    expect(html).toContain("Describe what you want to hear in the prompt above");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Session Live");
  });

  it("live with nothing queued yet says the DJ is choosing", () => {
    const html = renderToStaticMarkup(
      <AgentUpNextCard {...baseProps({ now: null, upNext: [] })} />,
    );
    expect(html).toContain("The DJ is choosing what to play");
    expect(html).toContain("Session Live");
    expect(html).not.toContain("<button");
  });

  it("labels each action with the track and artist for screen readers", () => {
    const found = buttons(AgentUpNextCard(baseProps()));
    const labels = found.map((button) => button.label);
    expect(labels).toEqual([
      "Skip Title now by Artist now",
      "Not this: Title now by Artist now",
      "More like this: Title now by Artist now",
      "Not this: Title n1 by Artist n1",
      "More like this: Title n1 by Artist n1",
      "Not this: Title n2 by Artist n2",
      "More like this: Title n2 by Artist n2",
      "Not this: Title n3 by Artist n3",
      "More like this: Title n3 by Artist n3",
    ]);
    const html = renderToStaticMarkup(<AgentUpNextCard {...baseProps()} />);
    expect(html).toContain('aria-label="Not this: Title n1 by Artist n1"');
    expect(html).toContain('type="button"');
  });

  it("calls the right handler with the right item", () => {
    const props = baseProps();
    const found = buttons(AgentUpNextCard(props));
    const press = (label: string) => found.find((button) => button.label === label)!.onClick!();
    press("Skip Title now by Artist now");
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    press("Not this: Title n2 by Artist n2");
    expect(props.onNotThis).toHaveBeenCalledWith(props.upNext[1]);
    press("More like this: Title now by Artist now");
    expect(props.onMoreLikeThis).toHaveBeenCalledWith(props.now);
  });

  it("offers Skip only when something is queued after the playing track", () => {
    const labels = buttons(AgentUpNextCard(baseProps({ upNext: [] }))).map((button) => button.label);
    expect(labels.some((label) => label.startsWith("Skip"))).toBe(false);
  });

  it("disables every action while one is in flight, and marks the busy one", () => {
    const props = baseProps({ busy: { action: "not_this", id: "n1" } });
    expect(buttons(AgentUpNextCard(props)).every((button) => button.disabled === true)).toBe(true);
    const html = renderToStaticMarkup(<AgentUpNextCard {...props} />);
    expect(html).toContain('aria-busy="true"');
  });

  it("shows a calm notice and My Mix availability as status text", () => {
    const html = renderToStaticMarkup(
      <AgentUpNextCard
        {...baseProps({
          notice: "The DJ needs a moment. Your queue keeps playing.",
          mixCoverage: { lanes: [{ id: "lane_0123456789abcdef0123456789abcdef", label: "Soul", requested: 3, matched: 1 }] },
        })}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("The DJ needs a moment. Your queue keeps playing.");
    expect(html).toContain("My Mix availability");
    expect(html).not.toContain("lane_0123456789abcdef0123456789abcdef");
  });
});
