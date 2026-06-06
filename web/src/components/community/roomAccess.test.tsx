import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RoomAccessBadge,
  artistRoomAccessModel,
  campaignRoomAccessModel,
  roomAccessLockedReason,
  roomAccessModelLabel,
} from "./roomAccess";

describe("room access classifiers", () => {
  it("maps artist room types to access models", () => {
    expect(artistRoomAccessModel("artist_public")).toBe("open");
    expect(artistRoomAccessModel("artist_holder")).toBe("holder");
  });

  it("maps campaign room types to access models", () => {
    expect(campaignRoomAccessModel("show_campaign_supporter")).toBe("support");
    expect(campaignRoomAccessModel("show_city_demand")).toBe("open");
  });
});

describe("room access vocabulary", () => {
  it("exposes one label and one privacy-forward reason per model", () => {
    expect(roomAccessModelLabel("holder")).toBe("Holder");
    expect(roomAccessModelLabel("support")).toBe("Support");
    expect(roomAccessLockedReason("holder")).toContain("holdings stay private");
    expect(roomAccessLockedReason("support")).toContain("pledge and wallet stay private");
    expect(roomAccessLockedReason("consent")).toContain("Settings");
  });
});

describe("RoomAccessBadge", () => {
  it("renders the model label and a locked modifier", () => {
    const html = renderToStaticMarkup(<RoomAccessBadge model="holder" locked />);
    expect(html).toContain("room-access-badge--holder");
    expect(html).toContain("is-locked");
    expect(html).toContain(">Holder<");
  });

  it("omits the locked modifier when open", () => {
    const html = renderToStaticMarkup(<RoomAccessBadge model="open" />);
    expect(html).toContain("room-access-badge--open");
    expect(html).not.toContain("is-locked");
  });
});
