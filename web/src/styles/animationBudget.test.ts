/**
 * Idle-cost guardrail for CSS animations (#2436).
 *
 * An `infinite` animation runs for as long as its element is on the page —
 * for a music app left open for hours, that is "forever". If its keyframes
 * touch anything but transform/opacity, the browser repaints (and, under a
 * `backdrop-filter`, re-blurs) that area on every frame while the tab sits
 * idle. Those animations stay cheap only on the compositor.
 *
 * This test scans every stylesheet and `<style jsx>` block under `src/`, finds
 * infinite animations, and fails when one animates a paint/layout property
 * and is not on the allowlist below. The allowlist is the debt we accepted
 * when the rule was introduced; it may only shrink. Fix new ones instead of
 * adding them (see "Animation budget" in web/AGENTS.md).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const COMPOSITOR_SAFE = new Set(["transform", "opacity", "translate", "rotate", "scale", "offset", "offset-distance"]);

/**
 * Accepted at introduction. Loading skeletons only exist while something
 * loads; the rest are active-state or single-page loops that do not run on
 * idle Home/Player/Library/Shows (docs/engineering/idle-cost-harness.md,
 * "Remaining"). Remove a name as soon as it is fixed — the test fails on
 * stale entries.
 */
const ALLOWED_PAINT_ANIMATIONS = new Set<string>([
  // Loading skeletons / shimmers (transient: shown only while content loads).
  "aid-skeleton",
  "analytics-loading",
  "drops-shimmer",
  "pl-shimmer",
  "progress-shimmer",
  "review-queue-shimmer",
  "shimmer",
  // Active-state or one-off surfaces, not on the idle Home/player path.
  "agent-pulse",
  "ai-glow",
  "avatarPulse",
  "bg-shine",
  "commLivePulse",
  "donut-pulse",
  "immersive-bloom",
  "mixer-btn-active-glow",
  "mixer-btn-glow",
  "pulse-dot",
  "pulse-dot-green",
  "pulse-glow",
  "punchline-preview-pulse",
  "shows-eq-pulse",
  "sonic-pulse-ring",
  "sonic-radar-bg-shift",
]);

type Sheet = { file: string; css: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Stylesheets, plus .tsx files: `<style jsx>` blocks and inline styles are CSS text too. */
function sheets(): Sheet[] {
  return walk(SRC).map((file) => ({ file, css: fs.readFileSync(file, "utf8") }));
}

/** keyframe name → every property any of its definitions animates. */
function keyframeProperties(all: Sheet[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (const { css } of all) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(css))) {
      let depth = 1;
      let i = re.lastIndex;
      while (i < css.length && depth > 0) {
        if (css[i] === "{") depth += 1;
        else if (css[i] === "}") depth -= 1;
        i += 1;
      }
      const body = css.slice(re.lastIndex, i - 1);
      const props = result.get(match[1]) ?? new Set<string>();
      for (const decl of body.matchAll(/([a-z-]+)\s*:/g)) props.add(decl[1]);
      result.set(match[1], props);
    }
  }
  return result;
}

function infiniteAnimationNames(all: Sheet[], known: Set<string>): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  for (const { file, css } of all) {
    // `animation: name 2s ... infinite` in CSS, or `animation: "name 2s infinite"` inline.
    for (const decl of css.matchAll(/animation\s*:\s*["'`]?([^;"'`}]*\binfinite\b[^;"'`}]*)/g)) {
      for (const token of decl[1].split(/[\s,]+/)) {
        if (!known.has(token)) continue;
        const files = uses.get(token) ?? [];
        files.push(path.relative(SRC, file));
        uses.set(token, files);
      }
    }
  }
  return uses;
}

describe("animation budget (#2436)", () => {
  const all = sheets();
  const keyframes = keyframeProperties(all);
  const infinite = infiniteAnimationNames(all, new Set(keyframes.keys()));
  const paintAnimations = [...infinite.keys()].filter((name) =>
    [...(keyframes.get(name) ?? [])].some((prop) => !COMPOSITOR_SAFE.has(prop)),
  );

  it("finds the infinite animations it is meant to police", () => {
    // Sanity check so a parsing regression cannot make the budget pass vacuously.
    expect(infinite.has("ngHeroPing")).toBe(true);
    expect(infinite.has("marquee-scroll")).toBe(true);
  });

  it("only animates transform/opacity in new infinite animations", () => {
    const offenders = paintAnimations
      .filter((name) => !ALLOWED_PAINT_ANIMATIONS.has(name))
      .map((name) => `${name} [${[...(keyframes.get(name) ?? [])].join(", ")}] in ${infinite.get(name)?.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest (remove names once they are fixed)", () => {
    const stale = [...ALLOWED_PAINT_ANIMATIONS].filter((name) => !paintAnimations.includes(name));
    expect(stale).toEqual([]);
  });
});
