import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError, type RemixPartTake } from "../../lib/api";
import type { RemixPart } from "../../lib/remixParts";
import {
  apiErrorCode,
  describePartsGenerate,
  formatCents,
  PART_PICKUP_REASON,
  partBarsReason,
  partLaneName,
  partsGenerateErrorMessage,
  partsMoneyLine,
  partsQuoteCents,
  partTakeBatches,
  partTakeNumber,
  partTakesActive,
  partUseTarget,
  PARTS_BATCH_ACTIVE_REASON,
  PARTS_CHECKING_CREDITS_REASON,
  PARTS_DISABLED_REASON,
  PARTS_FULL_REASON,
  PARTS_LOCKED_REASON,
  PARTS_NEED_TEMPO_NOTE,
  PARTS_UNSUPPORTED_REASON,
  RemixPartsView,
  takeDeleteAvailability,
  takeFailureDetail,
  takeStatusLabel,
  takeUseAction,
  trayStatusText,
  type RemixPartsModel,
} from "./RemixPartsSection";

type HostElement = ReactElement<Record<string, unknown>>;

/** Host elements of a hook-free tree, expanding function components. */
function hostElements(node: ReactNode): HostElement[] {
  if (Array.isArray(node)) return node.flatMap(hostElements);
  if (!isValidElement(node)) return [];
  const element = node as HostElement;
  if (typeof element.type === "function") {
    return hostElements((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return [element, ...hostElements(element.props.children as ReactNode)];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node as HostElement).props.children as ReactNode);
}

let takeSeq = 0;
function take(overrides: Partial<RemixPartTake> = {}): RemixPartTake {
  takeSeq += 1;
  return {
    id: `take-${takeSeq}`,
    batchId: "batch-1",
    role: "bass",
    bars: 4,
    style: null,
    seed: takeSeq,
    status: "completed",
    promptVersion: "remix-part-prompt/v1",
    provider: "stub",
    model: "stub",
    grounding: "feature_conditioned",
    aiGenerated: true,
    costCents: 10,
    mimeType: "audio/flac",
    durationSec: 8,
    conform: null,
    errorCode: null,
    createdAt: `2026-09-27T12:00:0${takeSeq % 10}.000Z`,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function model(overrides: Partial<RemixPartsModel> = {}): RemixPartsModel {
  return {
    role: "bass",
    bars: 4,
    style: "",
    onRoleChange: vi.fn(),
    onBarsChange: vi.fn(),
    onStyleChange: vi.fn(),
    bpm: 120,
    credits: { balanceCents: 70, priceCentsPer30s: 10 },
    creditRequest: "idle",
    onRequestCredits: vi.fn(),
    unavailableReason: null,
    generating: false,
    error: null,
    onGenerate: vi.fn(),
    takes: [],
    parts: [],
    inUseTakeIds: new Set(),
    targetPartId: null,
    onClearTarget: vi.fn(),
    auditionTakeId: null,
    auditionLoadingTakeId: null,
    onAudition: vi.fn(),
    onUseTake: vi.fn(),
    onDeleteTake: vi.fn(),
    takePeaks: () => null,
    ...overrides,
  };
}

function view(overrides: Partial<RemixPartsModel> = {}, locked = false) {
  const m = model(overrides);
  const elements = hostElements(RemixPartsView({ idPrefix: "t", model: m, locked }));
  const html = renderToStaticMarkup(<RemixPartsView idPrefix="t" model={m} locked={locked} />);
  const buttons = (label: string) =>
    elements.filter(
      (element) =>
        element.type === "button" &&
        (element.props["aria-label"] === label ||
          textOf(element.props.children as ReactNode) === label),
    );
  return { model: m, elements, html, buttons };
}

describe("Add a part — form (#1901)", () => {
  it("offers the six instruments as a radio group with the chosen one checked", () => {
    const { html, elements, model: m } = view({ role: "keys" });
    expect(html).toContain("Add a part");
    expect(html).toMatch(/remix-parts-ai-badge[^>]*>AI</);
    expect(html).toMatch(/role="radiogroup" aria-labelledby="t-parts-role"/);
    const radios = elements.filter(
      (element) => element.type === "input" && element.props.name === "t-parts-role",
    );
    expect(radios.map((radio) => radio.props.value)).toEqual([
      "drums",
      "bass",
      "keys",
      "pad",
      "strings",
      "guitar",
    ]);
    expect(radios.filter((radio) => radio.props.checked).map((radio) => radio.props.value)).toEqual([
      "keys",
    ]);
    for (const label of ["Drums", "Bass", "Keys", "Pad", "Strings", "Guitar"]) {
      expect(html).toContain(`${label}</label>`);
    }
    (radios[5].props.onChange as () => void)();
    expect(m.onRoleChange).toHaveBeenCalledWith("guitar");
  });

  it("offers 4 or 8 bars, and says why 8 bars don't fit a slow song", () => {
    const fast = view({ bpm: 120 });
    const fastBars = fast.elements.filter(
      (element) => element.type === "input" && element.props.name === "t-parts-bars",
    );
    expect(fastBars.map((radio) => [radio.props.value, radio.props.disabled])).toEqual([
      [4, false],
      [8, false],
    ]);
    expect(fast.html).not.toContain("remix-parts-bars-reason");
    (fastBars[1].props.onChange as () => void)();
    expect(fast.model.onBarsChange).toHaveBeenCalledWith(8);

    // 8 bars at 60 BPM last 32 s: longer than one 30 s take.
    const slow = view({ bpm: 60 });
    const slowBars = slow.elements.filter(
      (element) => element.type === "input" && element.props.name === "t-parts-bars",
    );
    expect(slowBars[1].props.disabled).toBe(true);
    expect(slow.html).toContain(
      "At this song&#x27;s tempo, 8 bars last longer than one AI take (30 seconds). Pick fewer bars.",
    );
    expect(slow.html).toMatch(/aria-describedby="t-parts-bars-reason"/);
    expect(partBarsReason(60, 4)).toBeNull();
    expect(partBarsReason(120, 8)).toBeNull();
    expect(partBarsReason(null, 8)).toBeNull();
  });

  it("takes optional style words, capped at 80 characters with a counter", () => {
    const { html, elements, model: m } = view({ style: "warm, funky" });
    expect(html).toContain('placeholder="e.g. warm, funky, 80s"');
    expect(html).toContain('maxLength="80"');
    expect(html).toMatch(/remix-parts-style-count[^>]*>11(<!-- -->)?\/(<!-- -->)?80</);
    const input = elements.find((element) => element.type === "input" && element.props.id === "t-parts-style");
    (input?.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "x".repeat(90) },
    });
    expect(m.onStyleChange).toHaveBeenCalledWith("x".repeat(80));
  });

  it("shows the price before spending: takes × the per-30 s price and the balance", () => {
    expect(view().html).toContain("3 takes · 30¢ · you have 70¢");
    expect(view({ credits: { balanceCents: 500, priceCentsPer30s: 12 } }).html).toContain(
      "3 takes · 36¢ · you have $5.00",
    );
    expect(partsQuoteCents(10)).toBe(30);
    expect(partsQuoteCents(10, 4)).toBe(40);
    expect(partsMoneyLine({ priceCentsPer30s: 50, balanceCents: null })).toBe("3 takes · $1.50");
    expect(formatCents(99)).toBe("99¢");
    expect(formatCents(100)).toBe("$1.00");
    // No balance yet: no invented price either.
    expect(view({ credits: null }).html).not.toContain("remix-parts-money");
  });

  it("generates when everything is in place", () => {
    const { html, buttons, model: m } = view();
    const [generate] = buttons("Generate 3 takes");
    expect(generate.props["aria-disabled"]).toBeUndefined();
    (generate.props.onClick as (event: { preventDefault(): void }) => void)({
      preventDefault: vi.fn(),
    });
    expect(m.onGenerate).toHaveBeenCalledTimes(1);
    expect(html).not.toContain("remix-parts-reason");
  });

  it("never runs a disabled generate, and always says why", () => {
    const cases: Array<[Partial<RemixPartsModel>, boolean, string]> = [
      [{}, true, PARTS_LOCKED_REASON],
      [{ unavailableReason: PARTS_UNSUPPORTED_REASON }, false, PARTS_UNSUPPORTED_REASON],
      [{ bpm: 60, bars: 8 }, false, "8 bars last longer than one AI take"],
      [{ takes: [take({ status: "processing" })] }, false, PARTS_BATCH_ACTIVE_REASON],
      [{ credits: null }, false, PARTS_CHECKING_CREDITS_REASON],
      [
        { credits: { balanceCents: 20, priceCentsPer30s: 10 } },
        false,
        "You need 30¢ of credits for 3 takes, and you have 20¢.",
      ],
    ];
    for (const [overrides, locked, reason] of cases) {
      const { html, buttons, model: m } = view(overrides, locked);
      const [generate] = buttons("Generate 3 takes");
      expect(generate.props["aria-disabled"]).toBe(true);
      const preventDefault = vi.fn();
      (generate.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault });
      expect(m.onGenerate).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalled();
      expect(html.replaceAll("&#x27;", "'")).toContain(reason);
      expect(generate.props["aria-describedby"]).toContain("t-parts-reason");
    }
  });

  it("offers the credit request when the balance is short", () => {
    const short = view({ credits: { balanceCents: 0, priceCentsPer30s: 10 } });
    const [request] = short.buttons("Request credits");
    (request.props.onClick as () => void)();
    expect(short.model.onRequestCredits).toHaveBeenCalledTimes(1);
    expect(
      view({ credits: { balanceCents: 0, priceCentsPer30s: 10 }, creditRequest: "sent" }).html,
    ).toContain("Request sent, credits are on their way.");
    expect(view().buttons("Request credits")).toHaveLength(0);
  });

  it("is busy while the request runs, with no reason to show", () => {
    const busy = view({ generating: true });
    const [starting] = busy.buttons("Starting…");
    expect(starting.props["aria-busy"]).toBe(true);
    expect(busy.html).not.toContain("remix-parts-reason");
    expect(
      describePartsGenerate({
        locked: false,
        unavailableReason: null,
        bpm: 120,
        bars: 4,
        generating: true,
        batchActive: false,
        credits: { balanceCents: 100, priceCentsPer30s: 10 },
      }),
    ).toEqual({ enabled: false, reason: null, needsCredits: false });
  });

  it("explains a song without a tempo instead of offering a dead button", () => {
    const { html, buttons } = view({ bpm: null });
    expect(html.replaceAll("&#x27;", "'")).toContain(PARTS_NEED_TEMPO_NOTE);
    expect(buttons("Generate 3 takes")).toHaveLength(0);
    expect(html).not.toContain('role="radiogroup"');
  });

  it("shows the last error as an alert", () => {
    expect(view({ error: "Those style words can't be used." }).html).toMatch(
      /role="alert"[^>]*>Those style words can&#x27;t be used\.</,
    );
  });
});

