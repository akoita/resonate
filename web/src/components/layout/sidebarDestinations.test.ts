import { describe, expect, it } from "vitest";
import { sidebarDestinations } from "./Sidebar";
import { ALL_SURFACES_OFF, PRODUCT_SURFACE_NAMES } from "../../lib/productSurfaces";

const ALL_ON = Object.fromEntries(PRODUCT_SURFACE_NAMES.map((name) => [name, true]));

describe("sidebar destinations (#2663)", () => {
  it("offers a listener the everyday destinations, Community included while it is on", () => {
    const { primary, artist, account } = sidebarDestinations({ isArtist: false, surfaces: ALL_ON });
    const names = [...primary, ...artist, ...account].map((item) => item.name);
    expect(names).toEqual(["Home", "Player", "Library", "Shows", "Drops", "Catalog", "Crates & Stems", "Community", "Settings", "User Guide"]);
    expect(names).not.toContain("Wallet");
    expect(names).not.toContain("Disputes");
  });

  it("adds Sonic Radar after Library once it has discoveries, and only while its surface is on", () => {
    const withRadar = sidebarDestinations({ isArtist: false, surfaces: ALL_ON, hasDiscoveries: true });
    expect(withRadar.primary.map((item) => item.name)).toEqual(["Home", "Player", "Library", "Sonic Radar", "Shows", "Drops", "Catalog", "Crates & Stems", "Community"]);
    const switchedOff = sidebarDestinations({ isArtist: false, surfaces: { ...ALL_ON, sonicRadar: false }, hasDiscoveries: true });
    expect(switchedOff.primary.map((item) => item.name)).not.toContain("Sonic Radar");
  });

  it("adds the artist group for artists, with AI generation last", () => {
    const { artist } = sidebarDestinations({ isArtist: true, surfaces: ALL_ON });
    expect(artist.map((item) => item.name)).toEqual(["Upload", "My catalog", "Listings", "Analytics", "Disputes", "Create with AI"]);
  });

  it("hides entries whose surface is switched off", () => {
    const { primary, artist } = sidebarDestinations({ isArtist: true, surfaces: ALL_SURFACES_OFF });
    expect(primary.map((item) => item.name)).not.toContain("Community");
    expect(artist.map((item) => item.name)).toEqual(["Upload", "My catalog", "Listings", "Analytics"]);
  });
});
