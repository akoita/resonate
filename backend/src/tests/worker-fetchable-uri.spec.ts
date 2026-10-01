import { toWorkerFetchableUri } from "../modules/ingestion/worker-fetchable-uri";

describe("toWorkerFetchableUri", () => {
  const base = "http://backend:3000";

  it("maps local catalog stems to the shared-volume filename", () => {
    expect(
      toWorkerFetchableUri("/catalog/stems/stem_1/blob", "local", base),
    ).toBe("stem_1");
  });

  it("prefixes other root-relative paths with the backend URL", () => {
    expect(toWorkerFetchableUri("/catalog/stems/stem_1/blob", "gcs", base)).toBe(
      `${base}/catalog/stems/stem_1/blob`,
    );
    expect(toWorkerFetchableUri("/uploads/a.mp3", "local", base)).toBe(
      `${base}/uploads/a.mp3`,
    );
  });

  it("leaves http(s) URIs and non-root values untouched", () => {
    expect(
      toWorkerFetchableUri("https://storage.googleapis.com/b/o.mp3", "gcs", base),
    ).toBe("https://storage.googleapis.com/b/o.mp3");
    expect(toWorkerFetchableUri("http://x/y", null, base)).toBe("http://x/y");
    expect(toWorkerFetchableUri("stem_1.mp3", "local", base)).toBe("stem_1.mp3");
  });

  it("falls back to the backend URL when the filename segment is empty", () => {
    expect(toWorkerFetchableUri("/catalog/stems//", "local", base)).toBe(
      `${base}/catalog/stems//`,
    );
  });
});
