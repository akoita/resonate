/**
 * SearchController — HTTP contract (#2671): public, one call, the query passed
 * through. The service is mocked (see search.integration.spec.ts).
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { SearchController } from "../modules/search/search.controller";
import { SearchService } from "../modules/search/search.service";
import { createControllerTestApp } from "./e2e-helpers";

const empty = { query: "", artists: [], releases: [], tracks: [], playlists: [] };
const mockSearch = { search: jest.fn() };

describe("SearchController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(SearchController, [{ provide: SearchService, useValue: mockSearch }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.search.mockResolvedValue({ ...empty, query: "night" });
  });

  it("answers a signed-out visitor", async () => {
    const res = await request(app.getHttpServer()).get("/search").query({ q: "night" }).expect(200);
    expect(res.body).toEqual({ ...empty, query: "night" });
    expect(mockSearch.search).toHaveBeenCalledWith("night");
  });

  it("passes a missing query through for the service to answer empty", async () => {
    mockSearch.search.mockResolvedValue(empty);
    await request(app.getHttpServer()).get("/search").expect(200);
    expect(mockSearch.search).toHaveBeenCalledWith(undefined);
  });
});
