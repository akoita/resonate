import { ForbiddenException } from "@nestjs/common";
import { IngestionService } from "../modules/ingestion/ingestion.service";

function makeService(artistProfile: { id: string } | null) {
  return new IngestionService(
    { publish: jest.fn(), subscribe: jest.fn() } as any,
    {} as any,
    {} as any,
    { getProfile: jest.fn().mockResolvedValue(artistProfile) } as any,
    {} as any,
    { add: jest.fn() } as any,
  );
}

describe("IngestionService upload ownership", () => {
  it("rejects uploads that target another artist profile", async () => {
    const service = makeService({ id: "artist-owned-by-user" });

    await expect(
      service.handleFileUpload({
        artistId: "artist-owned-by-someone-else",
        userId: "user-1",
        files: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
