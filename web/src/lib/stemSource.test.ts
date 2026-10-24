import { describe, expect, it } from "vitest";
import {
  LICENSE_PLAIN_TERMS,
  STEM_SOURCE_FILTERS,
  STEM_SOURCE_LABELS,
  isStemSource,
  resolveStemSource,
  stemSourceTitle,
} from "./stemSource";

describe("stem source (#1976)", () => {
  it("labels the two sources Official and Separated (AI)", () => {
    expect(STEM_SOURCE_LABELS).toEqual({ official: "Official", separated: "Separated (AI)" });
    expect(STEM_SOURCE_FILTERS.map((option) => option.value)).toEqual(["all", "official", "separated"]);
  });

  it("gives full-mix rows no source and counts an unsourced stem as separated", () => {
    expect(resolveStemSource({ type: "original", source: null })).toBeNull();
    expect(resolveStemSource({ type: "Master", source: "official" })).toBeNull();
    expect(resolveStemSource({ type: "vocals", source: "official" })).toBe("official");
    expect(resolveStemSource({ type: "vocals" })).toBe("separated");
    expect(resolveStemSource({ type: "vocals", source: "junk" })).toBe("separated");
    expect(resolveStemSource(null)).toBeNull();
    expect(isStemSource("official")).toBe(true);
    expect(isStemSource("x")).toBe(false);
  });

  it("explains the source, naming the model of a separated stem", () => {
    expect(stemSourceTitle("official")).toMatch(/Lossless audio uploaded by the artist/);
    expect(stemSourceTitle("separated", "demucs-htdemucs-6s")).toMatch(/Model: demucs-htdemucs-6s\.$/);
  });

  it("states what each license tier allows in plain words", () => {
    expect(Object.keys(LICENSE_PLAIN_TERMS)).toEqual(["personal", "remix", "commercial"]);
    expect(LICENSE_PLAIN_TERMS.remix).toMatch(/remix, mashup or new composition/);
  });
});