describe("Add a part — API errors in plain words (#1901)", () => {
  const apiError = (status: number, code?: string) =>
    new ApiRequestError(`API ${status}: x`, status, code ? { code, message: "x" } : undefined);

  it("maps every refusal code", () => {
    expect(partsGenerateErrorMessage(apiError(400, "parts_unsupported"))).toEqual({
      message: PARTS_UNSUPPORTED_REASON,
      sticky: true,
    });
    expect(partsGenerateErrorMessage(apiError(503, "provider_disabled"))).toEqual({
      message: PARTS_DISABLED_REASON,
      sticky: true,
    });
    expect(partsGenerateErrorMessage(apiError(400, "part_too_long")).message).toContain(
      "Pick fewer bars",
    );
    expect(partsGenerateErrorMessage(apiError(409, "no_tempo_grid")).message).toBe(
      PARTS_NEED_TEMPO_NOTE,
    );
    expect(partsGenerateErrorMessage(apiError(409, "take_limit_reached")).message).toContain(
      "Delete takes you don't use",
    );
    expect(partsGenerateErrorMessage(apiError(422, "prompt_rejected")).message).toBe(
      "Those style words can't be used. Try different ones.",
    );
    expect(partsGenerateErrorMessage(apiError(409, "project_published")).message).toBe(
      PARTS_LOCKED_REASON,
    );
  });

  it("maps the statuses without a code", () => {
    expect(partsGenerateErrorMessage(apiError(402)).message).toContain("Request credits");
    expect(partsGenerateErrorMessage(apiError(429)).message).toContain("too quickly");
    expect(partsGenerateErrorMessage(apiError(503)).message).toContain("busy right now");
    expect(partsGenerateErrorMessage(apiError(403)).message).toContain("aren't allowed");
    expect(partsGenerateErrorMessage(new Error("network"))).toEqual({
      message: "Couldn't start the takes. Please try again.",
      sticky: false,
    });
    for (const status of [402, 429, 503]) {
      expect(partsGenerateErrorMessage(apiError(status)).sticky).toBe(false);
    }
    expect(apiErrorCode(new Error("API 402: Not enough"))).toEqual({ status: 402, code: null });
  });
});

