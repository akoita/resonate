import { Readable } from "stream";
import { BoundedMemoryStorage } from "../modules/shared/bounded-memory.storage";

function handle(
  storage: BoundedMemoryStorage,
  request: object,
  fieldname: string,
  chunks: Buffer[],
) {
  return new Promise<{ error?: Error; info?: { buffer: Buffer; size: number } }>((resolve) => {
    storage._handleFile(
      request,
      { fieldname, stream: Readable.from(chunks) },
      (error, info) => resolve({ error: error ?? undefined, info }),
    );
  });
}

describe("BoundedMemoryStorage", () => {
  it("caps a named field while streaming without affecting other fields", async () => {
    const storage = new BoundedMemoryStorage({
      fieldMaxBytes: { artwork: 4 },
      label: "Ingestion",
    });
    const request = {};

    const audio = await handle(storage, request, "files", [Buffer.alloc(8)]);
    expect(audio.error).toBeUndefined();
    expect(audio.info?.size).toBe(8);

    const artwork = await handle(storage, request, "artwork", [Buffer.alloc(5)]);
    expect(artwork.info).toBeUndefined();
    expect(artwork.error?.message).toContain("Ingestion field artwork must be 0 MiB or smaller");
    expect((artwork.error as any).getStatus()).toBe(413);
  });

  it("caps aggregate bytes across files, including streamed requests without Content-Length", async () => {
    const storage = new BoundedMemoryStorage({ maxTotalBytes: 5, label: "Campaign visual" });
    const request = {};

    const first = await handle(storage, request, "hero", [Buffer.alloc(3)]);
    expect(first.error).toBeUndefined();
    const second = await handle(storage, request, "gallery", [Buffer.alloc(3)]);
    expect(second.info).toBeUndefined();
    expect(second.error?.message).toContain("Campaign visual request must be 0 MiB or smaller");
    expect((second.error as any).getStatus()).toBe(413);
  });

  it("coalesces highly fragmented streams without changing the resulting buffer", async () => {
    const storage = new BoundedMemoryStorage({ maxTotalBytes: 128 });
    const result = await handle(storage, {}, "gallery", Array.from({ length: 100 }, () => Buffer.from("x")));

    expect(result.error).toBeUndefined();
    expect(result.info?.size).toBe(100);
    expect(result.info?.buffer.equals(Buffer.alloc(100, "x"))).toBe(true);
  });
});
