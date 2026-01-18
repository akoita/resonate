import { Test } from "@nestjs/testing";
import { AppModule } from "../modules/app.module";

describe("Health", () => {
  it("bootstraps the application module", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef).toBeDefined();
  });
});
