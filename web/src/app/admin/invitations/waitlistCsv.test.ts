import { describe, expect, it } from "vitest";
import { waitlistToCsv } from "./waitlistCsv";

describe("waitlistToCsv", () => {
  it("quotes cells and neutralizes formulas", () => {
    const csv = waitlistToCsv([
      {
        id: "w1",
        email: '=HYPERLINK("x")@example.com',
        kind: "artist",
        consentVersion: "waitlist-2026-11",
        consentedAt: "2026-11-25T10:00:00.000Z",
        createdAt: "2026-11-25T10:00:00.000Z",
        invitedAt: null,
        invitationId: null,
        joined: false,
      },
    ]);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toContain('"email"');
    expect(row.startsWith(`"'=HYPERLINK(""x"")@example.com"`)).toBe(true);
    expect(row).toContain('"artist"');
    expect(row.endsWith('"no"')).toBe(true);
  });
});
