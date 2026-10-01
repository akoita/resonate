import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { EmbeddingsModule } from "../modules/embeddings/embeddings.module";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EventBus } from "../modules/shared/event_bus";

// Stand-in for the global SharedModule, which provides the process-wide bus.
const eventBus = new EventBus();
@Global()
@Module({
  providers: [{ provide: EventBus, useValue: eventBus }],
  exports: [EventBus],
})
class FakeSharedModule {}

describe("EmbeddingsModule wiring (#1452)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("resolves its providers, injects them into ToolRegistry and subscribes to ingest events once", async () => {
    const subscribe = jest.spyOn(eventBus, "subscribe");
    const moduleRef = await Test.createTestingModule({
      imports: [FakeSharedModule, EmbeddingsModule],
      providers: [ToolRegistry],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(EmbeddingService)).toBeInstanceOf(EmbeddingService);
    expect(moduleRef.get(EmbeddingStore)).toBeInstanceOf(EmbeddingStore);
    expect(moduleRef.get(TrackEmbeddingService)).toBeInstanceOf(TrackEmbeddingService);
    expect(moduleRef.get(ToolRegistry).get("embeddings.similarity")).toBeDefined();
    expect(subscribe.mock.calls.map(([name]) => name).sort()).toEqual([
      "catalog.release_ready",
      "catalog.updated",
    ]);

    await moduleRef.close();
  });
});
