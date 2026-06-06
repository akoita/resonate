import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomCard } from "./RoomCard";

describe("RoomCard", () => {
  it("renders eyebrow, title, access badge, meta, body, and actions", () => {
    const html = renderToStaticMarkup(
      <RoomCard
        accessModel="holder"
        accessLocked
        eyebrow="Holder room"
        title="Hiroyuki Sawano Holder Room"
        meta={<span>active</span>}
        actions={<button type="button">Join</button>}
      >
        <p>Private room for eligible holders.</p>
      </RoomCard>,
    );
    expect(html).toContain("room-card__eyebrow");
    expect(html).toContain("Holder room");
    expect(html).toContain("Hiroyuki Sawano Holder Room");
    expect(html).toContain("room-access-badge--holder");
    expect(html).toContain("is-locked");
    expect(html).toContain("Private room for eligible holders.");
    expect(html).toContain(">Join</button>");
  });

  it("renders a plain header by default and a button header when selectable", () => {
    const plain = renderToStaticMarkup(<RoomCard accessModel="open" title="Public" />);
    expect(plain).toContain('<div class="room-card__head">');
    expect(plain).not.toContain("room-card__head--select");

    const selectable = renderToStaticMarkup(
      <RoomCard accessModel="open" title="Public" selected onSelect={() => undefined} />,
    );
    expect(selectable).toContain("room-card__head--select");
    expect(selectable).toContain("room-card--selected");
    expect(selectable).toContain('aria-pressed="true"');
  });

  it("applies the surface modifier class", () => {
    const html = renderToStaticMarkup(
      <RoomCard accessModel="consent" title="Cohort" className="room-card--cohort" />,
    );
    expect(html).toContain("room-card--cohort");
  });
});
