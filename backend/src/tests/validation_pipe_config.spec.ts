import { BadRequestException } from "@nestjs/common";
import { IsInt, IsString, MaxLength } from "class-validator";
import { createGlobalValidationPipe } from "../config/validation";

class SampleDto {
  @IsString()
  @MaxLength(10)
  name!: string;

  @IsInt()
  count!: number;
}

const bodyMetadata = { type: "body" as const, metatype: SampleDto, data: "" };

describe("createGlobalValidationPipe (#1888)", () => {
  const pipe = createGlobalValidationPipe();

  it("returns the original request object for a valid DTO (no whitelist, no transform)", async () => {
    const body = { name: "ok", count: 3, extra: "kept" };
    const result = await pipe.transform(body, bodyMetadata);
    expect(result).toBe(body);
    expect(result).toEqual({ name: "ok", count: 3, extra: "kept" });
  });

  it("throws BadRequestException when a declared decorator is violated", async () => {
    await expect(
      pipe.transform({ name: "far-too-long-name", count: 1 }, bodyMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: "ok", count: "1" }, bodyMetadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("leaves bodies typed as plain objects untouched", async () => {
    const body = { anything: 1 };
    const result = await pipe.transform(body, { type: "body", metatype: Object, data: "" });
    expect(result).toBe(body);
  });
});
