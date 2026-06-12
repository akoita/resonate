import { resolve, sep } from "path";
import { resolveContainedPath } from "../modules/storage/path_containment";

const BASE = resolve("/srv/app/uploads/stems");

describe("resolveContainedPath (#1189 review sweep)", () => {
  it("resolves plain filenames and nested relative paths inside the base", () => {
    expect(resolveContainedPath(BASE, "vocals.mp3")).toBe(
      `${BASE}${sep}vocals.mp3`,
    );
    expect(resolveContainedPath(BASE, "rel_1/trk_2/drums.mp3")).toBe(
      resolve(BASE, "rel_1/trk_2/drums.mp3"),
    );
  });

  it("rejects traversal-shaped paths", () => {
    expect(resolveContainedPath(BASE, "../secrets.env")).toBeNull();
    expect(resolveContainedPath(BASE, "../../../../etc/passwd")).toBeNull();
    expect(resolveContainedPath(BASE, "rel_1/../../escape.mp3")).toBeNull();
  });

  it("rejects absolute paths outside the base", () => {
    expect(resolveContainedPath(BASE, "/etc/passwd")).toBeNull();
  });

  it("rejects the bare parent and base itself (a directory is never a stem)", () => {
    expect(resolveContainedPath(BASE, "..")).toBeNull();
    expect(resolveContainedPath(BASE, ".")).toBeNull();
    expect(resolveContainedPath(BASE, "")).toBeNull();
  });

  it("allows dot segments that still resolve inside the base", () => {
    expect(resolveContainedPath(BASE, "rel_1/../vocals.mp3")).toBe(
      `${BASE}${sep}vocals.mp3`,
    );
  });
});
