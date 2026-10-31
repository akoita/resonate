/**
 * Timer guardrail (#2436): repeating timers in app code go through
 * `registerVisibleInterval` so they pause, or back off, in a hidden tab.
 *
 * The files below are the bare `setInterval` calls accepted when the rule was
 * introduced. They only run during an explicit, user-started task (an upload,
 * a generation, an agent session) or must keep running in the background
 * (stem sync while audio plays, the update and invitation checks that guard
 * visibility themselves). The list may only shrink: the test fails on a new
 * bare `setInterval` and on a stale entry.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

const ALLOWED_BARE_INTERVALS = new Set<string>([
  "app/artist/catalog/catalogRealtime.ts", // injectable timers; caller guards visibility
  "app/artist/upload/page.tsx", // upload progress while an upload runs
  "components/agent/AgentSessionPanel.tsx", // live agent session
  "components/agent/AgentSessionPrompt.tsx", // live agent session
  "components/player/PlaybackIntentBridge.tsx", // device heartbeat: backend drops a device unseen for 45 s
  "components/remix/RemixStudioEditor.tsx", // active remix render
  "hooks/useComplementaryGeneration.ts", // generation job the user started
  "hooks/useGeneration.ts", // generation job the user started
  "hooks/useManagementInvitations.ts", // skips hidden ticks itself
  "hooks/useUpdateAvailable.ts", // skips hidden ticks itself
  "lib/playerContext.tsx", // stem sync must follow audio in a background tab
  "lib/visibleInterval.ts", // the helper itself
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("visible-interval budget (#2436)", () => {
  const offenders = walk(SRC)
    .filter((file) => /\bsetInterval\s*\(/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

  it("uses registerVisibleInterval for new repeating timers", () => {
    expect(offenders.filter((file) => !ALLOWED_BARE_INTERVALS.has(file))).toEqual([]);
  });

  it("keeps the allowlist honest (remove files once they are converted)", () => {
    expect([...ALLOWED_BARE_INTERVALS].filter((file) => !offenders.includes(file))).toEqual([]);
  });
});