describe("Add a part — takes tray (#1901)", () => {
  it("groups the instrument's takes by batch, newest first, numbered in order", () => {
    const old = [
      take({ id: "o1", batchId: "old", createdAt: "2026-09-27T10:00:00.000Z" }),
      take({ id: "o2", batchId: "old", createdAt: "2026-09-27T10:00:01.000Z" }),
    ];
    const fresh = [
      take({ id: "n2", batchId: "new", createdAt: "2026-09-27T11:00:01.000Z", style: "warm" }),
      take({ id: "n1", batchId: "new", createdAt: "2026-09-27T11:00:00.000Z", style: "warm" }),
    ];
    const other = take({ id: "d1", batchId: "drums", role: "drums" });
    const batches = partTakeBatches([...fresh, other, ...old], "bass");
    expect(batches.map((batch) => batch.batchId)).toEqual(["new", "old"]);
    expect(batches[0].takes.map((entry) => [entry.take.id, entry.number])).toEqual([
      ["n1", 1],
      ["n2", 2],
    ]);
    expect(partTakeNumber([...fresh, ...old], "n2")).toBe(2);
    expect(partTakeNumber([...fresh, ...old], "missing")).toBeNull();
    const { html } = view({ takes: [...fresh, other, ...old] });
    expect(html).toContain("Bass takes");
    expect(html).toContain("4 bars · “warm”");
    expect(html).not.toContain('data-take-id="d1"');
    expect(html.indexOf('data-take-id="n1"')).toBeLessThan(html.indexOf('data-take-id="o1"'));
  });

  it("shows generating, ready and failed takes honestly", () => {
    const takes = [
      take({ id: "g", status: "pending", createdAt: "2026-09-27T12:00:00.000Z" }),
      take({ id: "r", status: "completed", createdAt: "2026-09-27T12:00:01.000Z" }),
      take({
        id: "f",
        status: "failed",
        errorCode: "conform_failed",
        createdAt: "2026-09-27T12:00:02.000Z",
      }),
    ];
    const { html } = view({ takes, takePeaks: (id) => (id === "r" ? [0.2, 0.8, 0.4] : null) });
    expect(html).toMatch(/remix-parts-take-generating[\s\S]*Generating…[\s\S]*remix-parts-take-progress/);
    expect(html).toMatch(/remix-parts-take-ready[\s\S]*>Ready</);
    expect(html).toContain("Didn&#x27;t work, credit refunded");
    expect(html).toContain("The take couldn&#x27;t be locked to the song&#x27;s tempo.");
    // A ready take draws its waveform; no generating/failed take has actions.
    expect(html).toContain("fill-sky-200/70");
    expect(html.match(/remix-parts-take-audition/g)).toHaveLength(1);
    expect(html).toContain("Generating 1 of 3 takes…");
    expect(takeStatusLabel({ status: "failed", errorCode: "insufficient_credits" })).toBe(
      "Didn't work, not charged",
    );
    expect(takeStatusLabel({ status: "processing", errorCode: null })).toBe("Generating…");
    expect(takeFailureDetail("provider_rejected")).toContain("turned this request down");
    expect(takeFailureDetail("internal_error")).toBe("Something went wrong on our side.");
    expect(takeFailureDetail(null)).toBe("Something went wrong on our side.");
    expect(partTakesActive(takes)).toBe(true);
    expect(partTakesActive([takes[1], takes[2]])).toBe(false);
    expect(partTakesActive(undefined)).toBe(false);
  });

  it("summarizes the newest batch for screen readers", () => {
    const ready = [take({ batchId: "b" }), take({ batchId: "b" }), take({ batchId: "b" })];
    expect(trayStatusText(partTakeBatches(ready, "bass"))).toBe("3 takes ready.");
    expect(trayStatusText([])).toBe("");
    expect(view({ takes: ready }).html).toMatch(/aria-live="polite"[^>]*>3 takes ready\.</);
  });

  it("is empty with a plain hint before any take", () => {
    expect(view().html).toContain("No bass takes yet. Generate 3 takes to hear some options.");
  });

  it("toggles an audition from the take, pressed while it plays", () => {
    const ready = take({ id: "a1" });
    const idle = view({ takes: [ready] });
    const [audition] = idle.buttons("Audition");
    expect(audition.props["aria-pressed"]).toBe(false);
    (audition.props.onClick as () => void)();
    expect(idle.model.onAudition).toHaveBeenCalledWith(ready);

    const playing = view({ takes: [ready], auditionTakeId: "a1" });
    const [stop] = playing.buttons("Stop audition");
    expect(stop.props["aria-pressed"]).toBe(true);
    (stop.props.onClick as () => void)();
    expect(playing.model.onAudition).toHaveBeenCalledWith(ready);

    const loading = view({ takes: [ready], auditionLoadingTakeId: "a1" });
    expect(loading.buttons("Loading…")[0].props["aria-busy"]).toBe(true);
  });
});

