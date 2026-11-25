import { capRangeHeader, parseByteRange } from "../modules/storage/byte_range";

describe("byte ranges for audio delivery (#2661)", () => {
  it("parses the single-range forms media elements send", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=990-5000", 1000)).toEqual({ start: 990, end: 999 });
  });

  it("rejects unsatisfiable and malformed ranges", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBeNull();
    expect(parseByteRange("bytes=5-1", 1000)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseByteRange("items=0-1", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
  });

  it("caps a forwarded range to one chunk", () => {
    expect(capRangeHeader(undefined, 100)).toBe("bytes=0-99");
    expect(capRangeHeader("bytes=500-", 100)).toBe("bytes=500-599");
    expect(capRangeHeader("bytes=500-520", 100)).toBe("bytes=500-520");
    expect(capRangeHeader("bytes=-5000", 100)).toBe("bytes=-100");
    expect(capRangeHeader("bytes=9-1", 100)).toBeNull();
    expect(capRangeHeader("nonsense", 100)).toBeNull();
  });
});
