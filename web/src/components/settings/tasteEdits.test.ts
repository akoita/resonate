import { describe, expect, it, vi } from "vitest";
import type { ProposedTasteEdit, TasteSignalControl } from "../../lib/api";
import {
  buildDraft,
  canSwitchDirection,
  confirmedEdits,
  controlLabel,
  controlRemoveLabel,
  isApplicable,
  isDeclaredControl,
  removeRow,
  runApply,
  runPreview,
  selectedRows,
  switchDirection,
  toggleRow,
} from "./tasteEdits";

function edit(overrides: Partial<ProposedTasteEdit> = {}): ProposedTasteEdit {
  return {
    id: "edit-1",
    kind: "downrank_genre",
    signalType: "genre",
    value: "Drill",
    action: "downranked",
    phrase: "less drill",
    statement: "Show less Drill",
    ...overrides,
  };
}

const drill = edit();
const jazz = edit({
  id: "edit-2",
  kind: "boost_genre",
  value: "Jazz",
  action: "boosted",
  phrase: "more jazz",
  statement: "Show more Jazz",
});
const note = edit({
  id: "edit-3",
  kind: "written_preference",
  signalType: "note",
  value: "more live instruments",
  action: "declared",
  phrase: "more live instruments",
  statement: 'Save the note "more live instruments"',
});
const unmapped = edit({
  id: "edit-4",
  kind: "unmapped",
  signalType: null,
  value: "",
  action: null,
  phrase: "songs about the ocean",
  statement: "Couldn't map 'songs about the ocean' to a taste signal",
});

describe("taste edit draft", () => {
  it("selects every mappable row and never an unmapped one", () => {
    const draft = buildDraft([drill, jazz, note, unmapped]);
    expect(draft.map((row) => row.included)).toEqual([true, true, true, false]);
    expect(isApplicable(unmapped)).toBe(false);
  });

  it("cannot toggle an unmapped row on", () => {
    const draft = toggleRow(buildDraft([unmapped]), "edit-4");
    expect(draft[0].included).toBe(false);
    expect(selectedRows(draft)).toHaveLength(0);
  });

  it("toggles a row off and on", () => {
    const off = toggleRow(buildDraft([drill, jazz]), "edit-1");
    expect(off.map((row) => row.included)).toEqual([false, true]);
    expect(toggleRow(off, "edit-1")[0].included).toBe(true);
  });

  it("removes a row", () => {
    expect(removeRow(buildDraft([drill, jazz]), "edit-1").map((row) => row.item.id)).toEqual(["edit-2"]);
  });

  it("switches a genre between less and more, rewriting the statement", () => {
    const flipped = switchDirection(buildDraft([drill]), "edit-1")[0].item;
    expect(flipped).toMatchObject({ kind: "boost_genre", action: "boosted", statement: "Show more Drill" });
    const back = switchDirection(switchDirection(buildDraft([drill]), "edit-1"), "edit-1")[0].item;
    expect(back).toMatchObject({ kind: "downrank_genre", action: "downranked", statement: "Show less Drill" });
  });

  it("switches a mood and keeps the wording the backend uses", () => {
    const dark = edit({
      id: "m",
      kind: "boost_mood",
      signalType: "mood",
      value: "Dark",
      action: "boosted",
      statement: "Show more Dark music",
    });
    expect(switchDirection(buildDraft([dark]), "m")[0].item).toMatchObject({
      kind: "downrank_mood",
      action: "downranked",
      statement: "Show less Dark music",
    });
  });

  it("only offers more/less for genres and moods", () => {
    expect(canSwitchDirection(drill)).toBe(true);
    expect(canSwitchDirection(note)).toBe(false);
    expect(canSwitchDirection(unmapped)).toBe(false);
    const energy = edit({ kind: "energy_preference", signalType: "energy", value: "low", action: "boosted" });
    expect(switchDirection(buildDraft([energy]), energy.id)[0].item).toEqual(energy);
  });

  it("builds the apply payload from selected rows only", () => {
    const draft = toggleRow(buildDraft([drill, jazz, note, unmapped]), "edit-1");
    expect(confirmedEdits(draft)).toEqual([
      { signalType: "genre", value: "Jazz", action: "boosted" },
      { signalType: "note", value: "more live instruments", action: "declared" },
    ]);
  });
});

describe("taste edit flow", () => {
  it("previews without ever applying", async () => {
    const preview = vi.fn().mockResolvedValue({ items: [drill, jazz] });
    const apply = vi.fn();

    const draft = await runPreview({ preview }, "token", "  less drill, more jazz  ");

    expect(preview).toHaveBeenCalledWith("token", "less drill, more jazz");
    expect(apply).not.toHaveBeenCalled();
    expect(draft).toHaveLength(2);
  });

  it("does not call the server for blank text", async () => {
    const preview = vi.fn();
    expect(await runPreview({ preview }, "token", "   ")).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });

  it("applies only the rows the listener left selected", async () => {
    const apply = vi.fn().mockResolvedValue({ edits: { appliedCount: 1, ignoredCount: 0 } });
    let draft = buildDraft([drill, jazz, unmapped]);
    draft = toggleRow(draft, "edit-1"); // the listener unticks "Show less Drill"

    await runApply({ apply }, "token", draft);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("token", [{ signalType: "genre", value: "Jazz", action: "boosted" }]);
  });

  it("sends a switched row with its new direction", async () => {
    const apply = vi.fn().mockResolvedValue({ edits: { appliedCount: 1, ignoredCount: 0 } });
    await runApply({ apply }, "token", switchDirection(buildDraft([drill]), "edit-1"));
    expect(apply).toHaveBeenCalledWith("token", [{ signalType: "genre", value: "Drill", action: "boosted" }]);
  });

  it("does nothing when no row is selected", async () => {
    const apply = vi.fn();
    const none = buildDraft([drill]).map((row) => ({ ...row, included: false }));
    expect(await runApply({ apply }, "token", none)).toBeNull();
    expect(await runApply({ apply }, "token", buildDraft([unmapped]))).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("control labels", () => {
  const control = (overrides: Partial<TasteSignalControl>): TasteSignalControl => ({
    id: "c1",
    signalType: "genre",
    value: "Jazz",
    action: "hidden",
    source: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });

  it("keeps the existing wording for hidden and downranked controls", () => {
    expect(controlLabel(control({}))).toBe("hidden genre");
    expect(controlLabel(control({ action: "downranked", signalType: "mood" }))).toBe("downranked mood");
    expect(controlRemoveLabel(control({}))).toBe("Restore");
  });

  it("labels boosted and note controls clearly", () => {
    expect(controlLabel(control({ action: "boosted" }))).toBe("more of this genre");
    expect(controlLabel(control({ action: "boosted", signalType: "energy", value: "low" }))).toBe("preferred energy");
    expect(controlLabel(control({ action: "declared", signalType: "note" }))).toContain("does not change recommendations");
    expect(controlRemoveLabel(control({ action: "boosted" }))).toBe("Remove");
    expect(controlRemoveLabel(control({ action: "declared", signalType: "note" }))).toBe("Remove");
  });

  it("recognises controls written by a confirmed taste edit", () => {
    expect(isDeclaredControl(control({ source: "declared_text_edit" }))).toBe(true);
    expect(isDeclaredControl(control({ source: "settings" }))).toBe(false);
  });
});