describe("Add a part — use a take (#1901)", () => {
  const bassPart: RemixPart = { id: "bass-1", role: "bass", takeId: "t-old" };

  it("adds a lane for a new instrument", () => {
    const ready = take({ id: "t-new" });
    expect(partUseTarget(ready, [], null)).toEqual({ kind: "add" });
    const { buttons, model: m, html } = view({ takes: [ready] });
    const [use] = buttons("Use this take");
    expect(use.props["aria-disabled"]).toBeUndefined();
    (use.props.onClick as () => void)();
    expect(m.onUseTake).toHaveBeenCalledWith(ready);
    expect(html).not.toContain("remix-parts-take-note");
  });

  it("replaces the take of the lane that asked, or of the instrument's lane", () => {
    const ready = take({ id: "t-new" });
    const second: RemixPart = { id: "bass-2", role: "bass", takeId: "t-other" };
    expect(partUseTarget(ready, [bassPart, second], "bass-2")).toEqual({
      kind: "replace",
      part: second,
    });
    expect(partUseTarget(ready, [bassPart, second], null)).toEqual({
      kind: "replace",
      part: bassPart,
    });
    const { html } = view({ takes: [ready], parts: [bassPart], targetPartId: "bass-1" });
    expect(html).toContain("Replaces the take in the AI Bass lane.");
    expect(html).toContain("Trying other takes for the AI Bass lane.");
  });

  it("marks the take a lane already plays as in use", () => {
    const current = take({ id: "t-old" });
    expect(partUseTarget(current, [bassPart], null)).toEqual({ kind: "current", part: bassPart });
    const { buttons } = view({
      takes: [current],
      parts: [bassPart],
      inUseTakeIds: new Set(["t-old"]),
    });
    const [inUse] = buttons("In use");
    expect(inUse.props["aria-disabled"]).toBe(true);
  });

  it("refuses a fifth lane with the reason, but still swaps an existing one", () => {
    const four: RemixPart[] = [
      { id: "drums-1", role: "drums", takeId: "d" },
      { id: "keys-1", role: "keys", takeId: "k" },
      { id: "pad-1", role: "pad", takeId: "p" },
      { id: "strings-1", role: "strings", takeId: "s" },
    ];
    const guitar = take({ id: "g", role: "guitar" });
    expect(partUseTarget(guitar, four, null)).toEqual({ kind: "full" });
    const full = view({ role: "guitar", takes: [guitar], parts: four });
    const [use] = full.buttons("Use this take");
    expect(use.props["aria-disabled"]).toBe(true);
    (use.props.onClick as () => void)();
    expect(full.model.onUseTake).not.toHaveBeenCalled();
    expect(full.html.replaceAll("&#x27;", "'")).toContain(PARTS_FULL_REASON);
    expect(partUseTarget(take({ role: "keys" }), four, null).kind).toBe("replace");
  });

  it("locks every action on a published remix", () => {
    expect(takeUseAction({ kind: "add" }, true)).toEqual({
      label: "Use this take",
      enabled: false,
      note: PARTS_LOCKED_REASON,
    });
    expect(partLaneName("bass")).toBe("AI Bass");
    expect(PART_PICKUP_REASON).toContain("pickup");
  });
});

