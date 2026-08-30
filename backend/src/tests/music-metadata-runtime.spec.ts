import { execFileSync } from "child_process";
import { join } from "path";

describe("music-metadata runtime compatibility", () => {
  it("loads the parser APIs through the supported CommonJS runtime", () => {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "const metadata = require('music-metadata'); process.stdout.write(`${typeof metadata.parseFile} ${typeof metadata.parseBuffer}`);",
      ],
      {
        cwd: join(__dirname, "../.."),
        encoding: "utf8",
      },
    );

    expect(output).toBe("function function");
  });
});
