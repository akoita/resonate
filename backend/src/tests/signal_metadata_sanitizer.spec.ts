import { sanitizeSignalMetadataString } from "../modules/shared/signal_metadata_sanitizer";

describe("sanitizeSignalMetadataString", () => {
  it("rejects non-string and empty values", () => {
    expect(sanitizeSignalMetadataString(undefined, 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString({ value: "ambient" }, 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString("   \n\t ", 80)).toBeUndefined();
  });

  it("preserves valid values at the exact raw limit and rejects max plus one", () => {
    const exact = "a".repeat(80);

    expect(sanitizeSignalMetadataString(exact, 80)).toBe(exact);
    expect(sanitizeSignalMetadataString(`${exact}b`, 80)).toBeUndefined();
  });

  it("normalizes closed tags, controls, whitespace, and surrounding space", () => {
    expect(sanitizeSignalMetadataString("  Ambient <b>\u0000  Focus </b>  ", 80)).toBe("Ambient Focus");
    expect(sanitizeSignalMetadataString("2 < 3 and unclosed <tag", 80)).toBe("2 < 3 and unclosed <tag");
  });

  it("excludes URLs, emails, and private identifiers", () => {
    expect(sanitizeSignalMetadataString("https://example.test/track", 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString("listener@example.test", 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString("wallet 0x1234567890abcdef", 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString("user_private_123456", 80)).toBeUndefined();
    expect(sanitizeSignalMetadataString("session-private_123456", 80)).toBeUndefined();
  });

  it("handles repeated and unclosed tag-shaped input at the raw bound", () => {
    const unclosed = "<".repeat(80);
    const repeated = "<x>".repeat(26).slice(0, 80);

    expect(sanitizeSignalMetadataString(unclosed, 80)).toBe(unclosed);
    expect(sanitizeSignalMetadataString(repeated, 80)).toBeUndefined();
  });
});