describe("Add a part — delete a take (#1901)", () => {
  it("deletes an unused, finished take", () => {
    const ready = take({ id: "x" });
    const { buttons, model: m } = view({ takes: [ready] });
    const [remove] = buttons("Delete Take 1");
    (remove.props.onClick as () => void)();
    expect(m.onDeleteTake).toHaveBeenCalledWith(ready);
    expect(takeDeleteAvailability(take({ status: "failed" }), new Set(), false).enabled).toBe(true);
  });

  it("keeps a take in use or still being made, saying why", () => {
    const inUse = take({ id: "u" });
    expect(takeDeleteAvailability(inUse, new Set(["u"]), false)).toEqual({
      enabled: false,
      reason: "A lane uses this take. Remove the lane or pick another take first.",
    });
    expect(takeDeleteAvailability(take({ status: "pending" }), new Set(), false)).toEqual({
      enabled: false,
      reason: "This take is still being made.",
    });
    expect(takeDeleteAvailability(take(), new Set(), true).reason).toBe(PARTS_LOCKED_REASON);
    const { elements, model: m } = view({ takes: [inUse], inUseTakeIds: new Set(["u"]) });
    const remove = elements.find(
      (element) =>
        element.type === "button" &&
        String(element.props["aria-label"]).startsWith("Delete Take 1"),
    );
    expect(remove?.props["aria-disabled"]).toBe(true);
    expect(remove?.props["aria-label"]).toContain("A lane uses this take");
    (remove?.props.onClick as () => void)();
    expect(m.onDeleteTake).not.toHaveBeenCalled();
  });
});
