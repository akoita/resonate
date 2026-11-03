import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { buildDjExtendedFfmpegArgs, type DjExtendedPlan } from "./remix-cues";

const execFileAsync = promisify(execFile);
const DJ_EXPORT_FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Runs the DJ extended splice (#2540) on a draft's audio bytes: writes the
 * draft to a private temp dir, runs ffmpeg with {@link buildDjExtendedFfmpegArgs}
 * and returns the MP3. The temp dir is always removed.
 */
export async function renderDjExtended(
  draft: Buffer,
  draftExtension: string,
  plan: DjExtendedPlan,
): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "remix-dj-"));
  try {
    const inputPath = join(workDir, `draft${draftExtension || ".mp3"}`);
    const outputPath = join(workDir, "dj-extended.mp3");
    await writeFile(inputPath, draft);
    await execFileAsync(
      "ffmpeg",
      buildDjExtendedFfmpegArgs(plan, inputPath, outputPath),
      { timeout: DJ_EXPORT_FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
