/**
 * The public preview of an official stem (#1976) is a lossy transcode: one
 * transcode per stem at a time, a cache for repeats, and a bound on how many
 * run at once, so a public route cannot queue unbounded decode work.
 */
jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

import { ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "child_process";
import {
  MAX_CONCURRENT_TRANSCODES,
  clearStemPreviewCache,
  lossyPreviewFor,
} from "../modules/shared/stem-preview";

type ExecCallback = (error: Error | null, result: { stdout: Buffer; stderr: Buffer }) => void;

const execFileMock = execFile as unknown as jest.Mock;
let pendingCallbacks: ExecCallback[] = [];

function finishAll(output = Buffer.from("mp3")) {
  const callbacks = pendingCallbacks;
  pendingCallbacks = [];
  for (const callback of callbacks) callback(null, { stdout: output, stderr: Buffer.alloc(0) });
}

/** Waits until `count` ffmpeg runs have started (the temp file is written first). */
async function waitForExec(count = 1) {
  for (let i = 0; i < 200 && pendingCallbacks.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(pendingCallbacks).toHaveLength(count);
}

describe("lossyPreviewFor", () => {
  beforeEach(() => {
    clearStemPreviewCache();
    pendingCallbacks = [];
    execFileMock.mockReset();
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, callback: ExecCallback) => {
      pendingCallbacks.push(callback);
    });
  });

  const wav = () => Promise.resolve({ data: Buffer.from("RIFF"), mimeType: "audio/wav" });

  it("shares one transcode between concurrent requests for the same stem", async () => {
    const load = jest.fn(wav);
    const first = lossyPreviewFor("stem-a", load);
    const second = lossyPreviewFor("stem-a", load);
    await waitForExec();
    finishAll();
    await expect(first).resolves.toEqual({ data: Buffer.from("mp3"), mimeType: "audio/mpeg" });
    await expect(second).resolves.toEqual({ data: Buffer.from("mp3"), mimeType: "audio/mpeg" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("serves a repeat from the cache without loading the lossless file again", async () => {
    const load = jest.fn(wav);
    const first = lossyPreviewFor("stem-a", load);
    await waitForExec();
    finishAll();
    await first;
    await expect(lossyPreviewFor("stem-a", load)).resolves.toEqual({
      data: Buffer.from("mp3"),
      mimeType: "audio/mpeg",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses with 503, without loading anything, once the concurrency bound is reached", async () => {
    const running = Array.from({ length: MAX_CONCURRENT_TRANSCODES }, (_, index) =>
      lossyPreviewFor(`stem-${index}`, wav),
    );
    const load = jest.fn(wav);
    await expect(lossyPreviewFor("stem-extra", load)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(load).not.toHaveBeenCalled();
    await waitForExec(MAX_CONCURRENT_TRANSCODES);
    finishAll();
    await Promise.all(running);
    // Capacity is back once the running transcodes finish.
    const after = lossyPreviewFor("stem-extra", load);
    await waitForExec();
    finishAll();
    await expect(after).resolves.toEqual({ data: Buffer.from("mp3"), mimeType: "audio/mpeg" });
  });

  it("frees the slot when a load fails", async () => {
    const failing = jest.fn(() => Promise.reject(new Error("decrypt failed")));
    await expect(lossyPreviewFor("stem-a", failing)).rejects.toThrow("decrypt failed");
    const retry = lossyPreviewFor("stem-a", wav);
    await waitForExec();
    finishAll();
    await expect(retry).resolves.toEqual({ data: Buffer.from("mp3"), mimeType: "audio/mpeg" });
  });
});
