import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProposedTasteEdit } from "../../lib/api";
import { TasteEditSectionContent } from "./TasteEditSection";
import { buildDraft, toggleRow } from "./tasteEdits";

const items: ProposedTasteEdit[] = [
  {
    id: "edit-1",
    kind: "downrank_genre",
    signalType: "genre",
    value: "Drill",
    action: "downranked",
    phrase: "less drill",
    statement: "Show less Drill",
  },
  {
    id: "edit-2",
    kind: "written_preference",
    signalType: "note",
    value: "more live instruments",
    action: "declared",
    phrase: "more live instruments",
    statement: 'Save the note "more live instruments" (shown in your taste memory; where music matching is on, it nudges recommendations toward music like it)',
  },
  {
    id: "edit-3",
    kind: "unmapped",
    signalType: null,
    value: "",
    action: null,
    phrase: "songs about the ocean",
    statement: "Couldn't map 'songs about the ocean' to a taste signal",
  },
];

function render(overrides: Partial<React.ComponentProps<typeof TasteEditSectionContent>> = {}) {
  return renderToStaticMarkup(
    <TasteEditSectionContent
      fieldId="t"
      text=""
      draft={null}
      busy={null}
      canUse
      onTextChange={vi.fn()}
      onPreview={vi.fn()}
      onToggle={vi.fn()}
      onSwitch={vi.fn()}
      onRemove={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
      {...overrides}
    />,
  );
}

describe("TasteEditSectionContent", () => {
  it("asks the question, explains nothing is saved yet, and offers only Preview", () => {
    const html = render();
    expect(html).toContain("Tell us what you want more or less of");
    expect(html).toContain("nothing is saved until you apply it");
    expect(html).toContain("Preview changes");
    expect(html).not.toContain("Apply ");
    expect(html).not.toContain("Proposed taste changes");
    // The text box has a real label and a description for assistive tech.
    expect(html).toContain('for="t-text"');
    expect(html).toContain('aria-describedby="t-hint"');
  });

  it("disables Preview until there is text and a session", () => {
    expect(render({ text: "" })).toMatch(/<button[^>]*disabled[^>]*>Preview changes/);
    expect(render({ text: "less drill", canUse: false })).toMatch(/<button[^>]*disabled[^>]*>Preview changes/);
    expect(render({ text: "less drill" })).not.toMatch(/<button[^>]*disabled[^>]*>Preview changes/);
  });

  it("renders each proposed change as an editable row with its statement", () => {
    const html = render({ text: "less drill, more live instruments", draft: buildDraft(items) });
    expect(html).toContain("Proposed taste changes");
    expect(html).toContain("Show less Drill");
    expect(html).toContain("Switch to more");
    expect(html).toContain("Remove from this list: Show less Drill");
    // Two selectable rows start ticked; Apply counts them.
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("Apply 2 selected changes");
  });

  it("says written notes only nudge recommendations where music matching is on", () => {
    const html = render({ draft: buildDraft(items) });
    expect(html).toContain("Where music matching is on, it gently nudges recommendations");
  });

  it("shows unmapped text honestly and makes it unselectable", () => {
    const html = render({ draft: buildDraft(items) });
    expect(html).toContain("Couldn&#x27;t map &#x27;songs about the ocean&#x27; to a taste signal");
    expect(html).toContain("Not selectable, so it will not be saved.");
    // Only the two mappable rows have a checkbox.
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it("updates the Apply count and disables it when nothing is selected", () => {
    const one = toggleRow(buildDraft(items), "edit-1");
    expect(render({ draft: one })).toContain("Apply 1 selected change");
    const none = toggleRow(one, "edit-2");
    expect(render({ draft: none })).toMatch(/<button[^>]*disabled[^>]*>Apply 0 selected changes/);
  });

  it("explains an empty preview instead of showing an empty list", () => {
    const html = render({ draft: [] });
    expect(html).toContain("We could not find anything to change in that");
    expect(html).not.toContain("Proposed taste changes");
    expect(html).not.toContain("Apply ");
  });

  it("locks the rows while a request is running", () => {
    const html = render({ draft: buildDraft(items), busy: "apply" });
    expect(html).toContain("Applying...");
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it("wires no network call into rendering itself", () => {
    const onPreview = vi.fn();
    const onApply = vi.fn();
    render({ draft: buildDraft(items), onPreview, onApply });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
